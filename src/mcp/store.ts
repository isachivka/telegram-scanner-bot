import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";

export interface StoredScan {
  name: string;
  pdfPath: string;
  /** Page images kept next to the PDF in `<name>/page_NNN.<ext>`. */
  pagePaths: string[];
  bytes: number;
  createdAt: Date;
}

const SAFE_NAME = /^[A-Za-z0-9._-]+$/;

/**
 * Scans produced through MCP live in SCAN_OUTPUT_DIR as `<name>.pdf` plus a
 * `<name>/` folder with the page images, so clients can fetch either.
 */
export class ScanStore {
  constructor(readonly root: string) {}

  async ensure(): Promise<void> {
    await mkdir(this.root, { recursive: true });
  }

  validateName(name: string): string {
    const base = name.endsWith(".pdf") ? name.slice(0, -4) : name;
    if (!SAFE_NAME.test(base) || base === "." || base === "..") {
      throw new Error(`invalid scan name: ${name}`);
    }
    return base;
  }

  pdfPath(base: string): string {
    return path.join(this.root, `${base}.pdf`);
  }

  pagesDir(base: string): string {
    return path.join(this.root, base);
  }

  async get(name: string): Promise<StoredScan | undefined> {
    const base = this.validateName(name);
    const pdfPath = this.pdfPath(base);
    let st;
    try {
      st = await stat(pdfPath);
    } catch {
      return undefined;
    }
    let pagePaths: string[] = [];
    try {
      pagePaths = (await readdir(this.pagesDir(base)))
        .filter((f) => /^page_\d{3}\.(jpg|png)$/.test(f))
        .sort()
        .map((f) => path.join(this.pagesDir(base), f));
    } catch {
      /* no page folder */
    }
    return { name: base, pdfPath, pagePaths, bytes: st.size, createdAt: st.mtime };
  }

  async list(): Promise<StoredScan[]> {
    await this.ensure();
    const names = (await readdir(this.root)).filter((f) => f.endsWith(".pdf"));
    const scans = await Promise.all(names.map((n) => this.get(n)));
    return scans
      .filter((s): s is StoredScan => s !== undefined)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async remove(name: string): Promise<boolean> {
    const base = this.validateName(name);
    const existed = (await this.get(base)) !== undefined;
    await rm(this.pdfPath(base), { force: true });
    await rm(this.pagesDir(base), { recursive: true, force: true });
    return existed;
  }

  async readPdf(name: string): Promise<Buffer> {
    const base = this.validateName(name);
    return readFile(this.pdfPath(base));
  }
}
