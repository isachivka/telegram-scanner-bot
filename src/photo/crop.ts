import sharp from "sharp";

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type Rotation = 0 | 90 | 180 | 270;

/** Long side of the thumbnail the detector works on. */
const DETECT_SIZE = 800;
/** A pixel belongs to the photo when a channel differs from the lid colour by more. */
const DIFF_THRESHOLD = 22;
/** Scanner edges often carry a shadow; ignore this share of each side. */
const EDGE_MARGIN = 0.012;
/** Anything smaller than this share of the platen is dust, not a photo. */
const MIN_AREA = 0.004;

/**
 * Find the one photo lying on the (white) scanner lid: the largest blob that
 * differs from the background colour sampled along the edges. Returns its box
 * in full-resolution pixels, or undefined when the glass looks empty.
 */
export async function detectPhoto(file: string): Promise<Box | undefined> {
  const meta = await sharp(file).metadata();
  const W = meta.width;
  const H = meta.height;
  if (!W || !H) throw new Error("cannot read the scanned image size");
  const scale = Math.min(1, DETECT_SIZE / Math.max(W, H));
  const w = Math.max(1, Math.round(W * scale));
  const h = Math.max(1, Math.round(H * scale));
  if (w < 8 || h < 8) return undefined;

  const { data } = await sharp(file)
    .resize(w, h, { fit: "fill" })
    .removeAlpha()
    .toColourspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });

  const margin = Math.max(1, Math.round(Math.min(w, h) * EDGE_MARGIN));
  const bg = sampleBackground(data, w, h, margin);

  // Foreground mask, edges excluded.
  const mask = new Uint8Array(w * h);
  for (let y = margin; y < h - margin; y++) {
    for (let x = margin; x < w - margin; x++) {
      const i = (y * w + x) * 3;
      const d = Math.max(
        Math.abs(data[i]! - bg[0]),
        Math.abs(data[i + 1]! - bg[1]),
        Math.abs(data[i + 2]! - bg[2]),
      );
      if (d > DIFF_THRESHOLD) mask[y * w + x] = 1;
    }
  }

  // Close small gaps (bright skies, white dresses) so a photo stays one blob.
  const grown = dilate(mask, w, h, 2);
  const blob = largestComponent(grown, w, h);
  if (!blob) return undefined;

  // Box from the original mask pixels of that blob, so dilation adds no border.
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  let count = 0;
  for (let p = 0; p < w * h; p++) {
    if (blob[p] && mask[p]) {
      const x = p % w;
      const y = (p - x) / w;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      count++;
    }
  }
  if (x1 < 0 || (x1 - x0 + 1) * (y1 - y0 + 1) < MIN_AREA * w * h || count < 16) {
    return undefined;
  }
  // A photo pushed into a corner runs into the ignored edge band: reclaim it.
  if (x0 <= margin) x0 = 0;
  if (y0 <= margin) y0 = 0;
  if (x1 >= w - margin - 1) x1 = w - 1;
  if (y1 >= h - margin - 1) y1 = h - 1;

  const left = Math.max(0, Math.floor(x0 / scale));
  const top = Math.max(0, Math.floor(y0 / scale));
  const right = Math.min(W, Math.ceil((x1 + 1) / scale));
  const bottom = Math.min(H, Math.ceil((y1 + 1) / scale));
  return { left, top, width: right - left, height: bottom - top };
}

/** Median colour of the band just inside the ignored edge. */
function sampleBackground(
  data: Buffer,
  w: number,
  h: number,
  margin: number,
): [number, number, number] {
  const ch: number[][] = [[], [], []];
  const push = (x: number, y: number) => {
    const i = (y * w + x) * 3;
    ch[0]!.push(data[i]!);
    ch[1]!.push(data[i + 1]!);
    ch[2]!.push(data[i + 2]!);
  };
  const a = margin;
  const bx = w - 1 - margin;
  const by = h - 1 - margin;
  for (let x = a; x <= bx; x++) {
    push(x, a);
    push(x, by);
  }
  for (let y = a; y <= by; y++) {
    push(a, y);
    push(bx, y);
  }
  const median = (v: number[]) => {
    v.sort((p, q) => p - q);
    return v[v.length >> 1] ?? 255;
  };
  return [median(ch[0]!), median(ch[1]!), median(ch[2]!)];
}

function dilate(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  // Separable square dilation: rows, then columns.
  const tmp = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      for (let dx = Math.max(0, x - r); dx <= Math.min(w - 1, x + r); dx++) {
        tmp[y * w + dx] = 1;
      }
    }
  }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!tmp[y * w + x]) continue;
      for (let dy = Math.max(0, y - r); dy <= Math.min(h - 1, y + r); dy++) {
        out[dy * w + x] = 1;
      }
    }
  }
  return out;
}

/** Mask of the largest 4-connected component, or undefined when there is none. */
function largestComponent(
  mask: Uint8Array,
  w: number,
  h: number,
): Uint8Array | undefined {
  const label = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  let best = 0;
  let bestSize = 0;
  let next = 0;
  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || label[start]) continue;
    next++;
    let size = 0;
    let sp = 0;
    stack[sp++] = start;
    label[start] = next;
    while (sp > 0) {
      const p = stack[--sp]!;
      size++;
      const x = p % w;
      const neighbours = [
        x > 0 ? p - 1 : -1,
        x < w - 1 ? p + 1 : -1,
        p >= w ? p - w : -1,
        p < w * (h - 1) ? p + w : -1,
      ];
      for (const q of neighbours) {
        if (q >= 0 && mask[q] && !label[q]) {
          label[q] = next;
          stack[sp++] = q;
        }
      }
    }
    if (size > bestSize) {
      bestSize = size;
      best = next;
    }
  }
  if (!best) return undefined;
  const out = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) if (label[p] === best) out[p] = 1;
  return out;
}

export interface RenderOptions {
  box?: Box;
  rotation: Rotation;
  /** EXIF DateTimeOriginal, "YYYY:MM:DD HH:MM:SS". */
  exifDate?: string;
}

/** Cropped, rotated full-resolution JPEG for the library. */
export async function renderPhoto(
  src: string,
  out: string,
  opts: RenderOptions,
): Promise<void> {
  let img = sharp(src);
  if (opts.box) img = img.extract(opts.box);
  if (opts.rotation) img = img.rotate(opts.rotation);
  const meta = await sharp(src).metadata();
  const density = meta.density ?? undefined;
  img = img.withMetadata(density ? { density } : {}).withExif({
    IFD0: { Software: "telegram-scanner-bot" },
    ...(opts.exifDate
      ? { IFD2: { DateTimeOriginal: opts.exifDate, DateTimeDigitized: opts.exifDate } }
      : {}),
  });
  await img.jpeg({ quality: 93, chromaSubsampling: "4:4:4", mozjpeg: true }).toFile(out);
}

/** Small preview to show in the chat. */
export async function renderPreview(
  src: string,
  out: string,
  opts: { box?: Box; rotation: Rotation },
): Promise<void> {
  let img = sharp(src);
  if (opts.box) img = img.extract(opts.box);
  if (opts.rotation) img = img.rotate(opts.rotation);
  await img
    .resize(1280, 1280, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toFile(out);
}
