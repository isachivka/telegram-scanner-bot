import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Services } from "../core/services.js";
import { createMcpServer } from "./server.js";

function bearerMatches(header: string | undefined, token: string): boolean {
  if (!header) return false;
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return false;
  const a = Buffer.from(m[1]!);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString();
      if (!raw) return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

/**
 * Streamable HTTP MCP endpoint guarded by a bearer token. One MCP session per
 * client; all sessions share the same scanner/printer services.
 */
export function createMcpHttpServer(services: Services): Server {
  const { config, log } = services;
  const http = config.mcp.http!;
  const sessions = new Map<string, StreamableHTTPServerTransport>();

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/healthz") {
      res.writeHead(200, { "content-type": "text/plain" }).end("ok\n");
      return;
    }
    if (url.pathname !== http.path) {
      res.writeHead(404, { "content-type": "text/plain" }).end("not found\n");
      return;
    }
    if (!bearerMatches(req.headers.authorization, http.authToken)) {
      log.warn(
        { ip: req.socket.remoteAddress },
        "mcp: rejected request without valid bearer token",
      );
      res
        .writeHead(401, {
          "content-type": "application/json",
          "www-authenticate": "Bearer",
        })
        .end(JSON.stringify({ error: "unauthorized" }));
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
      const server = createMcpServer(services);
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
      return;
    }

    if (req.method === "GET" || req.method === "DELETE") {
      if (!existing) {
        res
          .writeHead(400, { "content-type": "application/json" })
          .end(JSON.stringify({ error: "missing or unknown mcp-session-id" }));
        return;
      }
      await existing.handleRequest(req, res);
      return;
    }

    res.writeHead(405, { allow: "GET, POST, DELETE" }).end();
  };

  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      log.error({ err }, "mcp http handler failed");
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
      }
      res.end(JSON.stringify({ error: "internal error" }));
    });
  });
  return server;
}

export function startMcpHttp(services: Services): Promise<Server> {
  const { config, log } = services;
  const http = config.mcp.http!;
  const server = createMcpHttpServer(services);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(http.port, http.host, () => {
      log.info(
        { host: http.host, port: http.port, path: http.path },
        "mcp http endpoint listening",
      );
      resolve(server);
    });
  });
}
