import sharp from "sharp";

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type Rotation = 0 | 90 | 180 | 270;

/** Long side of the thumbnail the detector works on. */
const DETECT_SIZE = 1200;
/** A pixel belongs to the photo when a channel differs from the lid colour by more. */
const DIFF_THRESHOLD = 22;
/** Scanner edges often carry a shadow; ignore this share of each side. */
const EDGE_MARGIN = 0.012;
/** Anything smaller than this share of the platen is dust, not a photo. */
const MIN_AREA = 0.004;

export type Rgb = [number, number, number];

export interface Located {
  box?: Box;
  /** Lid colour the photo was told apart from. */
  background: Rgb;
  /** How far the photo is turned clockwise on the glass, degrees (0 if unsure). */
  skew: number;
}

/**
 * Find the one photo lying on the (white) scanner lid: the largest blob that
 * differs from the background colour sampled along the edges. Returns its box
 * in full-resolution pixels, or undefined when the glass looks empty.
 */
export async function detectPhoto(file: string): Promise<Box | undefined> {
  return (await locatePhoto(file)).box;
}

/**
 * detectPhoto with the lid colour exposed, and optionally given: a scan of
 * just the photo's region has too little lid along its edges to sample it.
 */
export async function locatePhoto(
  file: string,
  opts: { background?: Rgb } = {},
): Promise<Located> {
  const meta = await sharp(file).metadata();
  const W = meta.width;
  const H = meta.height;
  if (!W || !H) throw new Error("cannot read the scanned image size");
  const scale = Math.min(1, DETECT_SIZE / Math.max(W, H));
  const w = Math.max(1, Math.round(W * scale));
  const h = Math.max(1, Math.round(H * scale));
  if (w < 8 || h < 8) return { background: opts.background ?? [255, 255, 255], skew: 0 };

  const { data } = await sharp(file)
    .resize(w, h, { fit: "fill" })
    .removeAlpha()
    .toColourspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });

  const margin = Math.max(1, Math.round(Math.min(w, h) * EDGE_MARGIN));
  const bg = opts.background ?? sampleBackground(data, w, h, margin);

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
  if (!blob) return { background: bg, skew: 0 };

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
    return { background: bg, skew: 0 };
  }
  const skew = estimateSkew(blob, mask, w, h, { x0, y0, x1, y1 }, margin);
  // A photo pushed into a corner runs into the ignored edge band: reclaim it.
  if (x0 <= margin) x0 = 0;
  if (y0 <= margin) y0 = 0;
  if (x1 >= w - margin - 1) x1 = w - 1;
  if (y1 >= h - margin - 1) y1 = h - 1;

  const left = Math.max(0, Math.floor(x0 / scale));
  const top = Math.max(0, Math.floor(y0 / scale));
  const right = Math.min(W, Math.ceil((x1 + 1) / scale));
  const bottom = Math.min(H, Math.ceil((y1 + 1) / scale));
  return {
    box: { left, top, width: right - left, height: bottom - top },
    background: bg,
    skew,
  };
}

/**
 * Angle of the photo's sides from the detection mask: for each side, the
 * outermost photo pixel along every row/column of its middle 80%, and the
 * median slope between points half a side apart (robust to a torn corner or a
 * finger of shadow). Sides cut by the edge of the scan are skipped. Returns
 * the median over the sides, or 0 when they disagree (not a rectangle).
 */
