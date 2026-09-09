import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { EpfClient } from "../epf-client.js";

export function registerDownloadTools(server: McpServer, client: EpfClient): void {
  server.registerTool(
    "epf_acs_list",
    {
      description: "List ACS-keyed download files. Bearer auth required.",
      inputSchema: {},
    },
    async () => {
      const data = await client.request<unknown>({
        method: "GET",
        path: "/api/v2/download/acslist",
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.registerTool(
    "epf_download_list",
    {
      description:
        "Request a download manifest from EPF. Body shape is derived from the OpenAPI snapshot at src/openapi-types.json.",
      inputSchema: {
        refId: z.string().min(1),
        source: z.string().optional(),
        target: z.string().optional(),
        subSource: z.string().optional(),
      },
    },
    async (args) => {
      const body: Record<string, string> = { refId: args.refId };
      if (args.source !== undefined) body.source = args.source;
      if (args.target !== undefined) body.target = args.target;
      if (args.subSource !== undefined) body.subSource = args.subSource;
      const data = await client.request<unknown>({
        method: "POST",
        path: "/epfupld/download/dnldlist",
        body,
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.registerTool(
    "epf_download_epf_file",
    {
      description:
        "Stream a binary EPF file to EPF_DOWNLOAD_DIR and return metadata only (path, content-type, byteLength, sha256). Bytes never enter the LLM context.",
      inputSchema: {
        fileId: z
          .string()
          .min(1)
          .regex(/^[A-Za-z0-9._-]+$/, "fileId must be URL-safe (letters, digits, ., _, -)"),
      },
    },
    async (args) => {
      const result = await client.downloadFile(args.fileId);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                fileId: args.fileId,
                savedTo: result.savedTo,
                contentType: result.contentType,
                byteLength: result.byteLength,
                sha256: result.sha256,
                downloadedAt: new Date().toISOString(),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerTool(
    "epf_update_status",
    {
      description: "Update file status. Bearer auth required.",
      inputSchema: {
        fileId: z.string().min(1),
        status: z.string().min(1),
      },
    },
    async (args) => {
      const data = await client.request<unknown>({
        method: "POST",
        path: "/api/v2/download/status",
        body: { fileId: args.fileId, status: args.status },
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    },
  );
}
