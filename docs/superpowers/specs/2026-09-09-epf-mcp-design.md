# EPF V2 MCP Server — Design Spec

- **Date:** 2026-09-09
- **Owner:** estermer
- **Repo:** `~/develop/epf-mcp`
- **Upstream:** USPS EPF V2 REST Services (`https://epf.usps.gov/up`)

## 1. Purpose

A local MCP server that lets an LLM (via OpenCode/Claude/Cursor) interact with the
USPS EPF V2 REST API on the user's behalf. The user already has an EPF account; this
server does not provision one.

The server is invoked by the LLM host as a child process over **stdio**. It owns the
credentials, never lets them leak into the model conversation, and exposes a small,
named tool surface — one tool per meaningful operation.

## 2. Scope

### In scope
- Authentication helpers (`version`, `login`, `logout`, internal `reauth`).
- All **read** operations:
  - `acsList` — list ACS-keyed files
  - `dnldlist` — request a download manifest
  - `downloadEpfFile` — stream a binary file to local disk and return metadata
- One **write** operation in downloads: `updateStatus` — update file status.

### Out of scope
- All five `Upload Services (Restricted)` endpoints (`/api/v2/upload/*`,
  `/epfupld/upload/*`). The LLM must not be able to push files.
- The redundant `POST` mirror endpoints under `/epfupld/download/*` (we route via
  the cleaner `/api/v2/download/*` versions).
- The two `directToHTML` UI redirect endpoints.
- Account provisioning, password rotation, captcha handling.
- Multi-tenant credentials — one server process = one EPF account.

## 3. Architecture

A single Node 22 process running an MCP server via `StdioServerTransport`.
No sockets, no HTTP listener, no daemon. All state lives in memory.

### 3.1 Boot sequence
1. Load env (`EPF_USERNAME`, `EPF_PASSWORD`, optional `EPF_BASE_URL`,
   `EPF_DOWNLOAD_DIR`, `EPF_TIMEOUT_MS`, `EPF_LOG_LEVEL`).
2. Validate config; missing required vars → fail fast to stderr, exit non-zero.
3. Create the HTTP client.
4. Call `POST /api/v2/epf/login` with `{login, pword}`. Stash
   `{jwt, logonkey, username, issuedAt}` in an `AuthState` object.
5. Register the eight tools on the MCP server.
6. `server.connect(stdioTransport)`.

### 3.2 Auth state machine
- `AuthState = { jwt, logonkey, username, issuedAt, refreshHintMs }`.
- `client.request(path, init)` injects `Authorization: Bearer <jwt>` on every
  protected call.
- On `401 Unauthorized`:
  1. Re-login with stored creds.
  2. Retry the original request once.
  3. On retry-success: update `AuthState.jwt`, return the result.
  4. On retry-401 or reauth-failure: throw `EpfError(401, "<endpoint>", message)`.
- Token refresh triggers: lazy (401), proactive (`epf_reauth` tool), boot (always).
- No client-side JWT parsing; `issuedAt` is a hint only. Server is the authority.

### 3.3 Token refresh policy on reauth failure
- Surface the error to the model with a structured MCP error result.
- The model may call `epf_reauth()` again, or surface to the user.
- Server does NOT exit. Server does NOT silently leave stale creds.

## 4. Tool surface

Eight MCP tools. Names are stable; parameters are Zod-validated at the MCP boundary.
Invalid input never reaches EPF.

| Name | Backend | Auth | Returns |
|------|---------|------|---------|
| `epf_version` | `GET /api/v2/epf/version` | none | `{version, buildDate}` |
| `epf_login` | `POST /api/v2/epf/login` | none | `AppUser`. Optional `store=true` writes JWT into `AuthState`. |
| `epf_logout` | `POST /api/v2/epf/logout` | bearer | clears `AuthState`; subsequent calls error until reauth |
| `epf_acs_list` | `GET /api/v2/download/acslist` | bearer | parsed list of ACS files |
| `epf_download_list` | `POST /epfupld/download/dnldlist` | bearer | parsed download manifest |
| `epf_download_epf_file` | `GET /api/v2/download/epf/{fileId}` | bearer | metadata only (see §5) |
| `epf_update_status` | `POST /api/v2/download/status` | bearer | parsed status update response |
| `epf_reauth` | (internal) | — | re-login with stored creds; returns new `issuedAt` |

### 4.1 Parameter schemas (locked)

- `epf_version` — no params.
- `epf_login` — `{ login: string, pword: string, store?: boolean = false }`.
- `epf_logout` — no params.
- `epf_acs_list` — no params.
- `epf_download_list` — body shape from `POST /epfupld/download/dnldlist` in
  the snapshot at `src/openapi-types.ts`. The snapshot is the source of truth;
  the impl generates the Zod schema from it. Initial guess is `{ refId: string,
  source?: string, target?: string, subSource?: string }` for documentation only.
- `epf_download_epf_file` — `{ fileId: string }`. `fileId` is URL-safe; validated.
- `epf_update_status` — body shape from `POST /api/v2/download/status` in the
  snapshot. Same rule: snapshot is the source of truth; Zod schema is generated.
  Initial guess for documentation is `{ fileId: string, status: string }`.
- `epf_reauth` — no params.

## 5. Binary downloads

`epf_download_epf_file` streams the response body to
`${EPF_DOWNLOAD_DIR}/<fileId>.<ext>` (extension inferred from `Content-Type`; falls
back to `bin`). The MCP result contains **metadata only**:

```json
{
  "fileId": "abc-123",
  "savedTo": "/home/estermer/epf/downloads/abc-123.zip",
  "contentType": "application/zip",
  "byteLength": 1234567,
  "sha256": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  "downloadedAt": "2026-09-09T15:30:00.000Z"
}
```

