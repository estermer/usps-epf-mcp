import type { Writable } from "node:stream";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AuthStore } from "./auth.js";
import { loadConfig } from "./config.js";
import { EpfClient } from "./epf-client.js";
import { logger } from "./logger.js";
import { registerAuthTools } from "./tools/auth.js";
import { registerDownloadTools } from "./tools/downloads.js";

export interface BootOptions {
  env?: NodeJS.ProcessEnv;
  stdout?: Writable;
}

export async function boot(options: BootOptions = {}): Promise<{
  server: McpServer;
  transport: StdioServerTransport;
  client: EpfClient;
  auth: AuthStore;
}> {
  const cfg = loadConfig(options.env ?? process.env);

  const auth = new AuthStore(async () => {
    throw new Error("login function not configured");
  });
  const client = new EpfClient(cfg.baseUrl, auth, cfg.timeoutMs, cfg.downloadDir);
  // Replace the placeholder login with the real one once EpfClient exists.
  (auth as unknown as { loginFn: typeof client.login }).loginFn = (u, p) => client.login(u, p);

  try {
    await auth.bootLogin({ username: cfg.username, password: cfg.password });
  } catch (err) {
    process.stderr.write(
      `[EPF] boot login failed (continuing unauthenticated): ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
  }

  const server = new McpServer(
    { name: "epf-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );
  registerAuthTools(server, client, auth);
  registerDownloadTools(server, client);

  const stdout = options.stdout ?? process.stdout;
  const transport = new StdioServerTransport(process.stdin, stdout);
  await server.connect(transport);

  logger.info("READY", { tools: 8 });
  return { server, transport, client, auth };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1])) {
  boot().catch((err) => {
    process.stderr.write(`[EPF] fatal: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}