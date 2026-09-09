import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import type { AuthStore, LoginResult } from "./auth.js";
import { EpfError } from "./errors.js";
import { logger } from "./logger.js";

export interface HttpRequest {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  query?: Record<string, string>;
  body?: unknown;
  bodyContentType?: "application/json" | "application/octet-stream";
  unauthenticated?: boolean;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  json?: unknown;
  text?: string;
}

export interface FileDownload {
  savedTo: string;
  contentType: string;
  byteLength: number;
  sha256: string;
}

const CT_TO_EXT: Record<string, string> = {
  "application/zip": "zip",
  "application/json": "json",
  "application/xml": "xml",
  "text/plain": "txt",
  "text/csv": "csv",
  "application/octet-stream": "bin",
};

function extForContentType(contentType: string): string {
  const base = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  return CT_TO_EXT[base] ?? "bin";
}

function safeFileName(fileId: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(fileId)) {
    throw new EpfError(400, "<input>", `unsafe fileId: ${fileId}`);
  }
  return fileId;
}

export class EpfClient {
  constructor(
    private readonly baseUrl: string,
    private readonly auth: AuthStore,
    private readonly timeoutMs: number,
    private readonly downloadDir: string,
  ) {}

  async login(username: string, password: string): Promise<LoginResult> {
    const res = await this.rawRequest({
      method: "POST",
      path: "/api/v2/epf/login",
      body: { login: username, pword: password },
      bodyContentType: "application/json",
      unauthenticated: true,
    });
    if (res.status !== 200) {
      logger.info("LOGIN_FAILED", { status: res.status });
      throw new EpfError(res.status, "POST /api/v2/epf/login", res.text ?? "login failed");
    }
    const json = res.json as {
      logonkey?: string;
      email?: string;
      token?: string;
      roles?: string[];
    } | null;
    if (!json || typeof json.token !== "string" || typeof json.logonkey !== "string") {
      throw new EpfError(res.status, "POST /api/v2/epf/login", "missing token/logonkey in response");
    }
    return {
      jwt: json.token,
      logonkey: json.logonkey,
      email: json.email,
      roles: json.roles,
    };
  }

  async request<T = unknown>(req: HttpRequest): Promise<T> {
    const res = await this.rawRequest(req);
    if (res.status >= 400) {
      logger.info("HTTP_ERROR", {
        method: req.method,
        path: req.path,
        status: res.status,
      });
      throw new EpfError(res.status, `${req.method} ${req.path}`, res.text ?? "request failed");
    }
    return (res.json ?? res.text) as T;
  }

  async downloadFile(fileId: string): Promise<FileDownload> {
    const safeId = safeFileName(fileId);
    const state = this.auth.current();
    if (!state) {
      throw new EpfError(401, `GET /api/v2/download/epf/${fileId}`, "not authenticated");
    }
    const url = new URL(`/api/v2/download/epf/${encodeURIComponent(safeId)}`, this.baseUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${state.jwt}` },
        signal: controller.signal,
      });
      if (res.status === 401) {
        await this.auth.reauth(`GET /api/v2/download/epf/${safeId}`);
        return this.downloadFile(fileId);
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new EpfError(
          res.status,
          `GET /api/v2/download/epf/${safeId}`,
          text || "download failed",
        );
      }
      const contentType = res.headers.get("content-type") ?? "application/octet-stream";
      const ext = extForContentType(contentType);
      const dest = resolve(this.downloadDir, `${safeId}.${ext}`);
      await mkdir(this.downloadDir, { recursive: true });

      const hash = createHash("sha256");
      let byteLength = 0;
      const stream = Readable.fromWeb(res.body as unknown as WebReadableStream<Uint8Array>);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        hash.update(buf);
        byteLength += buf.length;
        chunks.push(buf);
      }
      await writeFile(dest, Buffer.concat(chunks));
      logger.info("DOWNLOAD_OK", { fileId: safeId, bytes: byteLength, path: dest });
      return { savedTo: dest, contentType, byteLength, sha256: hash.digest("hex") };
    } finally {
      clearTimeout(timer);
    }
  }

  private async rawRequest(req: HttpRequest): Promise<HttpResponse> {
    const state = req.unauthenticated ? null : this.auth.current();
    if (!req.unauthenticated && !state) {
      throw new EpfError(401, `${req.method} ${req.path}`, "not authenticated");
    }
    const url = new URL(req.path, this.baseUrl);
    if (req.query) {
      for (const [k, v] of Object.entries(req.query)) url.searchParams.set(k, v);
    }
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (state) headers.Authorization = `Bearer ${state.jwt}`;
    let body: string | undefined;
    if (req.body !== undefined) {
      const ct = req.bodyContentType ?? "application/json";
      headers["Content-Type"] = ct;
      body = ct === "application/json" ? JSON.stringify(req.body) : String(req.body);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        method: req.method,
        headers,
        body,
        signal: controller.signal,
      });
      if (res.status === 401 && !req.unauthenticated) {
        await this.auth.reauth(`${req.method} ${req.path}`);
        return this.rawRequest(req);
      }
      const text = await res.text();
      let json: unknown;
      if ((res.headers.get("content-type") ?? "").includes("json")) {
        try {
          json = JSON.parse(text);
        } catch {
          json = undefined;
        }
      }
      return {
        status: res.status,
        headers: Object.fromEntries(res.headers.entries()),
        ...(json !== undefined ? { json } : {}),
        text,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
