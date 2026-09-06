import { createHmac, timingSafeEqual } from "node:crypto";
import path from "node:path";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
  ServerNotification,
  ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";
import type { Config } from "../config.js";

export const FILES_ROUTE = "/files/";
export const UPLOADS_DIR = "uploads";

const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

/**
 * Validate a path relative to the scan store: plain segments only, no
 * traversal. Returns the normalised relative path or throws.
 */
export function safeRelativePath(rel: string): string {
  const segments = rel.split("/").filter(Boolean);
  if (segments.length === 0) throw new Error("empty path");
  for (const s of segments) {
    if (!SAFE_SEGMENT.test(s) || s === "." || s === "..") {
      throw new Error(`invalid path segment: ${s}`);
    }
  }
  return segments.join("/");
}

export function contentTypeFor(file: string): string {
  const ext = path.extname(file).toLowerCase();
  switch (ext) {
    case ".pdf":
      return "application/pdf";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".txt":
    case ".text":
    case ".md":
      return "text/plain; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

/**
 * Signed, expiring links to files in the scan store. The MCP auth token is the
 * HMAC key, so a link can be opened without the bearer header (by a browser,
 * `curl`, another agent) but cannot be forged or extended.
 */
export class FileLinks {
  constructor(
    private readonly http: NonNullable<Config["mcp"]["http"]>,
    private readonly root: string,
  ) {}

  /** Absolute filesystem path for a store-relative path. */
  resolve(rel: string): string {
    return path.join(this.root, safeRelativePath(rel));
  }

  /** Store-relative path for an absolute path inside the store, or undefined. */
  relative(absolute: string): string | undefined {
    const rel = path.relative(this.root, absolute);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return undefined;
    return rel.split(path.sep).join("/");
  }

  private signature(rel: string, exp: number): string {
    return createHmac("sha256", this.http.authToken)
      .update(`${rel}\n${exp}`)
      .digest("hex");
  }

  /** `/files/<rel>?exp=…&sig=…` — path + query, without the origin. */
  signedPath(rel: string, now = Date.now()): string {
    const safe = safeRelativePath(rel);
    const exp = Math.floor((now + this.http.linkTtlMs) / 1000);
    const encoded = safe.split("/").map(encodeURIComponent).join("/");
    return `${FILES_ROUTE}${encoded}?exp=${exp}&sig=${this.signature(safe, exp)}`;
  }

  verify(rel: string, exp: string | null, sig: string | null, now = Date.now()): boolean {
    if (!exp || !sig || !/^\d+$/.test(exp)) return false;
    if (Number(exp) * 1000 < now) return false;
    let safe: string;
    try {
      safe = safeRelativePath(rel);
    } catch {
      return false;
    }
    const expected = Buffer.from(this.signature(safe, Number(exp)));
    const given = Buffer.from(sig);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  /**
   * Origin to prefix links with: PUBLIC_URL, else the Host the client used to
   * reach us (from the MCP request), else undefined (stdio without HTTP).
   */
  baseUrl(
    extra?: RequestHandlerExtra<ServerRequest, ServerNotification>,
  ): string | undefined {
    if (this.http.publicUrl) return this.http.publicUrl;
    const headers = extra?.requestInfo?.headers as
      Record<string, string | string[] | undefined> | undefined;
    const host = headers?.["host"] ?? headers?.["Host"];
    const first = Array.isArray(host) ? host[0] : host;
    if (!first) return undefined;
    const proto = headers?.["x-forwarded-proto"];
    const scheme =
      (Array.isArray(proto) ? proto[0] : proto)?.split(",")[0]?.trim() || "http";
    return `${scheme}://${first}`;
  }

  /** Full signed URL, or the bare `/files/...` path when the origin is unknown. */
  url(
    rel: string,
    extra?: RequestHandlerExtra<ServerRequest, ServerNotification>,
  ): string {
    const base = this.baseUrl(extra);
    const p = this.signedPath(rel);
    return base ? `${base}${p}` : p;
  }

  /** If `url` points at this server's /files/ route, the store-relative path it names. */
  ownRelativePath(url: string): string | undefined {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return undefined;
    }
    if (!parsed.pathname.startsWith(FILES_ROUTE)) return undefined;
    const rel = decodeURIComponent(parsed.pathname.slice(FILES_ROUTE.length));
    try {
      return safeRelativePath(rel);
    } catch {
      return undefined;
    }
  }
}
