import { test } from "node:test";
import assert from "node:assert/strict";
import type { Message, View } from "../src/domain/types";
import { ApplicationService } from "../src/application/service";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
const msg = (i: number, patch: Partial<Message> = {}): Message => ({
  id: `m${i}`,
  conversationId: "chat",
  timestamp: i,
  sender: i % 2 ? "other" : "me",
  kind: "text",
  text: `ordinary ${i}`,
  ...patch,
});

test("full loaded-range search reaches old messages outside recent 300 without reader or Jev calls", async () => {
  const rows = Array.from({ length: 420 }, (_, i) => msg(i));
  rows[0].text = "旧消息 needle";
  let reads = 0,
    calls = 0;
  const reader: any = {
    listContacts: async () => [],
    listConversations: async () => [
      { id: "chat", displayName: "Synthetic", updatedAt: 419 },
    ],
    getMessagePage: async () => {
      reads++;
      return { messages: rows, hasMore: false, crossDatabaseAtomic: true };
    },
  };
  const repo: any = {
    cacheContacts: () => {},
    cacheMessages: () => {},
    latest: () => null,
  };
  const service = new ApplicationService(
    reader,
    {
      analyze: async () => {
        calls++;
        throw Error("unexpected network");
      },
    } as any,
    repo,
  );
  await service.list();
  const job = service.startRead("chat", { until: 1000, label: "Synthetic" });
  let done = service.job(job.id);
  for (let i = 0; done.state === "running" && i < 100; i++) {
    await new Promise((r) => setTimeout(r, 5));
    done = service.job(job.id);
  }
  assert.equal(done.state, "complete");
  assert.equal(done.view!.messages.length, 300);
  assert.equal(typeof (service as any).searchMessages, "function");
  const result = (service as any).searchMessages("chat", { text: "needle" });
  assert.equal(result.total, 1);
  assert.equal(result.messages[0].id, "m0");
  assert.equal(result.scanned, 420);
  assert.throws(() => (service as any).searchMessages("not-loaded", {}));
  assert.equal(reads, 1);
  assert.equal(calls, 0);
});

test("search hydrates cached audio text and observes manual corrections outside latest UI window", async () => {
  const rows = Array.from({ length: 350 }, (_, i) => msg(i));
  rows[0] = { ...rows[0], kind: "voice", text: "[语音]" };
  let transcript = "保存的旧转写",
    reviewed = false;
  const repo: any = {
    cacheContacts: () => {},
    cacheMessages: () => {},
    latest: () => null,
    getTranscript: () => transcript,
    getTranscriptReview: () => reviewed,
    saveTranscript: (_: string, text: string) => {
      transcript = text;
    },
    saveTranscriptReview: () => {
      reviewed = true;
    },
  };
  const reader: any = {
    listContacts: async () => [],
    listConversations: async () => [
      { id: "chat", displayName: "synthetic", updatedAt: 349 },
    ],
    getMessagePage: async () => ({
      messages: rows,
      hasMore: false,
      crossDatabaseAtomic: true,
    }),
  };
  const service = new ApplicationService(
    reader,
    {
      analyze: async () => {
        throw Error("no model");
      },
    } as any,
    repo,
  );
  await service.list();
  const read = service.startRead("chat", { until: 1000, label: "test" });
  for (let i = 0; service.job(read.id).state === "running" && i < 100; i++)
    await new Promise((r) => setTimeout(r, 5));
  assert.equal(
    service.searchMessages("chat", { text: "旧转写" }).messages[0].id,
    "m0",
  );
  service.editTranscript("chat", "m0", "人工校正后的文字");
  assert.equal(service.searchMessages("chat", { text: "旧转写" }).total, 0);
  const updated = service.searchMessages("chat", { text: "人工校正" });
  assert.equal(updated.messages[0].transcriptReviewed, true);
});

