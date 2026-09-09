import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, ConfigError } from "../src/config.js";
import { makeRig, parseToolText, type TestRig } from "./helpers.js";

describe("config", () => {
  it("rejects missing EPF_USERNAME", () => {
    expect(() =>
      loadConfig({ EPF_PASSWORD: "p" }),
    ).toThrow(ConfigError);
  });

  it("rejects missing EPF_PASSWORD", () => {
    expect(() =>
      loadConfig({ EPF_USERNAME: "u" }),
    ).toThrow(ConfigError);
  });

  it("applies defaults", () => {
    const c = loadConfig({ EPF_USERNAME: "u", EPF_PASSWORD: "p" });
    expect(c.baseUrl).toBe("https://epf.usps.gov/up");
    expect(c.downloadDir).toMatch(/\/epf\/downloads$/);
    expect(c.timeoutMs).toBe(30_000);
    expect(c.logLevel).toBe("info");
  });

  it("expands ~ in download dir", () => {
    const c = loadConfig({
      EPF_USERNAME: "u",
      EPF_PASSWORD: "p",
      EPF_DOWNLOAD_DIR: "~/custom-epf",
    });
    expect(c.downloadDir).toMatch(/custom-epf$/);
    expect(c.downloadDir.startsWith(process.env.HOME ?? "/")).toBe(true);
  });
});

describe("auth + tool surface", () => {
  let rig: TestRig;
  beforeEach(async () => {
    rig = await makeRig();
  });
  afterEach(async () => {
    await rig.cleanup();
  });

  it("calls login once at boot", () => {
    expect(rig.epf.loginCount()).toBe(1);
  });

  it("epf_version returns server version", async () => {
    const res = await rig.client.callTool({ name: "epf_version", arguments: {} });
    expect(res.isError).toBeFalsy();
    const parsed = parseToolText(res as never) as { version: string };
    expect(parsed.version).toBe("v3.1.0-test");
  });

  it("epf_acs_list returns parsed list", async () => {
    const res = await rig.client.callTool({ name: "epf_acs_list", arguments: {} });
    const parsed = parseToolText(res as never) as Array<{ fileId: string }>;
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.fileId).toBe("acs-001");
  });

  it("epf_acs_list transparently re-auths on 401", async () => {
    await rig.cleanup();
    rig = await makeRig({ failAcsOnce: true });
    const before = rig.epf.loginCount();
    const res = await rig.client.callTool({ name: "epf_acs_list", arguments: {} });
    expect(res.isError).toBeFalsy();
    expect(rig.epf.loginCount()).toBe(before + 1);
  });

  it("epf_download_list returns parsed list", async () => {
    const res = await rig.client.callTool({ name: "epf_download_list", arguments: {} });
    const parsed = parseToolText(res as never) as Array<{ fileId: string }>;
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.fileId).toBe("dl-001");
  });

  it("epf_download_epf_file streams bytes to disk and returns metadata only", async () => {
    const res = await rig.client.callTool({
      name: "epf_download_epf_file",
      arguments: { fileId: "abc-123" },
    });
    const parsed = parseToolText(res as never) as {
      fileId: string;
      savedTo: string;
      contentType: string;
      byteLength: number;
      sha256: string;
      downloadedAt: string;
    };
    expect(parsed.fileId).toBe("abc-123");
    expect(parsed.contentType).toBe("application/zip");
    expect(parsed.byteLength).toBe(rig.epf.downloadFileBytes().length);
    expect(parsed.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(parsed.downloadedAt).toMatch(/T/);
    // Bytes never returned in the tool result.
    const serialized = JSON.stringify(res);
    expect(serialized).not.toContain("zip-stream-payload");
  });

  it("epf_update_status echoes back the update", async () => {
    const res = await rig.client.callTool({
      name: "epf_update_status",
      arguments: { fileId: "f-1", status: "C" },
    });
    const parsed = parseToolText(res as never) as { fileid: string; newstatus: string; ok: boolean };
    expect(parsed).toEqual({ fileid: "f-1", newstatus: "C", ok: true });
  });

  it("epf_reauth re-runs login", async () => {
    const before = rig.epf.loginCount();
    await rig.client.callTool({ name: "epf_reauth", arguments: {} });
    expect(rig.epf.loginCount()).toBe(before + 1);
  });

  it("epf_logout clears local creds and subsequent calls error", async () => {
    await rig.client.callTool({ name: "epf_logout", arguments: {} });
    const res = await rig.client.callTool({ name: "epf_acs_list", arguments: {} });
    expect(res.isError).toBe(true);
    const text = (res.content[0] as { text: string }).text;
    expect(text).toMatch(/\[EPF 401\]/);
  });

  it("Zod rejects unsafe fileId", async () => {
    const res = await rig.client.callTool({
      name: "epf_download_epf_file",
      arguments: { fileId: "../etc/passwd" },
    });
    expect(res.isError).toBe(true);
  });
});