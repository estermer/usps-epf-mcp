import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthStore } from "../src/auth.js";
import { EpfClient } from "../src/epf-client.js";
import { makeRig, parseToolText, type TestRig } from "./helpers.js";

describe("downloads", () => {
  let rig: TestRig;
  beforeEach(async () => {
    rig = await makeRig();
  });
  afterEach(async () => {
    await rig.cleanup();
  });

  it("uses POST /api/v2/download/status", async () => {
    const before = rig.epf.requestCount();
    await rig.client.callTool({
      name: "epf_update_status",
      arguments: { fileId: "f-2", status: "S" },
    });
    expect(rig.epf.requestCount()).toBe(before + 1);
  });

  it("rejects invalid status enum", async () => {
    const before = rig.epf.requestCount();
    const res = await rig.client.callTool({
      name: "epf_update_status",
      arguments: { fileId: "f-2", status: "OPENED" },
    });
    expect(res.isError).toBe(true);
    expect(rig.epf.requestCount()).toBe(before);
  });

  it("epf_download_list queries GET /api/v2/download/dnldlist with productId=PARENT", async () => {
    const res = await rig.client.callTool({ name: "epf_download_list", arguments: {} });
    const parsed = parseToolText(res as never) as Array<{ fileId: string }>;
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.fileId).toBe("dl-001");
  });

  it("epf_download_list forwards status array as comma-joined query param", async () => {
    const res = await rig.client.callTool({
      name: "epf_download_list",
      arguments: { status: ["N", "S"] },
    });
    expect(res.isError).toBeFalsy();
    const parsed = parseToolText(res as never) as Array<{ fileId: string }>;
    expect(parsed).toHaveLength(2);
  });

  it("epf_acs_list queries GET /api/v2/download/acslist with productId=PARENT", async () => {
    const res = await rig.client.callTool({ name: "epf_acs_list", arguments: {} });
    const parsed = parseToolText(res as never) as Array<{ fileId: string }>;
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.fileId).toBe("acs-001");
  });
});

describe("AuthStore reauth semantics", () => {
  let rig: TestRig;
  beforeEach(async () => {
    rig = await makeRig();
  });
  afterEach(async () => {
    await rig.cleanup();
  });

  it("throws when no prior credentials exist", async () => {
    const auth = new AuthStore(async () => ({
      jwt: "x",
      logonkey: "y",
    }));
    await expect(auth.reauth("internal://x")).rejects.toThrow(/no prior credentials/);
  });

  it("reauth uses stored credentials and updates state", async () => {
    const auth = new AuthStore(async (u) => ({
      jwt: `jwt-for-${u}`,
      logonkey: "lk",
    }));
    await auth.bootLogin({ username: "u1", password: "p1" });
    const before = auth.current()?.issuedAt;
    await new Promise((r) => setTimeout(r, 5));
    const state = await auth.reauth("internal://x");
    expect(state.username).toBe("u1");
    expect(state.issuedAt).not.toBe(before);
    expect(state.jwt).toBe("jwt-for-u1");
  });

  it("clear wipes state and credentials", async () => {
    const auth = new AuthStore(async () => ({ jwt: "j", logonkey: "l" }));
    await auth.bootLogin({ username: "u1", password: "p1" });
    auth.clear();
    expect(auth.isAuthenticated()).toBe(false);
    expect(auth.hasStoredCredentials()).toBe(false);
  });

  it("EpfClient.downloadFile requires authentication", async () => {
    const client = new EpfClient(
      "http://x",
      new AuthStore(async () => ({ jwt: "j", logonkey: "l" })),
      1000,
      "/tmp",
    );
    await expect(client.downloadFile("safe-id")).rejects.toThrow(/not authenticated/);
  });
});