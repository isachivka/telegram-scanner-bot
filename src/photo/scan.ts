import path from "node:path";
import sharp from "sharp";
import { esclScanPlaten, type Region } from "../core/escl.js";
import type { Logger } from "../util/logger.js";
import { cropPhoto, locatePhoto, type Box } from "./crop.js";

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
  const { box, background } = await locatePhoto(preview);
  const previewResult = async (reduced: boolean): Promise<PhotoScan> => {
    if (!box) return { file: preview, dpi: PREVIEW_DPI, reduced };
    const c = await cropPhoto(
      preview,
      path.join(dir, "platen-straight.jpg"),
      background,
      PREVIEW_DPI,
    );
    return { file: c.file, box: c.box, dpi: PREVIEW_DPI, reduced };
  };
  if (!box || dpi <= PREVIEW_DPI) return previewResult(false);

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
    return previewResult(true);
  }

  // Where the photo should be in the region scan, by arithmetic…
  const meta = await sharp(hires).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  const k = dpi / 300;
  const mLeft = Math.max(0, Math.round((box.left * unitsPerPx - region.left) * k));
  const mTop = Math.max(0, Math.round((box.top * unitsPerPx - region.top) * k));
  const mapped: Box = {
    left: mLeft,
    top: mTop,
    width: Math.min(W - mLeft, Math.round(box.width * unitsPerPx * k)),
    height: Math.min(H - mTop, Math.round(box.height * unitsPerPx * k)),
  };
  if (mapped.width < 16 || mapped.height < 16) {
    opts.log.warn({ W, H, region }, "high-resolution pass came back too small");
    return previewResult(true);
  }
  // …but the scanner does not place a 600 dpi region exactly where the 300 dpi
  // pass saw it (an HP 135w shifts it by ~2 mm), so look again in the region
  // scan, against the lid colour measured on the whole platen.
  const c = await cropPhoto(hires, path.join(dir, "photo-straight.jpg"), background, dpi);
  const area = (b: Box) => b.width * b.height;
  const plausible =
    c.found !== undefined &&
    area(c.found) > 0.75 * area(mapped) &&
    area(c.found) < 1.25 * area(mapped);
  if (!plausible) {
    opts.log.warn({ found: c.found, mapped }, "photo not re-found in the region scan");
    return { file: hires, box: mapped, dpi, reduced: false };
  }
  return { file: c.file, box: c.box, dpi, reduced: false };
}
