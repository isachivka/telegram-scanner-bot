import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMcpServer } from "../src/mcp/server.js";
import { createMcpHttpServer } from "../src/mcp/http.js";
import { createSandbox, type Sandbox } from "./helpers.js";

let sb: Sandbox;
beforeEach(async () => {
  sb = await createSandbox();
});
afterEach(() => sb.cleanup());

async function connect(sandbox: Sandbox) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer(sandbox.services);
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientTransport);
  return { client, close: () => Promise.all([client.close(), server.close()]) };
}

const textOf = (r: CallToolResult) =>
  r.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");

describe("mcp server", () => {
  it("advertises the tools and hides print tools without a printer", async () => {
    let { client, close } = await connect(sb);
    let names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "delete_scan",
      "get_scan",
      "list_scanners",
      "list_scans",
      "print_file",
      "print_text",
      "printer_status",
      "scan",
    ]);
    await close();

    await sb.cleanup();
    sb = await createSandbox({ PRINTER_QUEUE: undefined });
    ({ client, close } = await connect(sb));
    names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "delete_scan",
      "get_scan",
      "list_scanners",
      "list_scans",
      "scan",
    ]);
    await close();
  });

  it("scans the flatbed, stores a PDF and returns the page image", async () => {
    const { client, close } = await connect(sb);
    const res = (await client.callTool({
      name: "scan",
      arguments: { mode: "Gray", dpi: 200, name: "invoice", include_images: true },
    })) as CallToolResult;
    expect(res.isError).toBeFalsy();
    expect(textOf(res)).toMatch(
      /^Scanned 1 page\(s\) at 200 dpi \(Gray\)\.\ninvoice: 1 page\(s\), \d+ bytes\nPDF: .*invoice\.pdf \(on the server\)$/,
    );
    const image = res.content.find((c) => c.type === "image");
    expect(image).toMatchObject({ type: "image", mimeType: "image/jpeg" });
    expect(res.structuredContent).toMatchObject({
      name: "invoice",
      pages: 1,
      page_urls: [],
    });
    expect((res.structuredContent as { pdf_url?: string }).pdf_url).toBeUndefined();
    const pdfPath = (res.structuredContent as { pdf_path: string }).pdf_path;
    expect(pdfPath).toBe(path.join(sb.config.mcp.outputDir, "invoice.pdf"));
    expect((await stat(pdfPath)).size).toBeGreaterThan(0);
    expect((await sb.calls())[0]).toMatch(
      /^scanimage --device-name=airscan:e0:Scanner --mode=Gray --resolution=200 --format=jpeg --output-file=.*invoice\/page_001\.jpg$/,
    );
    await close();
  });

  it("scans the feeder and caps inline images", async () => {
    process.env.FAKE_ADF_PAGES = "12";
    process.env.FAKE_ADF_EXIT7 = "1";
    const { client, close } = await connect(sb);
    const res = (await client.callTool({
      name: "scan",
      arguments: { source: "feeder", include_images: true },
    })) as CallToolResult;
    expect(res.isError).toBeFalsy();
    expect(res.content.filter((c) => c.type === "image")).toHaveLength(10);
    expect(textOf(res)).toMatch(/Only the first 10 pages are inlined/);
    expect(res.structuredContent).toMatchObject({ pages: 12 });
    expect(await sb.calls()).toEqual([
      expect.stringMatching(/--source=ADF --batch=.*page_%03d\.jpg --batch-start=1$/),
      expect.stringMatching(/^img2pdf .*page_001\.jpg .*page_012\.jpg -o /),
    ]);
    await close();
  });

  it("returns no images by default and reports scanner errors and an empty feeder", async () => {
    const { client, close } = await connect(sb);
    let res = (await client.callTool({ name: "scan", arguments: {} })) as CallToolResult;
    expect(res.content.some((c) => c.type === "image")).toBe(false);
    expect(res.content).toHaveLength(1);

    process.env.FAKE_ADF_PAGES = "0";
    process.env.FAKE_ADF_EXIT7 = "1";
    res = (await client.callTool({
      name: "scan",
      arguments: { source: "feeder" },
    })) as CallToolResult;
    expect(res.isError).toBe(true);
    expect(textOf(res)).toBe("the document feeder is empty");

    process.env.FAKE_SCAN_FAIL = "1";
    res = (await client.callTool({ name: "scan", arguments: {} })) as CallToolResult;
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/Device busy/);
    await close();
  });

  it("rejects invalid dpi and feeder scans without SCAN_ADF_SOURCE", async () => {
    await sb.cleanup();
    sb = await createSandbox({ SCAN_ADF_SOURCE: undefined });
    const { client, close } = await connect(sb);
    let res = (await client.callTool({
      name: "scan",
      arguments: { dpi: 1234 },
    })) as CallToolResult;
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/dpi must be one of 200, 300, 600/);
    res = (await client.callTool({
      name: "scan",
      arguments: { source: "feeder" },
    })) as CallToolResult;
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/no document feeder configured/);
    await close();
  });

  it("lists, fetches (images and pdf), exposes as resources, and deletes scans", async () => {
    const { client, close } = await connect(sb);
    await client.callTool({
      name: "scan",
      arguments: { name: "a", include_images: false },
    });
    await client.callTool({
      name: "scan",
      arguments: { name: "b", include_images: false },
    });

    const list = (await client.callTool({
      name: "list_scans",
      arguments: {},
    })) as CallToolResult;
    const scans = (list.structuredContent as { scans: { name: string; pages: number }[] })
      .scans;
    expect(scans.map((s) => s.name).sort()).toEqual(["a", "b"]);
    expect(scans[0]).toMatchObject({ pages: 1 });

    const linksOnly = (await client.callTool({
      name: "get_scan",
      arguments: { name: "a" },
    })) as CallToolResult;
    expect(linksOnly.content).toHaveLength(1);
    expect(textOf(linksOnly)).toMatch(
      /^a: 1 page\(s\), \d+ bytes\nPDF: .*a\.pdf \(on the server\)$/,
    );
    expect(linksOnly.structuredContent).toMatchObject({ name: "a", pages: 1 });

    const images = (await client.callTool({
      name: "get_scan",
      arguments: { name: "a", as: "images" },
    })) as CallToolResult;
    expect(images.content.filter((c) => c.type === "image")).toHaveLength(1);

    const pdf = (await client.callTool({
      name: "get_scan",
      arguments: { name: "a.pdf", as: "pdf" },
    })) as CallToolResult;
    const blob = pdf.content.find((c) => c.type === "resource") as {
      resource: { uri: string; mimeType: string; blob: string };
    };
    expect(blob.resource).toMatchObject({
      uri: "scan://a.pdf",
      mimeType: "application/pdf",
    });
    expect(Buffer.from(blob.resource.blob, "base64").toString()).toMatch(/^%PDF/);

    const resources = await client.listResources();
    expect(resources.resources.map((r) => r.uri).sort()).toEqual([
      "scan://a.pdf",
      "scan://b.pdf",
    ]);
    const read = await client.readResource({ uri: "scan://b.pdf" });
    expect(read.contents[0]).toMatchObject({
      uri: "scan://b.pdf",
      mimeType: "application/pdf",
    });
    expect(
      Buffer.from((read.contents[0] as { blob: string }).blob, "base64").toString(),
    ).toMatch(/^%PDF/);

    const missing = (await client.callTool({
      name: "get_scan",
      arguments: { name: "nope" },
    })) as CallToolResult;
    expect(missing.isError).toBe(true);
    const bad = (await client.callTool({
      name: "get_scan",
      arguments: { name: "../etc/passwd" },
    })) as CallToolResult;
    expect(bad.isError).toBe(true);
    expect(textOf(bad)).toMatch(/invalid scan name/);

    expect(
      textOf(
        (await client.callTool({
          name: "delete_scan",
          arguments: { name: "a" },
        })) as CallToolResult,
      ),
    ).toBe("deleted a");
    expect(
      textOf(
        (await client.callTool({
          name: "delete_scan",
          arguments: { name: "a" },
        })) as CallToolResult,
      ),
    ).toBe("nothing to delete: a");
    expect((await client.listResources()).resources.map((r) => r.uri)).toEqual([
      "scan://b.pdf",
    ]);
    await close();
  });

  it("lists scanners and printer status", async () => {
    const { client, close } = await connect(sb);
    const scanners = (await client.callTool({
      name: "list_scanners",
      arguments: {},
    })) as CallToolResult;
    expect(textOf(scanners)).toContain("Configured device: airscan:e0:Scanner");
    expect(textOf(scanners)).toContain(
      "airscan:e0:Fake MFP — eSCL Fake MFP ip=192.0.2.10",
    );
    const printer = (await client.callTool({
      name: "printer_status",
      arguments: {},
    })) as CallToolResult;
    expect(textOf(printer)).toMatch(/printer FakeQueue is idle/);
    await close();
  });

  it("prints text, server-side files, uploaded images, and rejects unknown types", async () => {
    const { client, close } = await connect(sb);

    let res = (await client.callTool({
      name: "print_text",
      arguments: { text: "milk\neggs", copies: 2 },
    })) as CallToolResult;
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toMatchObject({
      job_id: "FakeQueue-42",
      queue: "FakeQueue",
      copies: 2,
    });
    expect((await sb.calls()).at(-1)).toMatch(/^lp -d FakeQueue -n 2 -- .*text\.txt$/);

    const scan = (await client.callTool({
      name: "scan",
      arguments: { name: "doc", include_images: false },
    })) as CallToolResult;
    const pdfPath = (scan.structuredContent as { pdf_path: string }).pdf_path;
    res = (await client.callTool({
      name: "print_file",
      arguments: { path: pdfPath },
    })) as CallToolResult;
    expect(res.isError).toBeFalsy();
    expect((await sb.calls()).at(-1)).toBe(`lp -d FakeQueue -n 1 -- ${pdfPath}`);

    const jpeg = await readFile(
      path.join(sb.config.mcp.outputDir, "doc", "page_001.jpg"),
    );
    res = (await client.callTool({
      name: "print_file",
      arguments: {
        content_base64: jpeg.toString("base64"),
        filename: "photo.jpg",
        copies: 3,
      },
    })) as CallToolResult;
    expect(res.isError).toBeFalsy();
    const calls = await sb.calls();
    expect(calls.at(-2)).toMatch(/^img2pdf .*photo\.jpg -o .*photo\.jpg\.pdf$/);
    expect(calls.at(-1)).toMatch(/^lp -d FakeQueue -n 3 -- .*photo\.jpg\.pdf$/);

    res = (await client.callTool({
      name: "print_file",
      arguments: { content_base64: "AAAA", filename: "virus.exe" },
    })) as CallToolResult;
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/unsupported file type/);

    res = (await client.callTool({
      name: "print_file",
      arguments: {},
    })) as CallToolResult;
    expect(res.isError).toBe(true);

    process.env.FAKE_LP_FAIL = "1";
    res = (await client.callTool({
      name: "print_text",
      arguments: { text: "x" },
    })) as CallToolResult;
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/printer or class does not exist/);
    await close();
  });
});

