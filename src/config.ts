import { homedir } from "node:os";
import { resolve } from "node:path";

export interface AppConfig {
  baseUrl: string;
  username: string;
  password: string;
  downloadDir: string;
  timeoutMs: number;
  logLevel: "silent" | "info" | "debug";
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function readStr(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const v = env[key];
  return v === undefined || v === "" ? undefined : v;
}

function parseLogLevel(raw: string | undefined): "silent" | "info" | "debug" {
  if (raw === "silent" || raw === "info" || raw === "debug") return raw;
  return "info";
}

function parseInt10(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new ConfigError(`EPF_TIMEOUT_MS must be a positive integer, got: ${raw}`);
  }
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const username = readStr(env, "EPF_USERNAME");
  const password = readStr(env, "EPF_PASSWORD");
  if (!username) throw new ConfigError("EPF_USERNAME is required");
  if (!password) throw new ConfigError("EPF_PASSWORD is required");

  const baseUrlRaw = readStr(env, "EPF_BASE_URL") ?? "https://epf.usps.gov/up";
  const baseUrl = baseUrlRaw.replace(/\/+$/, "");

  const downloadDirRaw = readStr(env, "EPF_DOWNLOAD_DIR") ?? "~/epf/downloads";
  const downloadDir = resolve(
    downloadDirRaw.startsWith("~/") || downloadDirRaw === "~"
      ? downloadDirRaw.replace(/^~(?=$|\/|\\)/, homedir())
      : downloadDirRaw,
  );

  const timeoutMs = parseInt10(readStr(env, "EPF_TIMEOUT_MS"), 30_000);
  const logLevel = parseLogLevel(readStr(env, "EPF_LOG_LEVEL"));

  return { baseUrl, username, password, downloadDir, timeoutMs, logLevel };
}
