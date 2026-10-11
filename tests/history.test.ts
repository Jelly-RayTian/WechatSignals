import { fixtureAnswers } from "./jev-fixture";
import { test } from "node:test";
import assert from "node:assert/strict";
import { ApplicationService } from "../src/application/service";
import { JevAnalysisService, buildRequest } from "../src/infrastructure/jev-legacy";
import { prepareBatches } from "../src/application/batches";
import { chartData } from "../src/application/charts";
import { GreenBubblesAdapter } from "../src/infrastructure/greenbubbles";
import type {
  Message,
  Contact,
  WechatReader,
  Analysis,
  Job,
} from "../src/domain/types";
const contacts: Contact[] = [
  {
    id: "self",
    displayName: "自己",
    aliases: ["self", "自己"],
    isMe: true,
    kind: "accountHolder",
  },
  {
    id: "friend",
    displayName: "朋友",
    aliases: ["friend", "朋友"],
    isMe: false,
    kind: "person",
  },
];
const messages = Array.from({ length: 1205 }, (_, i): Message => ({
  id: String(i),
  conversationId: "friend",
  sender: i % 2 ? "other" : "me",
  timestamp: 1000 + i,
  text: "自己和朋友的合成测试消息。".repeat(12),
  kind: "text",
}));
const range = { since: 1000, until: 3000, label: "合成数据范围" };
const secrets = {
  get: async () => "test-key",
  set: async () => {},
  delete: async () => {},
};
const answers = fixtureAnswers(2, 0.6);
function fixture(
  overrides: Partial<WechatReader> = {},
  transport: typeof fetch = async () =>
    new Response(JSON.stringify({ model: "jev-1.13.0", answers })),
) {
  let latest: Analysis | null = null;
  const reader: WechatReader = {
    detect: async () => ({ readable: true, code: "ready", detail: "" }),
    listContacts: async () => contacts,
    listConversations: async () => [
      { id: "friend", displayName: "合成联系人", updatedAt: 2000 },
    ],
    getMessages: async () => messages.slice(-200),
    getMessagePage: async (_id, q) => {
      const offset = q.cursor ? Number(q.cursor) : 0;
      const rows = messages.slice(offset, offset + 500);
      return {
        messages: rows,
        hasMore: offset + 500 < messages.length,
        nextCursor:
          offset + 500 < messages.length ? String(offset + 500) : undefined,
        crossDatabaseAtomic: false,
      };
    },
    ...overrides,
  };
  const repo = {
    save: (a: Analysis) => (latest = a),
    latest: () => latest,
    cacheContacts: () => {},
    cacheMessages: () => {},
  };
  return new ApplicationService(
    reader,
    new JevAnalysisService(secrets, transport),
    repo,
  );
}
async function done(service: ApplicationService, id: string): Promise<Job> {
  for (let i = 0; i < 1000; i++) {
    const job = service.job(id);
    if (job.state !== "running") return job;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("task did not finish");
}
test("history paging reads beyond 200, records coverage, and renders bounded recent messages", async () => {
  let queries: any[] = [];
  const service = fixture({
    getMessagePage: async (_id, q) => {
      queries.push(q);
      const offset = Number(q.cursor || 0);
      return {
        messages: messages.slice(offset, offset + 500),
        hasMore: offset + 500 < messages.length,
        nextCursor:
          offset + 500 < messages.length ? String(offset + 500) : undefined,
        crossDatabaseAtomic: false,
      };
    },
  });
  await service.list();
  const job = await done(service, service.startRead("friend", range).id);
  assert.equal(job.state, "complete");
  assert.equal(job.count, 1205);
  assert.equal(job.pages, 3);
  assert.equal(job.view?.coverage?.complete, true);
  assert.equal(job.view?.coverage?.crossDatabaseAtomic, false);
  assert.equal(job.view?.messages.length, 300);
  assert.equal(job.view?.stats.me.count + job.view!.stats.other.count, 1205);
  assert.deepEqual(
    queries.map((q) => q.cursor),
    [undefined, "500", "1000"],
  );
  assert.ok(queries.every((q) => q.since === 1000 && q.until === 3000));
});
test("read failure preserves partial data and never permits complete-range analysis", async () => {
  const service = fixture({
    getMessagePage: async (_id, q) => {
      if (q.cursor) throw new Error("private database path");
      return {
        messages: messages.slice(0, 500),
        hasMore: true,
        nextCursor: "500",
        crossDatabaseAtomic: false,
      };
    },
  });
  await service.list();
  const job = await done(service, service.startRead("friend", range).id);
  assert.equal(job.state, "failed");
  assert.equal(job.view?.coverage?.complete, false);
  assert.equal(job.count, 500);
  assert.ok(!job.detail.includes("private"));
  await assert.rejects(() => service.previewPlan("friend"));
});
test("duplicate cursor fails instead of claiming history complete", async () => {
  const service = fixture({
    getMessagePage: async () => ({
      messages: messages.slice(0, 2),
      hasMore: true,
      nextCursor: "same",
      crossDatabaseAtomic: false,
    }),
  });
  await service.list();
  assert.equal(
    (await done(service, service.startRead("friend", range).id)).state,
    "failed",
  );
});
test("batches cover every eligible message within byte budget; metadata never enters states", () => {
  const prepared = prepareBatches(messages, contacts, "friend");
  assert.ok(prepared.states.length > 1);
  assert.equal(prepared.plan.messageCount, 1205);
  assert.equal(
    prepared.plan.batches.reduce((n, b) => n + b.messageCount, 0),
    1205,
  );
  for (const state of prepared.states) {
    assert.ok(Buffer.byteLength(state) <= 12000);
    assert.ok(!state.includes("timestamp"));
    assert.ok(!state.includes("conversationId"));
    assert.ok(!state.includes("自己"));
    assert.ok(!state.includes("朋友"));
  }
});
test("browsing and preview send nothing, explicit confirmation sends every approved batch", async () => {
  let requests = 0;
  const service = fixture({}, async () => {
    requests++;
    return new Response(JSON.stringify({ model: "jev-1.13.0", answers }));
  });
  await service.list();
  await done(service, service.startRead("friend", range).id);
  const plan = await service.previewPlan("friend");
  await service.previewBatch(plan.token, 0);
  assert.equal(requests, 0);
  assert.throws(() => service.startAnalysis("friend", "invalid"));
  const job = await done(
    service,
    service.startAnalysis("friend", plan.token).id,
  );
  assert.equal(job.state, "complete");
  assert.equal(requests, plan.batches.length);
  assert.equal(job.analysis?.messageCount, 1205);
  assert.equal(job.analysis?.status, "complete");
  assert.equal(job.analysis?.metrics.flirting.confidence, null);
  assert.equal(
    job.analysis?.segments?.[0].result.metrics.flirting.confidence,
    0.6,
  );
  assert.throws(() => service.startAnalysis("friend", plan.token));
});
test("Jev batch failure saves only succeeded segments and labels the result partial", async () => {
  let requests = 0;
  const service = fixture({}, async () => {
    requests++;
    if (requests === 2)
      return new Response("private response", { status: 429 });
    return new Response(JSON.stringify({ model: "jev-1.13.0", answers }));
  });
  await service.list();
  await done(service, service.startRead("friend", range).id);
  const plan = await service.previewPlan("friend");
  const job = await done(
    service,
    service.startAnalysis("friend", plan.token).id,
  );
  assert.equal(job.state, "failed");
  assert.equal(job.completedBatches, 1);
  assert.equal(job.view?.analysis?.status, "partial");
  assert.equal(job.view?.analysis?.segments?.length, 1);
  assert.ok(!job.detail.includes("private"));
  assert.equal(requests, 2);
});
test("stop prevents further requests and never marks incomplete work complete", async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  let calls = 0;
  const service = fixture({
    getMessagePage: async () => {
      calls++;
      await gate;
      return {
        messages: messages.slice(0, 2),
        hasMore: true,
        nextCursor: "next",
        crossDatabaseAtomic: false,
      };
    },
  });
  await service.list();
  const job = service.startRead("friend", range);
  service.cancelJob(job.id);
  release();
  const result = await done(service, job.id);
  assert.equal(result.state, "cancelled");
  assert.equal(result.view?.coverage?.complete, false);
  assert.equal(calls, 1);
});
test("charts conserve known-sender counts and reply buckets", () => {
  const charts = chartData(messages);
  assert.equal(
    charts.daily.reduce((n, d) => n + d.me + d.other, 0),
    1205,
  );
  assert.equal(
    charts.hourly.reduce((n, d) => n + d.me + d.other, 0),
    1205,
  );
  assert.equal(
    charts.replies.reduce((n, d) => n + d.me + d.other, 0),
    1204,
  );
});
test("reader passes official time-window and cursor flags and rejects foreign conversation data", async () => {
  const calls: string[][] = [];
  const reader = new GreenBubblesAdapter(async (args) => {
    calls.push(args);
    return JSON.stringify({
      schema: "greenbubbles.query.v1",
      formatVersion: 1,
      source: { identity: "fixture" },
      ok: true,
      page: { hasMore: false },
      warnings: [],
      consistency: { coverageComplete: true, crossDatabaseAtomic: false },
      items:
        args[0] === "contacts"
          ? contacts.map((c) => ({
              id: c.id,
              displayName: c.displayName,
              kind: c.kind,
              isAccountHolder: c.isMe,
            }))
          : [
              {
                id: "m",
                conversationId: "wrong",
                sender: "self",
                createdAtUnix: 1000,
                messageType: 1,
                content: { Text: "synthetic" },
                contentDecodeState: "complete",
                contentTruncated: false,
              },
            ],
    });
  });
  await assert.rejects(
    () =>
      reader.getMessagePage("friend", {
        since: 1000,
        until: 3000,
        cursor: "cursor1",
        limit: 500,
      }),
    /其他会话/,
  );
  const query = calls.at(-1)!;
  assert.deepEqual(query.slice(-7), [
    "--since",
    "1000",
    "--until",
    "3000",
    "--cursor",
    "cursor1",
    "--json",
  ]);
});
test("large history stops at explicit protection limit and continues without truncating or duplicating", async () => {
  const large = Array.from({ length: 50501 }, (_, i): Message => ({
    ...messages[0],
    id: String(i),
    timestamp: 1000,
    text: "x",
  }));
  const service = fixture({
    getMessagePage: async (_id, q) => {
      const offset = Number(q.cursor || 0);
      return {
        messages: large.slice(offset, offset + 500),
        hasMore: offset + 500 < large.length,
        nextCursor:
          offset + 500 < large.length ? String(offset + 500) : undefined,
        crossDatabaseAtomic: false,
      };
    },
  });
  await service.list();
  let job = await done(service, service.startRead("friend", range).id);
  assert.equal(job.state, "limited");
  assert.equal(job.count, 50000);
  assert.equal(job.view?.coverage?.complete, false);
  await assert.rejects(() => service.previewPlan("friend"));
  job = await done(service, service.startRead("friend", range, true).id);
  assert.equal(job.state, "complete");
  assert.equal(job.count, 50501);
  assert.equal(job.view?.coverage?.complete, true);
});
test("chart includes silent days inside requested range", () => {
  const day = Math.floor(new Date("2026-01-01T12:00:00").getTime() / 1000);
  const chart = chartData([{ ...messages[0], timestamp: day }], {
    since: day,
    until: day + 2 * 86400,
    label: "three days",
  });
  assert.equal(chart.daily.length, 3);
  assert.equal(chart.daily[1].me + chart.daily[1].other, 0);
});
