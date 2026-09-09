import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AuthStore } from "../auth.js";
import type { EpfClient } from "../epf-client.js";
import { EpfError } from "../errors.js";

export function registerAuthTools(
  server: McpServer,
  client: EpfClient,
  auth: AuthStore,
): void {
  server.registerTool(
    "epf_version",
    {
      description: "Get the EPF server version and build date. No auth required.",
      inputSchema: {},
    },
    async () => {
      const data = await client.request<{ version?: string; buildDate?: string }>({
        method: "GET",
        path: "/api/v2/epf/version",
      });
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    },
  );

  server.registerTool(
    "epf_login",
    {
      description:
        "Authenticate with EPF using username/password. Pass store=true to make the resulting JWT the active session credential.",
      inputSchema: {
        login: z.string().min(1),
        pword: z.string().min(1),
        store: z.boolean().optional(),
      },
    },
    async (args) => {
      if (args.store) {
        const state = await auth.loginAndStore({ username: args.login, password: args.pword });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  username: state.username,
                  email: state.email,
                  roles: state.roles,
                  issuedAt: state.issuedAt,
                },
                null,
                2,
              ),
            },
          ],
        };
      }
      const result = await client.login(args.login, args.pword);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { email: result.email, roles: result.roles, stored: false },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerTool(
    "epf_logout",
    {
      description:
        "Call EPF /logout on the server, then clear the local session credential. Subsequent calls error until epf_reauth.",
      inputSchema: {},
    },
    async () => {
      if (!auth.isAuthenticated()) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ loggedOut: true, wasAuthenticated: false }, null, 2),
            },
          ],
        };
      }
      const state = auth.current();
      try {
        await client.request({
          method: "POST",
          path: "/api/v2/epf/logout",
          body: state?.email ? { email: state.email } : undefined,
        });
      } catch (err) {
        if (!(err instanceof EpfError)) throw err;
      }
      auth.clear();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ loggedOut: true, wasAuthenticated: true }, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    "epf_reauth",
    {
      description:
        "Re-authenticate with the credentials supplied at boot. Use after a 401 error or before a known-stale batch.",
      inputSchema: {},
    },
    async () => {
      const state = await auth.reauth("internal://epf_reauth");
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                username: state.username,
                email: state.email,
                roles: state.roles,
                issuedAt: state.issuedAt,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
