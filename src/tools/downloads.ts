import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { EpfClient } from "../epf-client.js";

const FILE_STATUS = ["N", "S", "X", "C"] as const;
type FileStatus = (typeof FILE_STATUS)[number];

function statusQuery(status: FileStatus[] | undefined): string | undefined {
  if (!status || status.length === 0) return undefined;
  return status.join(",");
}

export function registerDownloadTools(server: McpServer, client: EpfClient): void {
  server.registerTool(
    "epf_acs_list",
    {
      description:
        "List ACS-keyed download files scoped to productId=PARENT. Bearer auth required. Optionally filter by status (N=new, S=started, X=cancelled, C=completed).",
      inputSchema: {
        status: z.array(z.enum(FILE_STATUS)).optional(),
      },
    },
    async (args) => {
      const query: Record<string, string> = { productId: "PARENT" };
      const s = statusQuery(args.status);
      if (s) query.status = s;
      const data = await client.request<unknown>({
        method: "GET",
        path: "/api/v2/download/acslist",
        query,
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.registerTool(
    "epf_download_list",
    {
      description:
        "List EPF download files scoped to productId=PARENT. Bearer auth required. Optionally filter by status (N=new, S=started, X=cancelled, C=completed).",
      inputSchema: {
        status: z.array(z.enum(FILE_STATUS)).optional(),
      },
    },
    async (args) => {
      const query: Record<string, string> = { productId: "PARENT" };
      const s = statusQuery(args.status);
      if (s) query.status = s;
      const data = await client.request<unknown>({
        method: "GET",
        path: "/api/v2/download/dnldlist",
        query,
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
      description:
        "Update file status. Bearer auth required. status: N=new, S=download started, X=cancelled, C=completed.",
      inputSchema: {
        fileId: z.string().min(1),
        status: z.enum(FILE_STATUS),
      },
    },
    async (args) => {
      const data = await client.request<unknown>({
        method: "POST",
        path: "/api/v2/download/status",
        body: { fileid: args.fileId, newstatus: args.status },
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    },
  );
}
