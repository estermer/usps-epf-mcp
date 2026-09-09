import http from "node:http";
import type { AddressInfo } from "node:net";

export interface FakeEpfOptions {
  loginHandler?: (body: { login?: string; pword?: string }) =>
    | { status: number; body: unknown }
    | Promise<{ status: number; body: unknown }>;
  failAcsOnce?: boolean;
  versionResponse?: unknown;
}

export interface FakeEpf {
  baseUrl: string;
  close: () => Promise<void>;
  requestCount: () => number;
  loginCount: () => number;
  downloadFileBytes: () => Buffer;
}

export async function startFakeEpf(
  opts: FakeEpfOptions = {},
): Promise<FakeEpf> {
  let loginCalls = 0;
  let totalReqs = 0;
  let failAcsOnceArmed = !!opts.failAcsOnce;
  const downloadBytes = Buffer.from("PK\x03\x04zip-stream-payload");

  const handler = async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> => {
    totalReqs += 1;
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");
    let parsed: Record<string, unknown> = {};
    if (raw) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = {};
      }
    }

    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const auth = req.headers["authorization"];
    const hasBearer = typeof auth === "string" && auth.startsWith("Bearer ");

    res.setHeader("Content-Type", "application/json");

    if (req.method === "POST" && url.pathname === "/api/v2/epf/login") {
      loginCalls += 1;
      if (opts.loginHandler) {
        const r = await opts.loginHandler(parsed as { login?: string; pword?: string });
        res.statusCode = r.status;
        res.end(JSON.stringify(r.body));
        return;
      }
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          logonkey: "lk-test",
          email: parsed.login ? `${parsed.login}@example.test` : undefined,
          token: "jwt-test",
          roles: ["READONLY"],
        }),
      );
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/v2/epf/logout") {
      res.statusCode = 200;
      res.end(JSON.stringify({ message: "logged out" }));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/v2/epf/version") {
      res.statusCode = 200;
      res.end(
        JSON.stringify(
          opts.versionResponse ?? { version: "v3.1.0-test", buildDate: "2026-09-09" },
        ),
      );
      return;
    }

    if (!hasBearer) {
      res.statusCode = 401;
      res.end(JSON.stringify({ statusCode: 401, message: "missing bearer" }));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/v2/download/acslist") {
      if (failAcsOnceArmed) {
        failAcsOnceArmed = false;
        res.statusCode = 401;
        res.end(JSON.stringify({ statusCode: 401, message: "token expired" }));
        return;
      }
      res.statusCode = 200;
      res.end(
        JSON.stringify([
          { fileId: "acs-001", date: "2026-09-01" },
          { fileId: "acs-002", date: "2026-09-02" },
        ]),
      );
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/v2/download/dnldlist") {
      res.statusCode = 200;
      res.end(
        JSON.stringify([
          { fileId: "dl-001", source: "ACS", size: 12345 },
          { fileId: "dl-002", source: "ACS", size: 67890 },
        ]),
      );
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/v2/download/status") {
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          fileid: parsed.fileid,
          newstatus: parsed.newstatus,
          ok: true,
        }),
      );
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/v2/download/epf/")) {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/zip");
      res.end(downloadBytes);
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ statusCode: 404, message: "not stubbed" }));
  };

  const server = http.createServer((req, res) => {
    handler(req, res).catch((err) => {
      res.statusCode = 500;
      res.end(`fake-epf error: ${err instanceof Error ? err.message : String(err)}`);
    });
  });

  await new Promise<void>((resolveListen) =>
    server.listen(0, "127.0.0.1", () => resolveListen()),
  );
  const addr = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  return {
    baseUrl,
    close: () =>
      new Promise<void>((resolveClose, rejectClose) =>
        server.close((err) => (err ? rejectClose(err) : resolveClose())),
      ),
    requestCount: () => totalReqs,
    loginCount: () => loginCalls,
    downloadFileBytes: () => Buffer.from(downloadBytes),
  };
}
