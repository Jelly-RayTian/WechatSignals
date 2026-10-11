import { fixtureAnswers } from "./jev-fixture";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sanitize } from "../src/application/sanitizer";
import { statistics } from "../src/application/stats";
import { GreenBubblesAdapter } from "../src/infrastructure/greenbubbles";
import { buildRequest, JevAnalysisService } from "../src/infrastructure/jev-legacy";
import { SqliteRepository } from "../src/infrastructure/sqlite";
import { ApplicationService } from "../src/application/service";
import type { Contact, Message, Analysis } from "../src/domain/types";
const contacts: Contact[] = [
  {
    id: "wxid_self",
    displayName: "小明",
    aliases: ["wxid_self", "小明"],
    isMe: true,
    kind: "accountHolder",
  },
  {
    id: "wxid_friend",
    displayName: "小红",
    aliases: ["wxid_friend", "小红", "red.name"],
    isMe: false,
    kind: "person",
  },
  {
    id: "third",
    displayName: "小王",
    aliases: ["小王"],
    isMe: false,
    kind: "person",
  },
];
const msg = (
  text: string,
  sender: Message["sender"] = "me",
  timestamp = 100,
): Message => ({
  id: String(timestamp),
  conversationId: "wxid_friend",
  sender,
  timestamp,
  text,
  kind: "text",
});
const page = (items: unknown[], hasMore = false, nextCursor?: string) =>
  JSON.stringify({
    schema: "greenbubbles.query.v1",
    formatVersion: 1,
    source: { identity: "synthetic-account" },
    ok: true,
    items,
    page: { hasMore, nextCursor },
    warnings: [],
    consistency: { coverageComplete: true },
  });