describe("mcp over http", () => {
  const TOKEN = "correct-horse-battery-staple";

  async function listen(sandbox: Sandbox) {
    const server = createMcpHttpServer(sandbox.services);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as AddressInfo;
    return {
      url: `http://127.0.0.1:${port}/mcp`,
      base: `http://127.0.0.1:${port}`,
      close: () => new Promise<void>((r) => server.close(() => r())),
    };
  }

  async function connectHttp(url: string, token = TOKEN) {
    const client = new Client({ name: "test", version: "0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(url), {
        requestInit: { headers: { authorization: `Bearer ${token}` } },
      }),
    );
    return client;
  }

  it("requires the bearer token and serves tools to authenticated clients", async () => {
    await sb.cleanup();
    sb = await createSandbox({ MCP_HTTP_PORT: "1", MCP_AUTH_TOKEN: TOKEN });
    const { url, base, close } = await listen(sb);
    try {
      expect((await fetch(`${base}/healthz`)).status).toBe(200);
      expect((await fetch(`${base}/other`)).status).toBe(404);

      const unauth = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      });
      expect(unauth.status).toBe(401);
      const wrong = await fetch(url, {
        method: "POST",
        headers: { authorization: "Bearer nope", "content-type": "application/json" },
        body: "{}",
      });
      expect(wrong.status).toBe(401);

      const client = await connectHttp(url);
      const tools = (await client.listTools()).tools.map((t) => t.name);
      expect(tools).toContain("scan");
      await client.close();
    } finally {
      await close();
    }
  });

  it("returns signed links for scans that work without the bearer header", async () => {
    await sb.cleanup();
    sb = await createSandbox({
      MCP_HTTP_PORT: "1",
      MCP_AUTH_TOKEN: TOKEN,
      FILE_LINK_TTL_SEC: "60",
    });
    const { url, base, close } = await listen(sb);
    try {
      const client = await connectHttp(url);
      const res = (await client.callTool({
        name: "scan",
        arguments: { name: "http" },
      })) as CallToolResult;
      expect(res.isError).toBeFalsy();
      const d = res.structuredContent as { pdf_url: string; page_urls: string[] };
      expect(d.pdf_url).toMatch(
        new RegExp(`^${base}/files/http\\.pdf\\?exp=\\d+&sig=[0-9a-f]{64}$`),
      );
      expect(d.page_urls).toHaveLength(1);
      expect(d.page_urls[0]).toMatch(
        new RegExp(`^${base}/files/http/page_001\\.jpg\\?exp=`),
      );
      expect(textOf(res)).toContain(`PDF: ${d.pdf_url}`);
      expect(textOf(res)).toContain(`page 1: ${d.page_urls[0]}`);

      // Signed link: no auth header needed, right content type.
      const pdf = await fetch(d.pdf_url);
      expect(pdf.status).toBe(200);
      expect(pdf.headers.get("content-type")).toBe("application/pdf");
      expect(pdf.headers.get("content-disposition")).toBe('inline; filename="http.pdf"');
      expect(await pdf.text()).toMatch(/^%PDF/);
      const jpg = await fetch(d.page_urls[0]!);
      expect(jpg.status).toBe(200);
      expect(jpg.headers.get("content-type")).toBe("image/jpeg");
      expect((await fetch(d.pdf_url, { method: "HEAD" })).status).toBe(200);

      // Tampered, expired, missing, and traversal.
      expect(
        (await fetch(d.pdf_url.replace(/sig=[0-9a-f]+/, `sig=${"0".repeat(64)}`))).status,
      ).toBe(403);
      const expired = d.pdf_url.replace(/exp=\d+/, "exp=1000000000");
      expect((await fetch(expired)).status).toBe(403);
      expect((await fetch(`${base}/files/http.pdf`)).status).toBe(401);
      expect((await fetch(`${base}/files/nope.pdf?exp=9999999999&sig=x`)).status).toBe(
        403,
      );
      expect((await fetch(`${base}/files/..%2F..%2Fetc%2Fpasswd`)).status).toBe(400);
      // Bearer header works instead of a signature.
      const viaBearer = await fetch(`${base}/files/http.pdf`, {
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      expect(viaBearer.status).toBe(200);
      expect(
        (
          await fetch(`${base}/files/missing.pdf`, {
            headers: { authorization: `Bearer ${TOKEN}` },
          })
        ).status,
      ).toBe(404);

      // list_scans and get_scan carry the same links.
      const list = (await client.callTool({
        name: "list_scans",
        arguments: {},
      })) as CallToolResult;
      expect(
        (list.structuredContent as { scans: { pdf_url: string }[] }).scans[0]!.pdf_url,
      ).toMatch(/\/files\/http\.pdf\?exp=/);
      const get = (await client.callTool({
        name: "get_scan",
        arguments: { name: "http" },
      })) as CallToolResult;
      expect(textOf(get)).toMatch(
        /^http: 1 page\(s\).*\nPDF: http:\/\/127\.0\.0\.1:\d+\/files\/http\.pdf\?exp=/,
      );
      await client.close();
    } finally {
      await close();
    }
  });

  it("honours PUBLIC_URL and X-Forwarded-Proto for link origins", async () => {
    await sb.cleanup();
    sb = await createSandbox({
      MCP_HTTP_PORT: "1",
      MCP_AUTH_TOKEN: TOKEN,
      PUBLIC_URL: "https://scanner.example.net/",
    });
    const { url, close } = await listen(sb);
    try {
      const client = await connectHttp(url);
      const res = (await client.callTool({
        name: "scan",
        arguments: { name: "pub" },
      })) as CallToolResult;
      expect((res.structuredContent as { pdf_url: string }).pdf_url).toMatch(
        /^https:\/\/scanner\.example\.net\/files\/pub\.pdf\?exp=/,
      );
      await client.close();
    } finally {
      await close();
    }
  });

  it("accepts uploads and prints by path, own link, and external url", async () => {
    await sb.cleanup();
    sb = await createSandbox({
      MCP_HTTP_PORT: "1",
      MCP_AUTH_TOKEN: TOKEN,
      UPLOAD_MAX_MB: "0.001",
    });
    const { url, base, close } = await listen(sb);
    // A third-party file server the bot should be able to download from.
    const external = createServer((req, res) => {
      if (req.url === "/doc.pdf") {
        res
          .writeHead(200, { "content-type": "application/pdf" })
          .end("%PDF-1.4 external");
      } else if (req.url === "/noext") {
        res.writeHead(200, { "content-type": "image/png" }).end("png-bytes");
      } else {
        res.writeHead(404).end();
      }
    });
    await new Promise<void>((r) => external.listen(0, "127.0.0.1", r));
    const extBase = `http://127.0.0.1:${(external.address() as AddressInfo).port}`;
    try {
      // Upload needs the bearer and must target uploads/<name>.
      expect(
        (
          await fetch(`${base}/files/uploads/a.pdf`, {
            method: "PUT",
            body: "%PDF-1.4 up",
          })
        ).status,
      ).toBe(401);
      expect(
        (
          await fetch(`${base}/files/other/a.pdf`, {
            method: "PUT",
            headers: { authorization: `Bearer ${TOKEN}` },
            body: "%PDF-1.4 up",
          })
        ).status,
      ).toBe(400);
      const tooBig = await fetch(`${base}/files/uploads/big.pdf`, {
        method: "PUT",
        headers: { authorization: `Bearer ${TOKEN}` },
        body: Buffer.alloc(5000),
      });
      expect(tooBig.status).toBe(413);
      const up = await fetch(`${base}/files/uploads/a.pdf`, {
        method: "PUT",
        headers: { authorization: `Bearer ${TOKEN}` },
        body: "%PDF-1.4 up",
      });
      expect(up.status).toBe(201);
      const uploaded = (await up.json()) as { path: string; url: string; bytes: number };
      expect(uploaded).toMatchObject({ path: "uploads/a.pdf", bytes: 11 });
      expect(uploaded.url).toMatch(new RegExp(`^${base}/files/uploads/a\\.pdf\\?exp=`));
      expect(await (await fetch(uploaded.url)).text()).toBe("%PDF-1.4 up");

      const client = await connectHttp(url);
      // by relative path
      let res = (await client.callTool({
        name: "print_file",
        arguments: { path: "uploads/a.pdf", copies: 2 },
      })) as CallToolResult;
      expect(res.isError).toBeFalsy();
      expect((await sb.calls()).at(-1)).toBe(
        `lp -d FakeQueue -n 2 -- ${sb.config.mcp.outputDir}/uploads/a.pdf`,
      );
      // by our own signed link: resolved locally, no download
      res = (await client.callTool({
        name: "print_file",
        arguments: { url: uploaded.url },
      })) as CallToolResult;
      expect(res.isError).toBeFalsy();
      expect(textOf(res)).toMatch(/^sent a\.pdf to FakeQueue: job FakeQueue-42, 1 copy$/);
      expect((await sb.calls()).at(-1)).toBe(
        `lp -d FakeQueue -n 1 -- ${sb.config.mcp.outputDir}/uploads/a.pdf`,
      );
      // by external url
      res = (await client.callTool({
        name: "print_file",
        arguments: { url: `${extBase}/doc.pdf` },
      })) as CallToolResult;
      expect(res.isError).toBeFalsy();
      expect((await sb.calls()).at(-1)).toMatch(
        /^lp -d FakeQueue -n 1 -- .*mcp-prints\/[0-9a-f-]+\/doc\.pdf$/,
      );
      // extension inferred from content-type, image wrapped into a PDF
      res = (await client.callTool({
        name: "print_file",
        arguments: { url: `${extBase}/noext` },
      })) as CallToolResult;
      expect(res.isError).toBeFalsy();
      expect((await sb.calls()).at(-2)).toMatch(
        /^img2pdf .*noext\.png -o .*noext\.png\.pdf$/,
      );
      // 404 upstream
      res = (await client.callTool({
        name: "print_file",
        arguments: { url: `${extBase}/missing.pdf` },
      })) as CallToolResult;
      expect(res.isError).toBe(true);
      expect(textOf(res)).toMatch(/HTTP 404/);
      // a scan's pdf_path still works
      const scan = (await client.callTool({
        name: "scan",
        arguments: { name: "s" },
      })) as CallToolResult;
      res = (await client.callTool({
        name: "print_file",
        arguments: { path: (scan.structuredContent as { pdf_path: string }).pdf_path },
      })) as CallToolResult;
      expect(res.isError).toBeFalsy();
      await client.close();
    } finally {
      external.close();
      await close();
    }
  });
});
