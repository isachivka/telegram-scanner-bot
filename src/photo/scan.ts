import path from "node:path";
import sharp from "sharp";
import { esclScanPlaten, type Region } from "../core/escl.js";
import type { Logger } from "../util/logger.js";
import { detectPhoto, type Box } from "./crop.js";

export interface PhotoScan {
  /** Image to crop the photo from. */
  file: string;
  /** Where the photo is in `file`; undefined when the glass looked empty. */
  box?: Box;
  /** Resolution of `file`. */
  dpi: number;
  /** A higher resolution was asked for but the scanner could not deliver it. */
  reduced: boolean;
}

/** Resolution every eSCL scanner handles for the whole platen. */
const PREVIEW_DPI = 300;
/** Extra margin around the photo for the high-resolution pass, 1/300 inch (~2 mm). */
const PAD = 24;

/**
 * Two passes over eSCL: the whole platen at 300 dpi to find the photo, then
 * only the photo's region at `dpi`. A scanner that advertises 300 dpi may scan
 * a photo-sized region at its optical 600 dpi but cancels a dense full-platen
 * 600 dpi job; scanning less is also faster. When the second pass fails the
 * 300 dpi crop is used.
 */
export async function scanPhotoEscl(
  esclUrl: string,
  dir: string,
  dpi: number,
  opts: { timeoutMs: number; log: Logger; fetchImpl?: typeof fetch },
): Promise<PhotoScan> {
  const preview = path.join(dir, "platen.jpg");
  await esclScanPlaten(esclUrl, preview, {
    dpi: PREVIEW_DPI,
    timeoutMs: opts.timeoutMs,
    fetchImpl: opts.fetchImpl,
  });
  const box = await detectPhoto(preview);
  if (!box || dpi <= PREVIEW_DPI) {
    return { file: preview, box, dpi: PREVIEW_DPI, reduced: false };
  }

  // At 300 dpi a preview pixel is exactly one eSCL unit (1/300 inch).
  const unitsPerPx = 300 / PREVIEW_DPI;
  const region: Region = {
    left: Math.max(0, box.left * unitsPerPx - PAD),
    top: Math.max(0, box.top * unitsPerPx - PAD),
    width: box.width * unitsPerPx + 2 * PAD,
    height: box.height * unitsPerPx + 2 * PAD,
  };
  const hires = path.join(dir, "photo-hires.jpg");
  try {
    await esclScanPlaten(esclUrl, hires, {
      dpi,
      region,
      attempts: 2,
      timeoutMs: opts.timeoutMs,
      fetchImpl: opts.fetchImpl,
    });
  } catch (err) {
    opts.log.warn({ err, dpi }, "high-resolution photo pass failed; using the preview");
    return { file: preview, box, dpi: PREVIEW_DPI, reduced: true };
  }

  // Map the photo box into the region scan; the scanner may round the region.
  const meta = await sharp(hires).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  const k = dpi / 300;
  const left = Math.max(0, Math.round((box.left * unitsPerPx - region.left) * k));
  const top = Math.max(0, Math.round((box.top * unitsPerPx - region.top) * k));
  const width = Math.min(W - left, Math.round(box.width * unitsPerPx * k));
  const height = Math.min(H - top, Math.round(box.height * unitsPerPx * k));
  if (width < 16 || height < 16) {
    opts.log.warn(
      { W, H, region },
      "high-resolution pass came back too small; using the preview",
    );
    return { file: preview, box, dpi: PREVIEW_DPI, reduced: true };
  }
  return { file: hires, box: { left, top, width, height }, dpi, reduced: false };
}
