import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Services } from "../core/services.js";
import { createMcpServer } from "./server.js";

/** Serve MCP over stdin/stdout for clients that launch the server themselves. */
export async function startMcpStdio(services: Services): Promise<void> {
  const server = createMcpServer(services);
  await server.connect(new StdioServerTransport());
  services.log.info("mcp stdio server connected");
}