function estimateSkew(
  blob: Uint8Array,
  mask: Uint8Array,
  w: number,
  h: number,
  b: { x0: number; y0: number; x1: number; y1: number },
  margin: number,
): number {
  const on = (x: number, y: number) => blob[y * w + x] === 1 && mask[y * w + x] === 1;
  const bw = b.x1 - b.x0 + 1;
  const bh = b.y1 - b.y0 + 1;
  if (bw < 40 || bh < 40) return 0;

  const slopeOf = (pts: Array<[number, number]>) => {
    if (pts.length < 20) return undefined;
    const half = Math.floor(pts.length / 2);
    const slopes: number[] = [];
    for (let i = 0; i + half < pts.length; i++) {
      const [a1, v1] = pts[i]!;
      const [a2, v2] = pts[i + half]!;
      if (a2 !== a1) slopes.push((v2 - v1) / (a2 - a1));
    }
    slopes.sort((p, q) => p - q);
    return slopes[slopes.length >> 1];
  };
  const deg = (r: number) => (Math.atan(r) * 180) / Math.PI;
  const estimates: number[] = [];
  const xs = (from: number, to: number) => {
    const out: number[] = [];
    for (let x = from; x <= to; x++) out.push(x);
    return out;
  };
  const cols = xs(b.x0 + Math.floor(bw * 0.1), b.x1 - Math.floor(bw * 0.1));
  const rows = xs(b.y0 + Math.floor(bh * 0.1), b.y1 - Math.floor(bh * 0.1));

  if (b.y0 > margin) {
    const pts: Array<[number, number]> = [];
    for (const x of cols)
      for (let y = b.y0; y <= b.y1; y++)
        if (on(x, y)) {
          pts.push([x, y]);
          break;
        }
    const s = slopeOf(pts);
    if (s !== undefined) estimates.push(deg(s));
  }
  if (b.y1 < h - margin - 1) {
    const pts: Array<[number, number]> = [];
    for (const x of cols)
      for (let y = b.y1; y >= b.y0; y--)
        if (on(x, y)) {
          pts.push([x, y]);
          break;
        }
    const s = slopeOf(pts);
    if (s !== undefined) estimates.push(deg(s));
  }
  if (b.x0 > margin) {
    const pts: Array<[number, number]> = [];
    for (const y of rows)
      for (let x = b.x0; x <= b.x1; x++)
        if (on(x, y)) {
          pts.push([y, x]);
          break;
        }
    const s = slopeOf(pts);
    if (s !== undefined) estimates.push(-deg(s));
  }
  if (b.x1 < w - margin - 1) {
    const pts: Array<[number, number]> = [];
    for (const y of rows)
      for (let x = b.x1; x >= b.x0; x--)
        if (on(x, y)) {
          pts.push([y, x]);
          break;
        }
    const s = slopeOf(pts);
    if (s !== undefined) estimates.push(-deg(s));
  }
  if (estimates.length === 0) return 0;
  estimates.sort((p, q) => p - q);
  if (estimates[estimates.length - 1]! - estimates[0]! > 1.5) return 0;
  return estimates[estimates.length >> 1]!;
}

/** Turns smaller than this are left alone; larger ones are not a photo lying askew. */
const MIN_SKEW = 0.15;
const MAX_SKEW = 8;

export interface Cropped {
  /** Image the box refers to: `file`, or a straightened copy of it. */
  file: string;
  box?: Box;
  /** The box as first detected, before straightening and tightening. */
  found?: Box;
}

/**
 * Locate the photo in `file` against the lid colour, straighten it when it
 * lies askew (writing `straightPath`), and tighten the box past the shadow of
 * the paper edge.
 */
export async function cropPhoto(
  file: string,
  straightPath: string,
  background: Rgb,
  dpi: number,
): Promise<Cropped> {
  const first = await locatePhoto(file, { background });
  if (!first.box) return { file };
  let src = file;
  let box = first.box;
  const turn = Math.abs(first.skew);
  if (turn >= MIN_SKEW && turn <= MAX_SKEW) {
    const [r, g, b] = background;
    await sharp(file)
      .rotate(-first.skew, { background: { r, g, b } })
      .jpeg({ quality: 95, chromaSubsampling: "4:4:4" })
      .toFile(straightPath);
    const again = await locatePhoto(straightPath, { background });
    if (again.box) {
      src = straightPath;
      box = again.box;
    }
  }
  const tight = await tightenBox(src, box, background, Math.round(dpi / 15));
  return { file: src, box: insetBox(tight, 2), found: first.box };
}

