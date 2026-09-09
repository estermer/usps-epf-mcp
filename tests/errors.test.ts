import { describe, expect, it } from "vitest";
import { EpfError, InputError } from "../src/errors.js";

describe("errors", () => {
  it("EpfError formats as [EPF <code>] <endpoint>: <cause>", () => {
    const err = new EpfError(401, "GET /api/v2/download/acslist", "reauth failed: bad creds");
    expect(err.message).toBe(
      "[EPF 401] GET /api/v2/download/acslist: reauth failed: bad creds",
    );
    expect(err.statusCode).toBe(401);
    expect(err.endpoint).toBe("GET /api/v2/download/acslist");
    expect(err.cause).toBe("reauth failed: bad creds");
  });

  it("InputError formats as [INPUT] <tool>: <field>: <reason>", () => {
    const err = new InputError("epf_login", "pword", "must be at least 1 char");
    expect(err.message).toBe("[INPUT] epf_login: pword: must be at least 1 char");
  });
});