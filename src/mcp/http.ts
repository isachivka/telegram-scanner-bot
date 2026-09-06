import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { randomUUID, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Services } from "../core/services.js";
import {
  FILES_ROUTE,
  FileLinks,
  UPLOADS_DIR,
  contentTypeFor,
  safeRelativePath,
} from "./files.js";
import { createMcpServer } from "./server.js";

function bearerMatches(header: string | undefined, token: string): boolean {
  if (!header) return false;
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return false;
  const a = Buffer.from(m[1]!);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

class PayloadTooLarge extends Error {
  constructor(public readonly limit: number) {
    super(`payload exceeds ${limit} bytes`);
  }
}

/** Read the whole body; over `limit` the rest is drained and discarded so a 413 can still be sent. */
function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > limit) {
      req.resume();
      reject(new PayloadTooLarge(limit));
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (tooLarge) return;
      if (size > limit) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(c);
    });
    req.on("end", () =>
      tooLarge ? reject(new PayloadTooLarge(limit)) : resolve(Buffer.concat(chunks)),
    );
    req.on("error", reject);
  });
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const raw = (await readBody(req, 64 * 1024 * 1024)).toString();
  return raw ? JSON.parse(raw) : undefined;
}

function json(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  res
    .writeHead(status, { "content-type": "application/json", ...headers })
    .end(JSON.stringify(body));
}

export interface McpHttpOptions {
  /** Override for tests; defaults to `config.mcp.outputDir`. */
  outputDir?: string;
}

/**
 * One HTTP server for everything the agent side needs:
 *   POST/GET/DELETE <MCP_HTTP_PATH>   MCP Streamable HTTP, bearer token required
 *   GET  /files/<rel>?exp&sig         download a stored file via a signed link (or bearer)
 *   PUT  /files/uploads/<name>        upload a file to print later (bearer required)
 *   GET  /healthz
 * All MCP sessions share the same scanner/printer services.
 */
export function createMcpHttpServer(
  services: Services,
  opts: McpHttpOptions = {},
): Server {
  const { config, log } = services;
  const http = config.mcp.http!;
  const outputDir = opts.outputDir ?? config.mcp.outputDir;
  const links = new FileLinks(http, outputDir);
  const sessions = new Map<string, StreamableHTTPServerTransport>();

  const authed = (req: IncomingMessage) =>
    bearerMatches(req.headers.authorization, http.authToken);
  const unauthorized = (req: IncomingMessage, res: ServerResponse) => {
    log.warn(
      { ip: req.socket.remoteAddress, path: req.url },
      "rejected request: bad credentials",
    );
    json(res, 401, { error: "unauthorized" }, { "www-authenticate": "Bearer" });
  };

  const handleFiles = async (
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<void> => {
    let rel: string;
    try {
      rel = safeRelativePath(decodeURIComponent(url.pathname.slice(FILES_ROUTE.length)));
    } catch {
      json(res, 400, { error: "invalid path" });
      return;
    }
    const absolute = links.resolve(rel);

    if (req.method === "GET" || req.method === "HEAD") {
      const hasSig = url.searchParams.has("sig");
      const signed =
        hasSig &&
        links.verify(rel, url.searchParams.get("exp"), url.searchParams.get("sig"));
      if (!signed && !authed(req)) {
        if (hasSig) json(res, 403, { error: "link invalid or expired" });
        else unauthorized(req, res);
        return;
      }
      let st;
      try {
        st = await stat(absolute);
      } catch {
        json(res, 404, { error: "not found" });
        return;
      }
      if (!st.isFile()) {
        json(res, 404, { error: "not found" });
        return;
      }
      res.writeHead(200, {
        "content-type": contentTypeFor(absolute),
        "content-length": st.size,
        "content-disposition": `inline; filename="${path.basename(absolute)}"`,
        "cache-control": "private, max-age=0",
      });
      if (req.method === "HEAD") res.end();
      else createReadStream(absolute).pipe(res);
      return;
    }

    if (req.method === "PUT") {
      if (!authed(req)) {
        unauthorized(req, res);
        return;
      }
      if (!rel.startsWith(`${UPLOADS_DIR}/`) || rel.split("/").length !== 2) {
        json(res, 400, {
          error: `uploads must go to ${FILES_ROUTE}${UPLOADS_DIR}/<name>`,
        });
        return;
      }
      let body: Buffer;
      try {
        body = await readBody(req, http.uploadMaxBytes);
      } catch (err) {
        if (err instanceof PayloadTooLarge) {
          json(res, 413, { error: err.message });
          return;
        }
        throw err;
      }
      await mkdir(path.dirname(absolute), { recursive: true });
      await writeFile(absolute, body);
      log.info(
        { path: rel, bytes: body.length, ip: req.socket.remoteAddress },
        "file uploaded",
      );
      const base = http.publicUrl ?? `http://${req.headers.host ?? "localhost"}`;
      json(res, 201, {
        path: rel,
        server_path: absolute,
        bytes: body.length,
        url: `${base}${links.signedPath(rel)}`,
      });
      return;
    }

    res.writeHead(405, { allow: "GET, HEAD, PUT" }).end();
  };

  const handleMcp = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!authed(req)) {
      unauthorized(req, res);
      return;
    }
    const sessionId = req.headers["mcp-session-id"];
    const existing = typeof sessionId === "string" ? sessions.get(sessionId) : undefined;

    if (req.method === "POST") {
      const body = await readJson(req);
      if (existing) {
        await existing.handleRequest(req, res, body);
        return;
      }
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          sessions.set(id, transport);
          log.info({ sessionId: id, ip: req.socket.remoteAddress }, "mcp session opened");
        },
        onsessionclosed: (id) => {
          sessions.delete(id);
          log.info({ sessionId: id }, "mcp session closed");
        },
      });
      transport.onclose = () => {
        if (transport.sessionId) sessions.delete(transport.sessionId);
      };
      const server = createMcpServer(services, { outputDir });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
      return;
    }

    if (req.method === "GET" || req.method === "DELETE") {
      if (!existing) {
        json(res, 400, { error: "missing or unknown mcp-session-id" });
        return;
      }
      await existing.handleRequest(req, res);
      return;
    }

    res.writeHead(405, { allow: "GET, POST, DELETE" }).end();
  };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/healthz") {
      res.writeHead(200, { "content-type": "text/plain" }).end("ok\n");
      return;
    }
    if (url.pathname.startsWith(FILES_ROUTE)) {
      await handleFiles(req, res, url);
      return;
    }
    if (url.pathname === http.path) {
      await handleMcp(req, res);
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" }).end("not found\n");
  };

  return createServer((req, res) => {
    handle(req, res).catch((err) => {
      log.error({ err, path: req.url }, "http handler failed");
      if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "internal error" }));
    });
  });
}

export function startMcpHttp(services: Services): Promise<Server> {
  const { config, log } = services;
  const http = config.mcp.http!;
  const server = createMcpHttpServer(services);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(http.port, http.host, () => {
      log.info(
        { host: http.host, port: http.port, path: http.path, files: FILES_ROUTE },
        "http endpoint listening",
      );
      resolve(server);
    });
  });
}
