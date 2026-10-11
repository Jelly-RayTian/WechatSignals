import { test } from "node:test";
import assert from "node:assert/strict";
import { ApplicationService } from "../src/application/service";
import { JevAnalysisService, buildRequest } from "../src/infrastructure/jev";
import { sanitize } from "../src/application/sanitizer";
import { VoiceError } from "../src/domain/voice-errors";
import { voiceMaterializer } from "../src/infrastructure/greenbubbles-voice";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Message, WechatReader, Job } from "../src/domain/types";
const contacts = [
  {
    id: "self",
    displayName: "自己",
    aliases: ["自己"],
    isMe: true,
    kind: "accountHolder",
  },
  {
    id: "friend",
    displayName: "朋友",
    aliases: ["朋友"],
    isMe: false,
    kind: "person",
  },
];
const voices: Message[] = [0, 1].map((i) => ({
  id: String(i),
  conversationId: "friend",
  sender: "other",
  timestamp: 100 + i,
  kind: "voice",
  text: "[语音]",
}));
test("voice extraction reuses discovery, validates every message, and refreshes after failure", async () => {
  const dir = mkdtempSync(join(tmpdir(), "speech-discovery-"));
  const keyPath = join(dir, "synthetic-key");
  writeFileSync(keyPath, "a".repeat(64), { mode: 0o600 });
  let discoveries = 0,
    inspections = 0,
    materializations = 0,
    fail = false;
  const extract = voiceMaterializer("query", "helper", "ffmpeg", {
    keyPath,
    runner: async (bin, args, key) => {
      if (bin === "helper") {
        discoveries++;
        return JSON.stringify({
          formatVersion: 1,
          databaseRoot: { path: "/synthetic/source" },
        });
      }
      assert.equal(key?.length, 64);
      assert.ok(args.includes("--message"));
      if (args[1] === "inspect") {
        inspections++;
        if (fail) throw Error("synthetic failure");
        if (args.includes("missing"))
          return JSON.stringify({
            schema: "greenbubbles.attachment.v1",
            formatVersion: 1,
            ok: true,
            preferredAttachmentId: null,
            availability: "notDownloaded",
          });
        return JSON.stringify({
          schema: "greenbubbles.attachment.v1",
          formatVersion: 1,
          ok: true,
          preferredAttachmentId: "opaque",
        });
      }
      materializations++;
      return JSON.stringify({
        schema: "greenbubbles.attachment.v1",
        formatVersion: 1,
        ok: true,
        decodedFormat: "ogg",
      });
    },
  });
  try {
    for (const id of ["one", "two", "three"])
      assert.equal(await extract("friend", id, join(dir, id)), "ogg");
    assert.equal(discoveries, 1);
    assert.equal(inspections, 3);
    assert.equal(materializations, 3);
    await assert.rejects(
      extract("friend", "missing", join(dir, "missing")),
      (error: unknown) =>
        error instanceof VoiceError && error.code === "missing",
    );
    await extract("friend", "still-valid", join(dir, "still-valid"));
    assert.equal(
      discoveries,
      1,
      "missing audio must not trigger repeated discovery",
    );
    fail = true;
    await assert.rejects(
      extract("friend", "bad", join(dir, "bad")),
      (error: unknown) =>
        error instanceof VoiceError && error.code === "source",
    );
    fail = false;
    await extract("friend", "four", join(dir, "four"));
    assert.equal(discoveries, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
async function finish(s: ApplicationService, j: Job) {
  for (let i = 0; i < 100; i++) {
    const n = s.job(j.id);
    if (n.state !== "running") return n;
    await new Promise((r) => setTimeout(r, 2));
  }
  throw Error("timeout");
}
test("voice transcript is anonymized as text and raw audio metadata is excluded", () => {
  const m = {
    ...voices[0],
    transcript: "朋友说自己 手机号:13800138000 /Users/private/audio.silk",
  };
  const result = sanitize(
    [m, { ...voices[1], kind: "emoji" }],
    contacts,
    "friend",
  );
  assert.equal(result.messageCount, 2);
  assert.equal(result.omitted, 0);
  assert.equal(JSON.parse(result.state).messages[1].contentStatus, "unknown");
  assert.ok(!result.state.includes("13800138000"));
  assert.ok(!result.state.includes("/Users/"));
  assert.ok(result.state.includes("语音自动转写"));
  assert.equal(JSON.parse(result.state).messages[0].speaker, "Person A");
});
test("local speech job persists successful transcript, reports missing audio separately and makes zero Jev calls", async () => {
  let network = 0;
  const saved = new Map<string, string>();
  const modes: (string | undefined)[] = [];
  const reader: WechatReader = {
    detect: async () => ({ readable: true, code: "ready", detail: "" }),
    listContacts: async () => contacts,
    listConversations: async () => [
      { id: "friend", displayName: "朋友", updatedAt: 101 },
    ],
    getMessages: async () => voices,
    getMessagePage: async () => ({
      messages: voices.map((m) => ({ ...m })),
      hasMore: false,
      crossDatabaseAtomic: false,
    }),
  };
  const repo = {
    save: () => {},
    latest: () => null,
    cacheContacts: () => {},
    cacheMessages: () => {},
    saveTranscript: (id: string, text: string) => saved.set(id, text),
    getTranscript: (id: string) => saved.get(id) ?? null,
  };
  const s = new ApplicationService(
    reader,
    new JevAnalysisService(
      { get: async () => null, set: async () => {}, delete: async () => {} },
      async () => {
        network++;
        throw Error("network forbidden");
      },
    ),
    repo,
    undefined,
    {
      transcribe: async (_r, m, _signal, mode) => {
        modes.push(mode);
        if (m.id === "1") throw new VoiceError("missing");
        return "合成转写文字";
      },
    },
  );
  await s.list();
  const read = await finish(
    s,
    s.startRead("friend", { until: 200, label: "测试" }),
  );
  assert.equal(read.state, "complete");
  assert.equal(saved.size, 0, "opening a chat must not start transcription");
  assert.equal(network, 0);
  const j = await finish(s, s.startTranscription("friend"));
  assert.equal(j.state, "limited");
  assert.equal(j.skipped, 1);
  assert.deepEqual(j.failureCounts, { missing: 1 });
  assert.equal(j.count, 1);
  assert.equal(j.completedBatches, 2);
  assert.equal(network, 0);
  assert.equal(saved.get("0"), "合成转写文字");
  assert.deepEqual(modes, ["fast", "fast"]);
  assert.equal(j.view?.contentCoverage?.transcribed, 1);
  s.editTranscript("friend", "0", "人工修正文字");
  assert.equal(saved.get("0"), "人工修正文字");
  const reread = await finish(
    s,
    s.startRead("friend", { until: 200, label: "重新读取" }),
  );
  const retry = await finish(
    s,
    s.startTranscription("friend", undefined, "accurate"),
  );
  assert.equal(modes.at(-1), "accurate");
  assert.equal(
    retry.totalBatches,
    1,
    "saved transcripts must not be transcribed again",
  );
  assert.equal((await s.previewPlan("friend")).messageCount, 2);
});
test("official pinned Jev model is actually placed in request", () => {
  assert.equal(buildRequest("{}", "jev-1.13.0").model, "jev-1.13.0");
  assert.equal(buildRequest("{}").model, "jev-latest");
});
test("parallel transcription is bounded and cancellation waits for both workers without saving cancelled text", async () => {
  for (const concurrency of [2, 4, 6, 8, 12, 16, 20]) {
    const pending: ((text: string) => void)[] = [];
    let saved = 0;
    const reader: WechatReader = {
      detect: async () => ({ readable: true, code: "ready", detail: "" }),
      listContacts: async () => contacts,
      listConversations: async () => [
        { id: "friend", displayName: "朋友", updatedAt: 100 },
      ],
      getMessages: async () => [],
      getMessagePage: async () => ({
        messages: Array.from({ length: 20 }, (_, i) => ({
          ...voices[0],
          id: String(i),
        })),
        hasMore: false,
        crossDatabaseAtomic: false,
      }),
    };
    const s = new ApplicationService(
      reader,
      new JevAnalysisService({
        get: async () => null,
        set: async () => {},
        delete: async () => {},
      }),
      {
        save: () => {},
        latest: () => null,
        cacheContacts: () => {},
        cacheMessages: () => {},
        saveTranscript: () => {
          saved++;
        },
      },
      undefined,
      {
        transcribe: async () =>
          new Promise<string>((resolve) => pending.push(resolve)),
      },
    );
    await s.list();
    const read = await finish(
      s,
      s.startRead("friend", { until: 200, label: "合成取消验证" }),
    );
    assert.equal(pending.length, 0, "reading alone does not transcribe");
    const job = s.startTranscription("friend", undefined, "fast", concurrency);
    assert.equal(pending.length, concurrency);
    s.cancelJob(job.id);
    pending[0]("不应保存");
    await new Promise((resolve) => setImmediate(resolve));
    assert.throws(
      () => s.startRead("friend", { until: 200, label: "仍在停止" }),
      /已有任务/,
    );
    for (const resolve of pending.slice(1)) resolve("不应保存");
    const done = await finish(s, job);
    assert.equal(done.state, "cancelled");
    assert.equal(pending.length, concurrency);
    assert.equal(saved, 0);
  }
});
test("reading restores cached voices and never transcribes automatically", async () => {
  let transcriptions = 0;
  let release: (() => void) | undefined;
  const reader: WechatReader = {
    detect: async () => ({ readable: true, code: "ready", detail: "" }),
    listContacts: async () => contacts,
    listConversations: async () => [
      { id: "friend", displayName: "朋友", updatedAt: 101 },
    ],
    getMessages: async () => [],
    getMessagePage: async () => ({
      messages: voices.map((m) => ({ ...m })),
      hasMore: false,
      crossDatabaseAtomic: false,
    }),
  };
  const repo = {
    save: () => {},
    latest: () => null,
    cacheContacts: () => {},
    cacheMessages: () => {},
    getTranscript: () => "已保存的合成转写",
  };
  const service = new ApplicationService(
    reader,
    new JevAnalysisService({
      get: async () => null,
      set: async () => {},
      delete: async () => {},
    }),
    repo,
    undefined,
    {
      transcribe: async () => {
        transcriptions++;
        return "不应调用";
      },
    },
  );
  await service.list();
  const cached = await finish(
    service,
    service.startRead("friend", { until: 200, label: "缓存" }),
  );
  assert.equal(transcriptions, 0);
  assert.equal(cached.view?.contentCoverage?.transcribed, 2);
  reader.getMessagePage = async () => {
    await new Promise<void>((r) => {
      release = r;
    });
    return {
      messages: voices.map((m) => ({ ...m })),
      hasMore: false,
      crossDatabaseAtomic: false,
    };
  };
  const pending = service.startRead("friend", { until: 200, label: "停止" });
  service.cancelJob(pending.id);
  release!();
  const cancelled = await finish(service, pending);
  assert.equal(cancelled.state, "cancelled");
  assert.throws(() => service.startTranscription("friend"), /完整读取/);
  assert.equal(transcriptions, 0);
});
