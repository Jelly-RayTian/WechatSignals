import { test } from "node:test";
import assert from "node:assert/strict";
import { GreenBubblesPlugin } from "../src/plugins/greenbubbles-plugin";
import type { WechatReader } from "../src/domain/types";
const reader = (readable = false): WechatReader => ({
  detect: async () => ({ readable, code: "test", detail: "safe" }),
  listContacts: async () => [],
  listConversations: async () => [],
  getMessages: async () => [],
});
const preflight = {
  formatVersion: 1,
  clientInstalled: true,
  clientReSigned: false,
  wechatProcessRunning: true,
  databaseCount: 20,
  lldbAvailable: true,
  databaseRoot: "private/path",
  blockers: ["private account"],
  remediation: "arbitrary shell command",
};
test("internal plugin only reports whitelisted local readiness checks", async () => {
  const plugin = new GreenBubblesPlugin(
    reader(),
    async () => preflight,
    async () => false,
  );
  const report = await plugin.inspectConnection();
  assert.equal(report.needsSetup, true);
  assert.equal(report.readable, false);
  assert.equal(report.checks.length, 6);
  assert.ok(!report.checks.find((c) => c.label.includes("重签"))!.ok);
  assert.ok(!report.checks.find((c) => c.label === "本机数据库密钥已就绪")!.ok);
  assert.ok(!JSON.stringify(report).includes("private"));
  assert.ok(!JSON.stringify(report).includes("arbitrary"));
});
test("readable source connects directly with no setup or key capture", async () => {
  let probes = 0;
  const plugin = new GreenBubblesPlugin(
    reader(true),
    async () => {
      probes++;
      return preflight;
    },
    async () => false,
  );
  const report = await plugin.inspectConnection();
  assert.equal(report.readable, true);
  assert.equal(report.needsSetup, false);
  assert.equal(probes, 0);
});
test("preflight schema drift fails closed instead of inventing permission state", async () => {
  const plugin = new GreenBubblesPlugin(
    reader(),
    async () => ({ ...preflight, formatVersion: 2 }),
    async () => false,
  );
  await assert.rejects(() => plugin.inspectConnection(), /协议/);
});
