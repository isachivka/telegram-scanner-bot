import { describe, expect, it } from "vitest";
import { FileLinks, contentTypeFor, safeRelativePath } from "../src/mcp/files.js";
import { loadConfig } from "../src/config.js";
import { baseEnv } from "./helpers.js";

const http = loadConfig(
  baseEnv({
    MCP_HTTP_PORT: "8765",
    MCP_AUTH_TOKEN: "0123456789abcdef",
    FILE_LINK_TTL_SEC: "100",
  }),
).mcp.http!;

describe("safeRelativePath", () => {
  it("accepts plain nested paths and rejects traversal", () => {
    expect(safeRelativePath("a/b.pdf")).toBe("a/b.pdf");
    expect(safeRelativePath("/a//b.pdf/")).toBe("a/b.pdf");
    expect(() => safeRelativePath("../x")).toThrow();
    expect(() => safeRelativePath("a/../x")).toThrow();
    expect(() => safeRelativePath("a b")).toThrow();
    expect(() => safeRelativePath("")).toThrow();
  });
});

describe("FileLinks", () => {
  const links = new FileLinks(http, "/store");

  it("signs and verifies with expiry", () => {
    const now = 1_700_000_000_000;
    const p = links.signedPath("x/y.pdf", now);
    const url = new URL(`http://h${p}`);
    expect(url.pathname).toBe("/files/x/y.pdf");
    const exp = url.searchParams.get("exp");
    const sig = url.searchParams.get("sig");
    expect(exp).toBe(String(Math.floor(now / 1000) + 100));
    expect(links.verify("x/y.pdf", exp, sig, now)).toBe(true);
    expect(links.verify("x/y.pdf", exp, sig, now + 101_000)).toBe(false);
    expect(links.verify("x/z.pdf", exp, sig, now)).toBe(false);
    expect(links.verify("x/y.pdf", String(Number(exp) + 1), sig, now)).toBe(false);
    expect(links.verify("x/y.pdf", exp, null, now)).toBe(false);
    expect(links.verify("../etc", exp, sig, now)).toBe(false);
  });

  it("resolves and relativises paths inside the store only", () => {
    expect(links.resolve("a/b.pdf")).toBe("/store/a/b.pdf");
    expect(links.relative("/store/a/b.pdf")).toBe("a/b.pdf");
    expect(links.relative("/elsewhere/b.pdf")).toBeUndefined();
    expect(links.relative("/store")).toBeUndefined();
  });

  it("derives the origin from the request host unless PUBLIC_URL is set", () => {
    const extra = (headers: Record<string, string>) =>
      ({ requestInfo: { headers } }) as never;
    expect(links.baseUrl(extra({ host: "10.0.0.5:8765" }))).toBe("http://10.0.0.5:8765");
    expect(links.baseUrl(extra({ host: "s.lan", "x-forwarded-proto": "https" }))).toBe(
      "https://s.lan",
    );
    expect(links.baseUrl(undefined)).toBeUndefined();
    expect(links.url("a.pdf", undefined)).toMatch(/^\/files\/a\.pdf\?exp=/);
    const fixed = new FileLinks({ ...http, publicUrl: "https://pub" }, "/store");
    expect(fixed.baseUrl(extra({ host: "ignored" }))).toBe("https://pub");
  });

  it("recognises its own links", () => {
    expect(links.ownRelativePath("http://h:1/files/up/a.pdf?exp=1&sig=2")).toBe(
      "up/a.pdf",
    );
    expect(links.ownRelativePath("http://h:1/other/a.pdf")).toBeUndefined();
    expect(links.ownRelativePath("http://h:1/files/../x")).toBeUndefined();
    expect(links.ownRelativePath("not a url")).toBeUndefined();
  });
});

describe("contentTypeFor", () => {
  it("maps known extensions", () => {
    expect(contentTypeFor("a.pdf")).toBe("application/pdf");
    expect(contentTypeFor("a.JPG")).toBe("image/jpeg");
    expect(contentTypeFor("a.png")).toBe("image/png");
    expect(contentTypeFor("a.txt")).toMatch(/^text\/plain/);
    expect(contentTypeFor("a.bin")).toBe("application/octet-stream");
  });
});
