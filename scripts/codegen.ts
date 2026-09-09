#!/usr/bin/env -S node --experimental-strip-types
// Refresh the OpenAPI snapshot used by the server.
// Writes:
//   src/openapi-types.json   — slim spec (paths + schemas used by the server)
//   tests/fixtures/v3-api-docs.json — same content, used by tests
//
// Run with:  npm run codegen [-- <baseUrl>]

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const baseUrl = process.argv[2] ?? "https://epf.usps.gov/up";

interface Slim {
  openapi: string;
  info: { title: string; version: string };
  servers: Array<{ url: string }>;
  security: Array<Record<string, string[]>>;
  paths: Record<string, unknown>;
  components: {
    securitySchemes: unknown;
    schemas: Record<string, unknown>;
  };
}

const NEEDED_PATHS = [
  "/api/v2/epf/version",
  "/api/v2/epf/login",
  "/api/v2/epf/logout",
  "/api/v2/download/acslist",
  "/api/v2/download/dnldlist",
  "/api/v2/download/status",
  "/api/v2/download/epf/{fileId}",
  "/epfupld/download/dnldlist",
];

const NEEDED_SCHEMAS = new Set([
  "UserAuthentication",
  "AppUser",
  "VersionResponse",
  "StatusUpdate",
  "MessageResponse",
  "FileListDefinition",
]);

async function main(): Promise<void> {
  const url = `${baseUrl.replace(/\/+$/, "")}/v3/api-docs`;
  process.stderr.write(`[codegen] fetching ${url}\n`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`GET ${url} -> ${res.status}`);
  }
  const full = (await res.json()) as Slim;

  const slim: Slim = {
    openapi: full.openapi,
    info: full.info,
    servers: full.servers,
    security: full.security,
    paths: Object.fromEntries(NEEDED_PATHS.filter((p) => p in full.paths).map((p) => [p, full.paths[p]])),
    components: {
      securitySchemes: full.components.securitySchemes,
      schemas: Object.fromEntries(
        Object.entries(full.components.schemas).filter(([k]) => NEEDED_SCHEMAS.has(k)),
      ),
    },
  };

  const repoRoot = resolve(import.meta.dirname, "..");
  const targets = [
    resolve(repoRoot, "src/openapi-types.json"),
    resolve(repoRoot, "tests/fixtures/v3-api-docs.json"),
  ];
  const body = JSON.stringify(slim, null, 2) + "\n";
  for (const t of targets) {
    mkdirSync(dirname(t), { recursive: true });
    writeFileSync(t, body);
    process.stderr.write(`[codegen] wrote ${t} (${body.length} bytes)\n`);
  }
  process.stderr.write(
    `[codegen] paths kept: ${Object.keys(slim.paths).join(", ")}\n` +
      `[codegen] schemas kept: ${Object.keys(slim.components.schemas).join(", ")}\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`[codegen] failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});