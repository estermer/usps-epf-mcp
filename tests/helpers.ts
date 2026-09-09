import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthStore } from "../src/auth.js";
import { EpfClient } from "../src/epf-client.js";
import { registerAuthTools } from "../src/tools/auth.js";
import { registerDownloadTools } from "../src/tools/downloads.js";
import { startFakeEpf, type FakeEpf } from "./fake-epf.js";

export interface TestRig {
  client: Client;
  server: McpServer;
  epf: FakeEpf;
  tempDir: string;
  cleanup: () => Promise<void>;
}

export async function makeRig(opts: { failAcsOnce?: boolean } = {}): Promise<TestRig> {
  const epf = await startFakeEpf({ failAcsOnce: opts.failAcsOnce });
  const tempDir = await mkdtemp(join(tmpdir(), "epf-mcp-test-"));

  const auth = new AuthStore(async () => {
    throw new Error("login function not configured");
  });
  const client = new EpfClient(epf.baseUrl, auth, 5_000, tempDir);
  (auth as unknown as { loginFn: typeof client.login }).loginFn = (u, p) => client.login(u, p);

  await auth.bootLogin({ username: "u1", password: "p1" });

  const server = new McpServer(
    { name: "epf-mcp-test", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );
  registerAuthTools(server, client, auth);
  registerDownloadTools(server, client);

  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: "test-client", version: "0.1.0" }, { capabilities: {} });

  await Promise.all([server.connect(serverT), mcpClient.connect(clientT)]);

  return {
    client: mcpClient,
    server,
    epf,
    tempDir,
    cleanup: async () => {
      await mcpClient.close();
      await epf.close();
      await rm(tempDir, { recursive: true, force: true });
    },
  };
}

export function parseToolText(result: {
  content: Array<{ type: string; text?: string }>;
}): unknown {
  const first = result.content[0];
  if (!first || first.type !== "text" || typeof first.text !== "string") {
    throw new Error("expected text content");
  }
  return JSON.parse(first.text);
}