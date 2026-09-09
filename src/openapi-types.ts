// Auto-generated snapshot of https://epf.usps.gov/up/v3/api-docs.
// Regenerate with `npm run codegen`. Do not hand-edit.
import specJson from "./openapi-types.json" with { type: "json" };

export type OpenApiOperation = {
  tags?: string[];
  operationId?: string;
  parameters?: Array<{
    name: string;
    in: "query" | "path" | "header" | "cookie";
    required?: boolean;
    schema?: OpenApiSchema;
  }>;
  requestBody?: {
    required?: boolean;
    content: Record<string, { schema?: OpenApiSchema }>;
  };
  responses: Record<string, { description: string; content?: Record<string, { schema?: OpenApiSchema }> }>;
};

export type OpenApiSchema =
  | { type: "string"; format?: string; enum?: string[] }
  | { type: "number" | "integer"; format?: string; enum?: number[] }
  | { type: "boolean"; enum?: boolean[] }
  | { type: "object"; properties?: Record<string, OpenApiSchema>; required?: string[]; additionalProperties?: boolean }
  | { type: "array"; items: OpenApiSchema }
  | { $ref: string };

export type PathMethod = "get" | "post" | "put" | "delete" | "patch";

export interface OpenApiSpec {
  openapi: string;
  info: { title: string; version: string };
  servers: Array<{ url: string }>;
  security: Array<Record<string, string[]>>;
  paths: Record<string, Record<string, OpenApiOperation>>;
  components: {
    securitySchemes: Record<string, { type: string; scheme?: string; bearerFormat?: string }>;
    schemas: Record<string, OpenApiSchema>;
  };
}

export const openapiSpec = specJson as OpenApiSpec;
