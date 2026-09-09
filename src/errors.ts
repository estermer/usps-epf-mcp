import type { TextContent } from "@modelcontextprotocol/sdk/types.js";

export class EpfError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly endpoint: string,
    public override readonly cause: string,
  ) {
    super(`[EPF ${statusCode}] ${endpoint}: ${cause}`);
    this.name = "EpfError";
  }
}

export class InputError extends Error {
  constructor(
    public readonly toolName: string,
    public readonly field: string,
    public readonly reason: string,
  ) {
    super(`[INPUT] ${toolName}: ${field}: ${reason}`);
    this.name = "InputError";
  }
}

export function epfErrorText(err: EpfError): TextContent {
  return { type: "text", text: err.message };
}

export function inputErrorText(err: InputError): TextContent {
  return { type: "text", text: err.message };
}

export function genericErrorText(message: string): TextContent {
  return { type: "text", text: `[EPF] ${message}` };
}
