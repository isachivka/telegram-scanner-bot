import { exec } from "../util/exec.js";

/** Losslessly wrap page images into a single PDF with img2pdf. */
export async function imagesToPdf(pages: string[], outPath: string): Promise<string> {
  if (pages.length === 0) {
    throw new Error("no pages to assemble");
  }
  await exec("img2pdf", [...pages, "-o", outPath], { timeoutMs: 120_000 });
  return outPath;
}

export function isPdf(mime: string | undefined, name: string | undefined): boolean {
  return mime === "application/pdf" || (name ?? "").toLowerCase().endsWith(".pdf");
}

export function isImage(mime: string | undefined, name: string | undefined): boolean {
  if (mime?.startsWith("image/")) return true;
  return /\.(jpe?g|png|gif|bmp|tiff?|webp)$/i.test(name ?? "");
}
