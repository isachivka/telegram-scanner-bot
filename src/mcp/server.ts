import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
  CallToolResult,
  ServerNotification,
  ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Services } from "../core/services.js";
import { scanFileName } from "../core/services.js";
import { imagesToPdf, isImage, isPdf } from "../core/pdf.js";
import { errorMessage } from "../util/exec.js";
import { FileLinks, UPLOADS_DIR } from "./files.js";
import { ScanStore, type StoredScan } from "./store.js";

export const MCP_SERVER_NAME = "scanner-bot";
export const MCP_SERVER_VERSION = "1.1.1";

/** Inline more pages than this and the response becomes too large for most clients. */
const MAX_INLINE_PAGES = 10;

const SCAN_URI_PREFIX = "scan://";

type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>;

function textResult(text: string, structured?: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text }],
    ...(structured ? { structuredContent: structured } : {}),
  };
}

function errorResult(err: unknown): CallToolResult {
  return { content: [{ type: "text", text: errorMessage(err) }], isError: true };
}

export interface McpServerOptions {
  /** Override for tests; defaults to `config.mcp.outputDir`. */
  outputDir?: string;
}

export function createMcpServer(
  services: Services,
  opts: McpServerOptions = {},
): McpServer {
  const { config, scanner, printer, log } = services;
  const outputDir = opts.outputDir ?? config.mcp.outputDir;
  const store = new ScanStore(outputDir);
  const links = config.mcp.http ? new FileLinks(config.mcp.http, outputDir) : undefined;
  const mime = scanner.format === "jpeg" ? "image/jpeg" : "image/png";

  /** Signed URL for a file inside the store, when an HTTP endpoint exists. */
  const linkTo = (absolute: string, extra?: Extra): string | undefined => {
    const rel = links?.relative(absolute);
    return rel ? links!.url(rel, extra) : undefined;
  };

  const describeScan = (s: StoredScan, extra?: Extra) => ({
    name: s.name,
    pages: s.pagePaths.length,
    bytes: s.bytes,
    created_at: s.createdAt.toISOString(),
    pdf_path: s.pdfPath,
    pdf_url: linkTo(s.pdfPath, extra),
    page_paths: s.pagePaths,
    page_urls: s.pagePaths.map((p) => linkTo(p, extra)).filter((u): u is string => !!u),
  });

  const scanSummary = (d: ReturnType<typeof describeScan>): string => {
    const lines = [`${d.name}: ${d.pages} page(s), ${d.bytes} bytes`];
    lines.push(d.pdf_url ? `PDF: ${d.pdf_url}` : `PDF: ${d.pdf_path} (on the server)`);
    if (d.page_urls.length) {
      lines.push(...d.page_urls.map((u, i) => `page ${i + 1}: ${u}`));
    }
    return lines.join("\n");
  };

  const pageImages = async (paths: string[]): Promise<CallToolResult["content"]> =>
    Promise.all(
      paths.map(async (p) => ({
        type: "image" as const,
        data: (await readFile(p)).toString("base64"),
        mimeType: mime,
      })),
    );

  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    {
      instructions: [
        "This server controls a physical document scanner and, optionally, a printer on the user's network.",
        "Files travel as links, not as inline blobs: `scan` stores a PDF plus page images on the server and",
        "returns signed URLs (valid for a limited time, no auth header needed) that you can download with",
        "curl or hand to the user. To *read* a scanned page yourself, call `get_scan` with as=images, or",
        "pass include_images=true to `scan` — only do that when you actually need to look at the content.",
        "Scanning takes 10–60 seconds per page; do not retry while a scan is in progress.",
        printer
          ? "To print, prefer `print_file` with a `url` (any http(s) file, including this server's own links) or a server `path`; `print_text` prints plain text."
          : "Printing is not configured on this server.",
      ].join(" "),
    },
  );

  const modes = config.scanner.modes;
  const dpis = config.scanner.dpiOptions;

  server.registerTool(
    "scan",
    {
      title: "Scan a document",
      description: [
        "Scan the page on the scanner glass (source=flatbed, default) or every sheet in the",
        "automatic document feeder (source=feeder). The result is stored on the server as a PDF",
        "plus per-page images; you get download links (and paths). Set include_images=true only",
        "when you need to read the pages yourself.",
        `Modes: ${modes.join(", ")}. Resolutions: ${dpis.join(", ")} dpi (low dpi for reading text, high for archiving).`,
        config.scanner.adfSource
          ? "The document feeder is available."
          : "No document feeder is configured; only flatbed scans are possible.",
      ].join(" "),
      inputSchema: {
        source: z
          .enum(["flatbed", "feeder"])
          .default("flatbed")
          .describe("flatbed = one page from the glass; feeder = all sheets in the ADF"),
        mode: z.enum(modes as [string, ...string[]]).default(config.scanner.defaultMode),
        dpi: z
          .number()
          .int()
          .refine((d) => dpis.includes(d), {
            message: `dpi must be one of ${dpis.join(", ")}`,
          })
          .default(config.scanner.defaultDpi),
        name: z
          .string()
          .regex(/^[A-Za-z0-9._-]+$/)
          .optional()
          .describe(
            "File name for the stored PDF (without extension). Default: scan-<timestamp>",
          ),
        include_images: z
          .boolean()
          .default(false)
          .describe(
            `Also return the page images inline (first ${MAX_INLINE_PAGES} pages) so you can read them`,
          ),
      },
      outputSchema: {
        name: z.string(),
        pages: z.number(),
        bytes: z.number(),
        created_at: z.string(),
        pdf_path: z.string(),
        pdf_url: z.string().optional(),
        page_paths: z.array(z.string()),
        page_urls: z.array(z.string()),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (
      { source, mode, dpi, name, include_images },
      extra,
    ): Promise<CallToolResult> => {
      if (scanner.isBusy()) {
        return errorResult(
          "scanner is busy with another job; wait for it to finish and retry",
        );
      }
      if (source === "feeder" && !config.scanner.adfSource) {
        return errorResult("no document feeder configured (SCAN_ADF_SOURCE is unset)");
      }
      await store.ensure();
      const base = name ?? scanFileName("pdf").replace(/\.pdf$/, "");
      const pagesDir = store.pagesDir(base);
      await rm(pagesDir, { recursive: true, force: true });
      await mkdir(pagesDir, { recursive: true });
      let pagePaths: string[];
      try {
        if (source === "feeder") {
          ({ pages: pagePaths } = await scanner.scanFeeder(pagesDir, 1, { mode, dpi }));
        } else {
          const out = path.join(pagesDir, `page_001.${scanner.extension}`);
          await scanner.scanPage(out, { mode, dpi });
          pagePaths = [out];
        }
      } catch (err) {
        log.error({ err }, "mcp scan failed");
        await rm(pagesDir, { recursive: true, force: true });
        return errorResult(err);
      }
      if (pagePaths.length === 0) {
        await rm(pagesDir, { recursive: true, force: true });
        return errorResult("the document feeder is empty");
      }
      await imagesToPdf(pagePaths, store.pdfPath(base));
      const d = describeScan((await store.get(base))!, extra);

      const content: CallToolResult["content"] = [
        {
          type: "text",
          text: `Scanned ${d.pages} page(s) at ${dpi} dpi (${mode}).\n${scanSummary(d)}`,
        },
      ];
      if (include_images) {
        content.push(...(await pageImages(pagePaths.slice(0, MAX_INLINE_PAGES))));
        if (pagePaths.length > MAX_INLINE_PAGES) {
          content.push({
            type: "text",
            text: `Only the first ${MAX_INLINE_PAGES} pages are inlined; use get_scan with page=N for the rest.`,
          });
        }
      }
      return { content, structuredContent: d };
    },
  );

  server.registerTool(
    "list_scans",
    {
      title: "List stored scans",
      description:
        "List scans previously produced by `scan`, newest first, with download links.",
      outputSchema: {
        scans: z.array(
          z.object({
            name: z.string(),
            pages: z.number(),
            bytes: z.number(),
            created_at: z.string(),
            pdf_path: z.string(),
            pdf_url: z.string().optional(),
          }),
        ),
      },
      annotations: { readOnlyHint: true },
    },
    async (extra) => {
      const scans = (await store.list()).map((s) => {
        const d = describeScan(s, extra);
        return {
          name: d.name,
          pages: d.pages,
          bytes: d.bytes,
          created_at: d.created_at,
          pdf_path: d.pdf_path,
          pdf_url: d.pdf_url,
        };
      });
      const text = scans.length
        ? scans
            .map(
              (s) =>
                `${s.name}: ${s.pages} page(s), ${s.bytes} bytes, ${s.created_at}${s.pdf_url ? `\n  ${s.pdf_url}` : ""}`,
            )
            .join("\n")
        : "no scans stored";
      return textResult(text, { scans });
    },
  );

  server.registerTool(
    "get_scan",
    {
      title: "Fetch a stored scan",
      description:
        "A stored scan as download links (as=links, default), as page images you can read (as=images, optional page), or as the PDF bytes (as=pdf, base64 — large, avoid unless there is no other way to get the file).",
      inputSchema: {
        name: z.string().describe("Scan name from `list_scans` (with or without .pdf)"),
        as: z.enum(["links", "images", "pdf"]).default("links"),
        page: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "With as=images: return only this page (1-based); default: first 10 pages",
          ),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ name, as, page }, extra) => {
      let scan;
      try {
        scan = await store.get(name);
      } catch (err) {
        return errorResult(err);
      }
      if (!scan) return errorResult(`scan not found: ${name}`);
      const d = describeScan(scan, extra);
      if (as === "links") {
        return textResult(scanSummary(d), d);
      }
      if (as === "pdf") {
        const data = await store.readPdf(scan.name);
        return {
          content: [
            { type: "text", text: `${scan.name}.pdf, ${data.length} bytes` },
            {
              type: "resource",
              resource: {
                uri: `${SCAN_URI_PREFIX}${scan.name}.pdf`,
                mimeType: "application/pdf",
                blob: data.toString("base64"),
              },
            },
          ],
          structuredContent: d,
        };
      }
      if (scan.pagePaths.length === 0) {
        return errorResult(
          `no page images stored for ${scan.name}; fetch it as=pdf instead`,
        );
      }
      const selected = page
        ? [scan.pagePaths[page - 1]]
        : scan.pagePaths.slice(0, MAX_INLINE_PAGES);
      if (selected.some((p) => p === undefined)) {
        return errorResult(
          `page ${page} does not exist (${scan.pagePaths.length} pages)`,
        );
      }
      return {
        content: [
          { type: "text", text: `${scan.name}: ${scan.pagePaths.length} page(s)` },
          ...(await pageImages(selected as string[])),
        ],
        structuredContent: d,
      };
    },
  );

  server.registerTool(
    "delete_scan",
    {
      title: "Delete a stored scan",
      description: "Delete a stored scan (PDF and its page images) from the server.",
      inputSchema: { name: z.string() },
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async ({ name }) => {
      try {
        const existed = await store.remove(name);
        return textResult(existed ? `deleted ${name}` : `nothing to delete: ${name}`);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "list_scanners",
    {
      title: "List scanners",
      description:
        "List the SANE scanner devices visible to the server and which one is configured.",
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        const devices = await scanner.listDevices();
        const lines = devices.map((d) => `${d.name} — ${d.description}`);
        const configured = config.scanner.device ?? "(first device SANE finds)";
        return textResult(
          `Configured device: ${configured}\n` +
            (lines.length
              ? `Visible devices:\n${lines.join("\n")}`
              : "No devices visible"),
          { configured: config.scanner.device ?? null, devices },
        );
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  if (printer) {
    server.registerTool(
      "printer_status",
      {
        title: "Printer status",
        description: `State of the configured CUPS queue (${printer.queue}).`,
        annotations: { readOnlyHint: true },
      },
      async () => {
        try {
          return textResult(await printer.status(), { queue: printer.queue });
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    const printTmp = path.join(config.scanner.tmpDir, "mcp-prints");
    const maxBytes = config.mcp.http?.uploadMaxBytes ?? 50 * 1024 * 1024;

    server.registerTool(
      "print_file",
      {
        title: "Print a file",
        description: [
          "Print a PDF, image, or plain-text file. Give ONE of:",
          "`url` — any http(s) link the server can download, including this server's own /files/ links;",
          "`path` — a file on the server (a scan's pdf_path, or `uploads/<name>` after a PUT /files/uploads/<name>);",
          "`content_base64` + `filename` — raw bytes, only for small files.",
          "Images are wrapped into a PDF; text is printed as-is by CUPS.",
        ].join(" "),
        inputSchema: {
          url: z.string().url().optional().describe("http(s) URL of the file to print"),
          path: z
            .string()
            .optional()
            .describe("Absolute server path, or a path relative to the scan store"),
          content_base64: z
            .string()
            .optional()
            .describe("File bytes, base64 (small files only)"),
          filename: z
            .string()
            .optional()
            .describe(
              "Name with extension (.pdf/.png/.jpg/.txt); required with content_base64, optional with url",
            ),
          copies: z.number().int().min(1).max(99).default(1),
        },
        annotations: { destructiveHint: false, idempotentHint: false },
      },
      async ({ url, path: filePath, content_base64, filename, copies }) => {
        const given = [url, filePath, content_base64].filter(
          (v) => v !== undefined,
        ).length;
        if (given !== 1) {
          return errorResult(
            "provide exactly one of `url`, `path`, or `content_base64` (+ `filename`)",
          );
        }
        const tmpDir = path.join(printTmp, randomUUID());
        try {
          let source: string;
          let name: string;
          const own = url && links ? links.ownRelativePath(url) : undefined;
          if (own) {
            source = links!.resolve(own);
            name = path.basename(own);
          } else if (url) {
            await mkdir(tmpDir, { recursive: true });
            const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
            if (!res.ok)
              return errorResult(`download failed: HTTP ${res.status} for ${url}`);
            const buf = Buffer.from(await res.arrayBuffer());
            if (buf.length > maxBytes)
              return errorResult(`file is larger than ${maxBytes} bytes`);
            name = path.basename(filename ?? new URL(url).pathname) || "download";
            if (!path.extname(name)) {
              const ct = res.headers.get("content-type") ?? "";
              name += ct.includes("pdf")
                ? ".pdf"
                : ct.includes("png")
                  ? ".png"
                  : ct.includes("jpeg")
                    ? ".jpg"
                    : ct.startsWith("text/")
                      ? ".txt"
                      : "";
            }
            source = path.join(tmpDir, name);
            await writeFile(source, buf);
          } else if (filePath) {
            source = path.isAbsolute(filePath)
              ? filePath
              : path.join(outputDir, filePath);
            if (!path.isAbsolute(filePath) && links) source = links.resolve(filePath);
            name = path.basename(source);
            await stat(source);
          } else {
            if (!filename)
              return errorResult("`filename` is required with `content_base64`");
            await mkdir(tmpDir, { recursive: true });
            name = path.basename(filename);
            source = path.join(tmpDir, name);
            await writeFile(source, Buffer.from(content_base64!, "base64"));
          }
          let toPrint = source;
          if (isImage(undefined, name)) {
            await mkdir(tmpDir, { recursive: true });
            toPrint = await imagesToPdf([source], path.join(tmpDir, `${name}.pdf`));
          } else if (!isPdf(undefined, name) && !/\.(txt|text|md)$/i.test(name)) {
            return errorResult(
              `unsupported file type: ${name} (use .pdf, an image, or .txt)`,
            );
          }
          const job = await printer.print(toPrint, { copies });
          return textResult(
            `sent ${name} to ${printer.queue}: job ${job.jobId}, ${copies} cop${copies === 1 ? "y" : "ies"}`,
            { job_id: job.jobId, queue: printer.queue, copies, file: name },
          );
        } catch (err) {
          log.error({ err }, "mcp print failed");
          return errorResult(err);
        } finally {
          await rm(tmpDir, { recursive: true, force: true });
        }
      },
    );

    server.registerTool(
      "print_text",
      {
        title: "Print text",
        description:
          "Print plain text — a note, a list, a letter. CUPS lays it out in a monospace font.",
        inputSchema: {
          text: z.string().min(1).max(200_000),
          copies: z.number().int().min(1).max(99).default(1),
        },
        annotations: { destructiveHint: false, idempotentHint: false },
      },
      async ({ text, copies }) => {
        const tmpDir = path.join(printTmp, randomUUID());
        try {
          await mkdir(tmpDir, { recursive: true });
          const file = path.join(tmpDir, "text.txt");
          await writeFile(file, text.endsWith("\n") ? text : `${text}\n`);
          const job = await printer.print(file, { copies });
          return textResult(`sent to ${printer.queue}: job ${job.jobId}`, {
            job_id: job.jobId,
            queue: printer.queue,
            copies,
          });
        } catch (err) {
          log.error({ err }, "mcp print_text failed");
          return errorResult(err);
        } finally {
          await rm(tmpDir, { recursive: true, force: true });
        }
      },
    );
  }

  server.registerResource(
    "scans",
    new ResourceTemplate(`${SCAN_URI_PREFIX}{name}`, {
      list: async () => ({
        resources: (await store.list()).map((s) => ({
          uri: `${SCAN_URI_PREFIX}${s.name}.pdf`,
          name: `${s.name}.pdf`,
          mimeType: "application/pdf",
          description: `${s.pagePaths.length} page(s), ${s.bytes} bytes, ${s.createdAt.toISOString()}`,
        })),
      }),
    }),
    {
      title: "Stored scans",
      description: "PDFs produced by the scan tool",
      mimeType: "application/pdf",
    },
    async (uri, { name }) => {
      const data = await store.readPdf(String(name));
      return {
        contents: [
          { uri: uri.href, mimeType: "application/pdf", blob: data.toString("base64") },
        ],
      };
    },
  );

  return server;
}

export { UPLOADS_DIR };
