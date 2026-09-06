import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Services } from "../core/services.js";
import { scanFileName } from "../core/services.js";
import { imagesToPdf, isImage, isPdf } from "../core/pdf.js";
import { errorMessage } from "../util/exec.js";
import { ScanStore } from "./store.js";

export const MCP_SERVER_NAME = "scanner-bot";
export const MCP_SERVER_VERSION = "1.0.0";

/** Inline more pages than this and the response becomes too large for most clients. */
const MAX_INLINE_PAGES = 10;

const SCAN_URI_PREFIX = "scan://";

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
  const store = new ScanStore(opts.outputDir ?? config.mcp.outputDir);
  const mime = scanner.format === "jpeg" ? "image/jpeg" : "image/png";

  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    {
      instructions: [
        "This server controls a physical document scanner and, optionally, a printer on the user's network.",
        "Call `scan` to digitise whatever is on the scanner glass (or in the document feeder) — the pages come back",
        "as images you can read directly, and a PDF is stored server-side (see `list_scans` / `get_scan`).",
        "Scanning takes 10–60 seconds per page; do not retry while a scan is in progress.",
        printer
          ? "Call `print_file` or `print_text` to print; `printer_status` shows the queue state."
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
        "automatic document feeder (source=feeder). Saves a PDF plus per-page images on the",
        "server and returns the page images inline so you can read the document.",
        `Modes: ${modes.join(", ")}. Resolutions: ${dpis.join(", ")} dpi (use a low dpi for reading text, high for archiving).`,
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
          .default(true)
          .describe(`Return page images inline (first ${MAX_INLINE_PAGES} pages)`),
      },
      outputSchema: {
        name: z.string(),
        pdf_path: z.string(),
        pages: z.number(),
        page_paths: z.array(z.string()),
        bytes: z.number(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ source, mode, dpi, name, include_images }): Promise<CallToolResult> => {
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
      const pdfPath = await imagesToPdf(pagePaths, store.pdfPath(base));
      const stored = (await store.get(base))!;

      const content: CallToolResult["content"] = [
        {
          type: "text",
          text:
            `Scanned ${pagePaths.length} page(s) at ${dpi} dpi (${mode}). ` +
            `Stored as ${pdfPath} (${stored.bytes} bytes); resource ${SCAN_URI_PREFIX}${base}.pdf`,
        },
      ];
      if (include_images) {
        for (const p of pagePaths.slice(0, MAX_INLINE_PAGES)) {
          content.push({
            type: "image",
            data: (await readFile(p)).toString("base64"),
            mimeType: mime,
          });
        }
        if (pagePaths.length > MAX_INLINE_PAGES) {
          content.push({
            type: "text",
            text: `Only the first ${MAX_INLINE_PAGES} pages are inlined; use get_scan for the rest.`,
          });
        }
      }
      return {
        content,
        structuredContent: {
          name: base,
          pdf_path: pdfPath,
          pages: pagePaths.length,
          page_paths: pagePaths,
          bytes: stored.bytes,
        },
      };
    },
  );

  server.registerTool(
    "list_scans",
    {
      title: "List stored scans",
      description: "List PDFs previously produced by `scan`, newest first.",
      outputSchema: {
        scans: z.array(
          z.object({
            name: z.string(),
            pdf_path: z.string(),
            pages: z.number(),
            bytes: z.number(),
            created_at: z.string(),
          }),
        ),
      },
      annotations: { readOnlyHint: true },
    },
    async () => {
      const scans = (await store.list()).map((s) => ({
        name: s.name,
        pdf_path: s.pdfPath,
        pages: s.pagePaths.length,
        bytes: s.bytes,
        created_at: s.createdAt.toISOString(),
      }));
      const text = scans.length
        ? scans
            .map(
              (s) => `${s.name}: ${s.pages} page(s), ${s.bytes} bytes, ${s.created_at}`,
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
        "Return a stored scan: its page images (as=images, default, so you can read it) or the PDF bytes (as=pdf, base64).",
      inputSchema: {
        name: z.string().describe("Scan name from `list_scans` (with or without .pdf)"),
        as: z.enum(["images", "pdf"]).default("images"),
        page: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Return only this page image (1-based); default: first 10 pages"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ name, as, page }) => {
      let scan;
      try {
        scan = await store.get(name);
      } catch (err) {
        return errorResult(err);
      }
      if (!scan) return errorResult(`scan not found: ${name}`);
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
      const content: CallToolResult["content"] = [
        { type: "text", text: `${scan.name}: ${scan.pagePaths.length} page(s)` },
      ];
      for (const p of selected as string[]) {
        content.push({
          type: "image",
          data: (await readFile(p)).toString("base64"),
          mimeType: mime,
        });
      }
      return { content };
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

    server.registerTool(
      "print_file",
      {
        title: "Print a file",
        description: [
          "Print a PDF, image or plain-text file. Provide either `path` (a file on the server,",
          "e.g. a stored scan's pdf_path) or `content_base64` + `filename` (file bytes from the client).",
          "Images are wrapped into a PDF; text is printed as-is by CUPS.",
        ].join(" "),
        inputSchema: {
          path: z.string().optional().describe("Absolute path of a file on the server"),
          content_base64: z.string().optional().describe("File bytes, base64"),
          filename: z
            .string()
            .optional()
            .describe(
              "Name with extension (.pdf/.png/.jpg/.txt), required with content_base64",
            ),
          copies: z.number().int().min(1).max(99).default(1),
        },
        annotations: { destructiveHint: false, idempotentHint: false },
      },
      async ({ path: filePath, content_base64, filename, copies }) => {
        let tmpDir: string | undefined;
        try {
          let source: string;
          let name: string;
          if (filePath) {
            source = filePath;
            name = path.basename(filePath);
          } else if (content_base64 && filename) {
            tmpDir = path.join(printTmp, randomUUID());
            await mkdir(tmpDir, { recursive: true });
            name = path.basename(filename);
            source = path.join(tmpDir, name);
            await writeFile(source, Buffer.from(content_base64, "base64"));
          } else {
            return errorResult(
              "provide either `path` or `content_base64` with `filename`",
            );
          }
          let toPrint = source;
          if (isImage(undefined, name)) {
            tmpDir ??= path.join(printTmp, randomUUID());
            await mkdir(tmpDir, { recursive: true });
            toPrint = await imagesToPdf([source], path.join(tmpDir, `${name}.pdf`));
          } else if (!isPdf(undefined, name) && !/\.(txt|text|md)$/i.test(name)) {
            return errorResult(
              `unsupported file type: ${name} (use .pdf, an image, or .txt)`,
            );
          }
          const job = await printer.print(toPrint, { copies });
          return textResult(
            `sent to ${printer.queue}: job ${job.jobId}, ${copies} cop${copies === 1 ? "y" : "ies"}`,
            {
              job_id: job.jobId,
              queue: printer.queue,
              copies,
            },
          );
        } catch (err) {
          log.error({ err }, "mcp print failed");
          return errorResult(err);
        } finally {
          if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
        }
      },
    );

    server.registerTool(
      "print_text",
      {
        title: "Print text",
        description:
          "Print plain text (a note, a list, a letter). CUPS lays it out in a monospace font.",
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