/**
 * Shrink a box by `px` on every side (within the image), so the blurred paper
 * edge does not leave a light rim around the crop.
 */
export function insetBox(box: Box, px: number): Box {
  const d = Math.max(
    0,
    Math.min(px, Math.floor((Math.min(box.width, box.height) - 2) / 4)),
  );
  return {
    left: box.left + d,
    top: box.top + d,
    width: box.width - 2 * d,
    height: box.height - 2 * d,
  };
}

/**
 * Pull each edge of `box` inward past the soft shadow a photo's paper edge
 * casts on the lid (~1 mm at 600 dpi), which the detection threshold still
 * counts as photo. A line counts as photo once it differs from the lid at least
 * 75% as much as the photo does `maxPx` inside the edge; the comparison is
 * relative, so a light sky along the edge is not eaten into. Moves at most
 * `maxPx` per side.
 */
export async function tightenBox(
  file: string,
  box: Box,
  background: Rgb,
  maxPx: number,
): Promise<Box> {
  const { data, info } = await sharp(file)
    .extract(box)
    .removeAlpha()
    .toColourspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const c = info.channels;
  const reach = Math.min(maxPx, Math.floor(w / 6), Math.floor(h / 6));
  if (reach < 2) return box;
  const diff = (x: number, y: number) => {
    const i = (y * w + x) * c;
    return Math.max(
      Math.abs(data[i]! - background[0]),
      Math.abs(data[i + 1]! - background[1]),
      Math.abs(data[i + 2]! - background[2]),
    );
  };
  // Mean difference along the middle 60% of a row or a column.
  const row = (y: number) => {
    let sum = 0;
    const a = Math.floor(w * 0.2);
    const b = Math.ceil(w * 0.8);
    for (let x = a; x < b; x++) sum += diff(x, y);
    return sum / (b - a);
  };
  const col = (x: number) => {
    let sum = 0;
    const a = Math.floor(h * 0.2);
    const b = Math.ceil(h * 0.8);
    for (let y = a; y < b; y++) sum += diff(x, y);
    return sum / (b - a);
  };
  const edge = (line: (i: number) => number, from: number, step: 1 | -1) => {
    const inner = line(from + step * reach);
    const need = 0.75 * inner;
    for (let k = 0; k < reach; k++) {
      if (line(from + step * k) >= need) return k;
    }
    return reach;
  };
  const top = edge(row, 0, 1);
  const bottom = edge(row, h - 1, -1);
  const left = edge(col, 0, 1);
  const right = edge(col, w - 1, -1);
  return {
    left: box.left + left,
    top: box.top + top,
    width: box.width - left - right,
    height: box.height - top - bottom,
  };
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

/**
 * Crop, then rotate. Two pipelines on purpose: in one chain with resize(),
 * sharp rotates before the extract, and a box that fits the unrotated image
 * falls outside the rotated one ("bad extract area").
 */
async function cropRotate(src: string, box: Box | undefined, rotation: Rotation) {
  let img = sharp(src);
  if (box) {
    const { data, info } = await sharp(src)
      .extract(box)
      .raw()
      .toBuffer({ resolveWithObject: true });
    img = sharp(data, {
      raw: { width: info.width, height: info.height, channels: info.channels },
    });
  }
  if (rotation) {
    const { data, info } = await img
      .rotate(rotation)
      .raw()
      .toBuffer({ resolveWithObject: true });
    img = sharp(data, {
      raw: { width: info.width, height: info.height, channels: info.channels },
    });
  }
  return img;
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
  const meta = await sharp(src).metadata();
  const img = (await cropRotate(src, opts.box, opts.rotation))
    .withMetadata(meta.density ? { density: meta.density } : {})
    .withExif({
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
  await (
    await cropRotate(src, opts.box, opts.rotation)
  )
    .resize(1280, 1280, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toFile(out);
}