Bytes never enter the LLM context. The host's native `read` tool opens the file for
inspection. `EPF_DOWNLOAD_DIR` defaults to `~/epf/downloads` with `~` expanded.

## 6. Error contract

All errors come back as MCP error results, never throws:

```json
{
  "isError": true,
  "content": [{
    "type": "text",
    "text": "[EPF 401] GET /api/v2/download/acslist: reauth failed: invalid credentials"
  }]
}
```

- No stack traces. No body echoing. No credentials.
- Wrapped in `EpfError(statusCode, endpoint, cause)` for test introspection.
- Zod rejections return a separate, parallel text format:
  `[INPUT] <toolName>: <field>: <reason>`.

## 7. Configuration (env, read at boot)

- `EPF_USERNAME` — required.
- `EPF_PASSWORD` — required.
- `EPF_BASE_URL` — default `https://epf.usps.gov/up`.
- `EPF_DOWNLOAD_DIR` — default `~/epf/downloads` (`~` expanded).
- `EPF_TIMEOUT_MS` — default `30000`.
- `EPF_LOG_LEVEL` — default `info`. Allowed: `silent|info|debug`.

## 8. OpenAPI snapshot

`src/openapi-types.ts` is **committed** as a snapshot of the live
`GET /v3/api-docs` payload. The server boots from this snapshot — boot does NOT
require EPF uptime. Re-fetch is manual:

```
npm run codegen   # writes src/openapi-types.ts + tests/fixtures/v3-api-docs.json
```

## 9. Observability

- Logs to **stderr only**. Stdout is reserved for MCP transport — they must not mix.
- Structured JSON, one event per line: `{ts, level, event, ...fields}`.
- Events: `BOOT_OK`, `BOOT_LOGIN_FAILED`, `REAUTH`, `REAUTH_FAILED`, `HTTP_ERROR`,
  `DOWNLOAD_OK`.
- Never log secrets, response bodies, or auth-bearing headers.
- `EPF_LOG_LEVEL=silent` → zero output.

## 10. Project layout

```
~/develop/epf-mcp/
├── package.json
├── tsconfig.json
├── .gitignore
├── README.md
├── src/
│   ├── index.ts              # entrypoint; boot, register, connect
│   ├── config.ts             # env parsing + defaults
│   ├── auth.ts               # AuthState + lazy reauth
│   ├── epf-client.ts         # typed HTTP client
│   ├── openapi-types.ts      # snapshot of /v3/api-docs
│   ├── errors.ts             # EpfError class + formatting
│   ├── logger.ts             # stderr JSON logger
│   └── tools/
│       ├── auth.ts           # version, login, logout, reauth
│       └── downloads.ts      # acs_list, download_list, download_epf_file, update_status
└── tests/
    ├── fake-epf.ts           # Express server mirroring snapshot
    ├── fixtures/
    │   └── v3-api-docs.json
    ├── auth.test.ts
    ├── downloads.test.ts
    ├── errors.test.ts
    └── helpers.ts

# dist/   — TypeScript build output, gitignored. `npm run build` → dist/index.js.
# .env    — local dev only, gitignored.
```

Both `dist/` and `.env` live at the repo root alongside `src/` and `tests/`.

## 11. Testing

- **Vitest**. No network in CI.
- `tests/fake-epf.ts` spins up an Express app on a random port, fed from
  `tests/fixtures/v3-api-docs.json`. Same status codes, headers, shapes as live.
- Coverage targets:
  - **Auth** — boot login success/failure, 401-refresh happy path, refresh-failure,
    missing-env behavior.
  - **Tools** — every tool, success path, return-shape assertions.
  - **Errors** — EPF 4xx/5xx → `EpfError` with formatted text; Zod rejection →
    structured MCP error.
  - **Downloads** — file written to temp `EPF_DOWNLOAD_DIR`, sha256 correct,
    content-type captured, no body in caller-facing JSON.
- Scripts: `npm test`, `npm run lint` (eslint), `npm run typecheck` (tsc --noEmit),
  `npm run codegen`.

## 12. Local dev & MCP registration

- `npm run dev` → `tsx watch src/index.ts`, `dotenv` loads `.env`.
- README quickstart: set env, install, paste the MCP snippet, restart opencode, ask
  "what's the EPF version?".

### MCP snippet to add to `~/.config/opencode/opencode.jsonc`

```json
{
  "mcpServers": {
    "epf": {
      "command": "node",
      "args": ["~/develop/epf-mcp/dist/index.js"],
      "env": {
        "EPF_USERNAME": "<your username>",
        "EPF_PASSWORD": "<your password>"
      }
    }
  }
}
```

User pastes this themselves. We do NOT touch `opencode.jsonc` from the build.

## 13. Risks & decisions

- **OpenAPI shape drift.** Mitigated by snapshotting types and running tests against
  a local mock fed from the same snapshot. `npm run codegen` is the only escape
  hatch if EPF changes shape.
- **JWT lifetime.** Opaque JWT, no client-side parsing. We rely on 401 → reauth.
  If EPF ever shortens token lifetime, no code change — just slower recovery on
  first call after expiry.
- **`POST /epfupld/download/dnldlist` body shape.** Zod schema is generated from
  the snapshot at `src/openapi-types.ts`. §4.1 lists documentation-only initial
  guesses; the snapshot is the source of truth and the generated schema is what
  the LLM sees.
- **No `express` on the public surface.** The `fake-epf.ts` mock uses Express in
  tests only. Production has zero listening ports.
- **Credentials in env.** Acceptable per the design choice: secrets never enter
  the model conversation. User pastes them in `opencode.jsonc` once.