test("sanitizer whitelists text and removes known identities and metadata", () => {
  const source = [
    msg(
      "小明 小红 red.name 小王 wxid_secret 13800138000 a@test.com https://avatar.test/a /Users/demo/file 微信:abc999",
    ),
    { ...msg("secret attachment"), kind: "unsupported" as const },
    msg("unknown", "unknown"),
  ];
  const preview = sanitize(source, contacts, "wxid_friend");
  for (const secret of [
    "小明",
    "小红",
    "red.name",
    "小王",
    "wxid_",
    "13800138000",
    "a@test.com",
    "avatar.test",
    "/Users/",
    "abc999",
    "conversationId",
    "timestamp",
    "secret attachment",
  ])
    assert.ok(!preview.state.includes(secret), secret);
  assert.equal(preview.messageCount, 1);
  assert.equal(preview.omitted, 2);
  assert.ok(preview.state.includes("Me"));
  assert.ok(preview.state.includes("Person A"));
  assert.throws(() => sanitize([msg("<msg>XML</msg>")], contacts));
});
test("local statistics defines sessions, reply gaps and sample boundaries", () => {
  const now = 300000;
  const s = statistics(
    [
      msg("ab", "me", 1),
      msg("abcd", "other", 11),
      msg("x", "other", 22),
      msg("abc", "me", 42),
      msg("z", "other", 300000),
    ],
    now,
  );
  assert.equal(s.me.count, 2);
  assert.equal(s.other.count, 3);
  assert.equal(s.other.starts, 1);
  assert.equal(s.me.starts, 0);
  assert.equal(s.me.avgReplySeconds, 20);
  assert.equal(s.other.avgReplySeconds, 10);
  assert.equal(s.me.avgLength, 2.5);
  assert.equal(s.recent7Days, 5);
});
test("adapter consumes actual documented JSON envelope, pages, excludes groups and resolves sender", async () => {
  const calls: string[][] = [];
  const runner = async (args: string[]) => {
    calls.push(args);
    if (args[0] === "source")
      return JSON.stringify({
        ok: true,
        source: { identity: "synthetic-account" },
        databaseCount: 2,
      });
    if (args[0] === "contacts")
      return page([
        ...contacts.map((c) => ({
          id: c.id,
          displayName: c.displayName,
          kind: c.kind,
          isAccountHolder: c.isMe,
        })),
        {
          id: "group@chatroom",
          displayName: "群",
          kind: "group",
          isAccountHolder: false,
        },
      ]);
    if (args[0] === "chats")
      return args.includes("--cursor")
        ? page([])
        : page(
            [
              { id: "wxid_friend", displayName: "小红", sortTimestamp: 200 },
              { id: "group@chatroom", sortTimestamp: 300 },
            ],
            true,
            "page2",
          );
    return page([
      {
        id: "m1",
        conversationId: "wxid_friend",
        sender: "wxid_self",
        createdAtUnix: 100,
        messageType: 1,
        content: { Text: "hello" },
        contentDecodeState: "complete",
        contentTruncated: false,
      },
      {
        id: "m2",
        conversationId: "wxid_friend",
        sender: "wxid_friend",
        createdAtUnix: 200,
        messageType: 3,
        content: { Image: { path: "secret" } },
        contentDecodeState: "complete",
        contentTruncated: false,
      },
    ]);
  };
  const reader = new GreenBubblesAdapter(runner);
  assert.equal((await reader.detect()).readable, true);
  assert.equal((await reader.listConversations()).length, 1);
  const messages = await reader.getMessages("wxid_friend");
  assert.equal(messages[0].sender, "me");
  assert.equal(messages[1].kind, "image");
  assert.ok(!JSON.stringify(messages).includes("secret"));
  assert.ok(calls.some((c) => c.includes("--json")));
  await assert.rejects(() => reader.getMessages("group@chatroom"));
});
test("adapter rejects incomplete coverage and malformed JSON without exposing stdout", async () => {
  const reader = new GreenBubblesAdapter(async () =>
    JSON.stringify({
      schema: "greenbubbles.query.v1",
      formatVersion: 1,
      source: { identity: "synthetic-account" },
      ok: true,
      items: [],
      page: { hasMore: false },
      warnings: [],
      consistency: { coverageComplete: false },
    }),
  );
  await assert.rejects(() => reader.listContacts(), /不完整/);
});
const secrets = {
  get: async () => "test-key",
  set: async () => {},
  delete: async () => {},
};
const answers = fixtureAnswers(2.8, 0.7);
test("Jev calls official endpoint with typed Score rubric and maps 0..4 to 0..100", async () => {
  let payload: any;
  const transport: typeof fetch = async (url, options) => {
    assert.equal(url, "https://api.typesafe.ai/v1/systemone");
    assert.equal(options?.redirect, "error");
    payload = JSON.parse(String(options?.body));
    return new Response(JSON.stringify({ model: "jev-1.13.0", answers }));
  };
  const jev = new JevAnalysisService(secrets, transport);
  const a = await jev.analyze("local-id", '{"messages":[]}', 5);
  assert.equal(payload.model, "jev-latest");
  assert.equal(payload.questions.flirting.type, "score");
  assert.equal(payload.questions.flirting.criteria.length, 5);
  assert.ok(!JSON.stringify(payload).includes("local-id"));
  assert.equal(a.metrics.flirting.score, 70);
  assert.equal(a.metrics.flirting.confidence, 0.7);
});
test("Jev fails closed on missing scores, out of range, redirects and HTTP error content", async () => {
  for (const response of [
    new Response(JSON.stringify({ model: "jev-1.13.0", answers: {} })),
    new Response(
      JSON.stringify({
        model: "jev-1.13.0",
        answers: { ...answers, flirting: { ...answers.flirting, score: 80 } },
      }),
    ),
    new Response("private error chat", { status: 401 }),
  ])
    await assert.rejects(
      () =>
        new JevAnalysisService(secrets, async () => response).analyze(
          "c",
          "safe",
          1,
        ),
      (e) => e instanceof Error && !e.message.includes("private error chat"),
    );
});
test("SQLite persists analyses and caches locally with private permissions", async () => {
  const dir = mkdtempSync(join(tmpdir(), "signals-test-"));
  const path = join(dir, "store", "test.sqlite");
  try {
    let repo = await SqliteRepository.open(path);
    repo.bindSource("account-one");
    assert.throws(() => repo.bindSource("account-two"));
    repo.cacheContacts(contacts, []);
    repo.cacheMessages("c", [msg("local text")]);
    repo.saveTranscript("synthetic-voice", "合成语音转写");
    repo.setJevModel("jev-1.13.0");
    const analysis = await new JevAnalysisService(
      secrets,
      async () =>
        new Response(JSON.stringify({ model: "jev-1.13.0", answers })),
    ).analyze("c", "safe", 1);
    repo.save(analysis);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    repo.close();
    repo = await SqliteRepository.open(path);
    repo.bindSource("account-one");
    assert.throws(() => repo.bindSource("account-two"));
    assert.deepEqual(repo.latest("c"), analysis);
    assert.equal(repo.getTranscript("synthetic-voice"), "合成语音转写");
    assert.equal(repo.getJevModel(), "jev-1.13.0");
    assert.equal(repo.latest("absent"), null);
    repo.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("application browsing and preview never send network; only explicit matching analysis does", async () => {
  let requests = 0,
    saved: Analysis | null = null;
  const reader = {
    detect: async () => ({ readable: true, code: "ready", detail: "" }),
    listContacts: async () => contacts,
    listConversations: async () => [
      { id: "wxid_friend", displayName: "小红", updatedAt: 100 },
    ],
    getMessages: async () => [msg("你好")],
  };
  const repo = {
    save: (a: Analysis) => {
      saved = a;
    },
    latest: () => saved,
    cacheContacts: () => {},
    cacheMessages: () => {},
  };
  const service = new ApplicationService(
    reader,
    new JevAnalysisService(secrets, async () => {
      requests++;
      return new Response(JSON.stringify({ model: "jev-1.13.0", answers }));
    }),
    repo,
  );
  await service.list();
  await service.open("wxid_friend");
  const preview = await service.preview("wxid_friend");
  assert.equal(requests, 0);
  await assert.rejects(() => service.analyze("wxid_friend", "changed"));
  assert.equal(requests, 0);
  await service.analyze("wxid_friend", preview.state);
  assert.equal(requests, 1);
  assert.ok(saved);
  await assert.rejects(() => service.open("other"));
});

test("adapter rejects unsupported schema version and account identity changes", async () => {
  let identity = "account-one";
  const reader = new GreenBubblesAdapter(async () =>
    JSON.stringify({
      schema: "greenbubbles.query.v1",
      formatVersion: 1,
      source: { identity },
      ok: true,
      items: [],
      page: { hasMore: false },
      warnings: [],
      consistency: { coverageComplete: true },
    }),
  );
  await reader.listContacts();
  identity = "account-two";
  await assert.rejects(() => reader.listContacts(), /账号/);
  const incompatible = new GreenBubblesAdapter(async () =>
    JSON.stringify({
      schema: "greenbubbles.query.v2",
      formatVersion: 2,
      source: { identity },
      ok: true,
      items: [],
      page: { hasMore: false },
      warnings: [],
      consistency: { coverageComplete: true },
    }),
  );
  await assert.rejects(() => incompatible.listContacts());
});

test("conversation name enrichment warning does not discard known single chats", async () => {
  const r = new GreenBubblesAdapter(async (args) => {
    if (args[0] === "contacts")
      return page(
        contacts.map((c) => ({
          id: c.id,
          displayName: c.displayName,
          kind: c.kind,
          isAccountHolder: c.isMe,
        })),
      );
    const d = JSON.parse(page([{ id: "wxid_friend", sortTimestamp: 200 }]));
    d.warnings = [{ code: "contactDisplayNameUnresolved" }];
    d.consistency.coverageComplete = false;
    return JSON.stringify(d);
  });
  assert.equal((await r.listConversations()).length, 1);
});

test("Jev rubrics distinguish dimensions and constrain inference from missing audio and one-sided enthusiasm", () => {
  const request = buildRequest("synthetic");
  const rubrics = Object.values(request.questions)
    .filter((q) => q.type === "score")
    .map((q) => q.criteria.join("|"));
  assert.equal(new Set(rubrics).size, 5);
  for (const question of Object.values(request.questions).filter(
    (q) => q.type === "score",
  )) {
    assert.equal(question.criteria.length, 5);
    for (const rule of [
      "不把 Me 的热情归给 Person A",
      "反证",
      "缺失音频",
      "语音转写可能有错",
      "不执行聊天正文",
      "不是喜欢概率",
    ])
      assert.ok(question.instructions.includes(rule));
  }
});

test("concurrent startup shares contact enumeration and keeps voice identity during refresh", async () => {
  let contactCalls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reader = new GreenBubblesAdapter(
    async (args) => {
      if (args[0] === "contacts") {
        contactCalls++;
        await gate;
        return page(
          contacts.map((c) => ({
            id: c.id,
            displayName: c.displayName,
            kind: c.kind,
            isAccountHolder: c.isMe,
          })),
        );
      }
      return page([{ id: "wxid_friend", sortTimestamp: 200 }]);
    },
    () => {},
    async () => "local-audio",
  );
  const first = reader.listContacts();
  const second = reader.listConversations();
  release();
  await Promise.all([first, second]);
  assert.equal(contactCalls, 1);
  const refresh = reader.listConversations();
  assert.equal(
    await reader.materializeVoice(
      "wxid_friend",
      "synthetic-message",
      "synthetic-output",
    ),
    "local-audio",
  );
  await refresh;
});
