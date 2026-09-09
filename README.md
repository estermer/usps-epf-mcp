# USPS EPF V2 MCP Server

A local MCP server that lets an LLM (OpenCode, Claude, Cursor, …) interact with the
USPS EPF V2 REST Services API. Read-only + auth helpers + status updates. No file
uploads.

## Quickstart

```bash
cd ~/develop/usps-epf-mcp
npm install
npm run build
```

Create `~/.config/opencode/opencode.jsonc` (or merge into existing `mcpServers`):

```json
{
  "mcpServers": {
    "epf": {
      "command": "node",
      "args": ["~/develop/usps-epf-mcp/dist/index.js"],
      "env": {
        "EPF_USERNAME": "<your epf username>",
        "EPF_PASSWORD": "<your epf password>",
        "EPF_DOWNLOAD_DIR": "~/epf/downloads"
      }
    }
  }
}
```

Restart OpenCode. Try asking: *"Use the EPF MCP to get the server version."*

## Tools

| Name | Purpose |
|------|---------|
| `epf_version` | Liveness check, no auth |
| `epf_login` | Re-auth (advanced; usually unnecessary — server logs in at boot) |
| `epf_logout` | Clear local creds and call `/logout` |
| `epf_reauth` | Force JWT refresh using stored credentials |
| `epf_acs_list` | List ACS-keyed files |
| `epf_download_list` | Request a download manifest (body fields: refId, source?, target?, subSource?) |
| `epf_download_epf_file` | Stream a binary file to `EPF_DOWNLOAD_DIR`, return metadata only |
| `epf_update_status` | Update file status |

Binary files never enter the LLM context. They're written to disk and the host's
native `read` tool inspects them.

## Configuration

All via env, read at boot:

| Var | Default | Notes |
|-----|---------|-------|
| `EPF_USERNAME` | — | Required |
| `EPF_PASSWORD` | — | Required |
| `EPF_BASE_URL` | `https://epf.usps.gov/up` | Override for sandbox/test |
| `EPF_DOWNLOAD_DIR` | `~/epf/downloads` | `~` is expanded |
| `EPF_TIMEOUT_MS` | `30000` | HTTP timeout per request |
| `EPF_LOG_LEVEL` | `info` | `silent|info|debug` |

Logs go to stderr only (stdout is reserved for the MCP transport).

## Development

```bash
npm run dev          # tsx watch, dotenv from .env
npm test             # vitest, no network
npm run lint         # eslint
npm run typecheck    # tsc --noEmit
npm run codegen      # refresh OpenAPI snapshot
```

## Architecture

One Node 22 process. MCP over stdio. Bearer JWT obtained at boot, refreshed on 401
or via `epf_reauth`. Read the design spec at
[`docs/superpowers/specs/2026-09-09-epf-mcp-design.md`](docs/superpowers/specs/2026-09-09-epf-mcp-design.md).

## Out of scope

- The five `Upload Services (Restricted)` endpoints — the LLM cannot push files.
- All `POST` mirrors under `/epfupld/download/*` — the cleaner `/api/v2/download/*`
  versions are exposed instead.