test("search combines normalized terms with sender and type, includes transcript and OCR but not local metadata", async () => {
  const { searchLoadedMessages } =
    await import("../src/application/message-search");
  const rows = [
    msg(1, { kind: "voice", transcript: "Ｃａｆｅ 约定", text: "[语音]" }),
    msg(2, {
      kind: "image",
      media: {
        version: "vision-local-v2",
        status: "recognized",
        text: "Cafe 约定",
        confidence: null,
        labels: [{ name: "hidden-tag", confidence: 0.9 }],
      },
    }),
    msg(3, { text: "CAFE 其他" }),
  ];
  assert.deepEqual(
    searchLoadedMessages(rows, { text: "cafe 约定" }).messages.map((m) => m.id),
    ["m2", "m1"],
  );
  assert.equal(
    searchLoadedMessages(rows, { text: "cafe", sender: "other", kind: "voice" })
      .total,
    1,
  );
  assert.equal(searchLoadedMessages(rows, { text: "hidden-tag" }).total, 0);
  assert.equal(searchLoadedMessages(rows, { text: "[语音]" }).total, 0);
  assert.equal(searchLoadedMessages(rows, { text: ".*" }).total, 0);
});

test("search pagination is bounded and deterministic, out-of-range offset clamps; rejects malformed queries", async () => {
  const { searchLoadedMessages } =
    await import("../src/application/message-search");
  const rows = Array.from({ length: 125 }, (_, i) => msg(i));
  const first = searchLoadedMessages(rows, {}),
    second = searchLoadedMessages(rows, { offset: 50 });
  assert.equal(first.messages.length, 50);
  assert.equal(first.total, 125);
  assert.equal(second.offset, 50);
  assert.equal(
    new Set([...first.messages, ...second.messages].map((m) => m.id)).size,
    100,
  );
  const last = searchLoadedMessages(rows, { offset: 999 });
  assert.equal(last.offset, 100);
  assert.equal(last.messages.length, 25);
  for (const q of [
    { text: "x".repeat(201) },
    { offset: -1 },
    { offset: 1.1 },
    { kind: "anything" },
    { sender: "wxid_private" },
  ])
    assert.throws(() => searchLoadedMessages(rows, q as any));
  assert.deepEqual(
    rows.map((m) => m.id),
    Array.from({ length: 125 }, (_, i) => `m${i}`),
  );
});

test("report snapshot status distinguishes read range, partial output, review and no result without claiming content freshness", async () => {
  const { reportSnapshot } = await import("../src/ui/report-status");
  const { metricLabels } = await import("../src/domain/types");
  const view: any = {
    coverage: {
      complete: true,
      count: 200,
      range: { since: 0, until: 1000, label: "current" },
    },
    analysis: {
      status: "complete",
      messageCount: 190,
      inputCoverage: { total: 200 },
      createdAt: 1000,
      range: { since: 0, until: 1000, label: "saved" },
      metrics: Object.fromEntries(
        Object.keys(metricLabels).map((k) => [
          k,
          { score: 20, quality: "sufficient" },
        ]),
      ),
    },
  };
  assert.equal(reportSnapshot(view).tone, "saved");
  assert.ok(reportSnapshot(view).detail.includes("快照"));
  view.analysis.metrics.flirting.quality = "limited";
  assert.equal(reportSnapshot(view).reviewCount, 1);
  view.analysis.range.until = 500;
  assert.equal(reportSnapshot(view).tone, "different-range");
  view.analysis.status = "partial";
  assert.equal(reportSnapshot(view).tone, "partial");
  view.analysis = null;
  assert.equal(reportSnapshot(view).tone, "empty");
});

test("search workspace renders explicit local scope and semantic controls without leaking queries to URLs", async () => {
  const { MessageBrowser } = await import("../src/ui/message-browser");
  const html = renderToStaticMarkup(
    React.createElement(MessageBrowser, {
      conversationId: "chat",
      revision: "v1",
      coverage: {
        count: 400,
        complete: false,
        range: { label: "近30天" },
      } as any,
      search: async () => {
        throw Error("SSR must not search");
      },
      renderMessage: (m: Message) => React.createElement("p", null, m.text),
    }),
  );
  assert.ok(html.includes("搜索聊天文字"));
  assert.ok(html.includes("发送者"));
  assert.ok(html.includes("消息类型"));
  assert.ok(html.includes("已读范围"));
  assert.ok(html.includes("仍有未读取"));
  assert.ok(!html.includes("href="));
});
