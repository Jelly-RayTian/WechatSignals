import { test } from "node:test";
import assert from "node:assert/strict";
import { BackgroundSpeech } from "../src/application/background-speech";
import { defaultSettings, settingsSchema } from "../src/domain/settings";
import { VoiceError } from "../src/domain/voice-errors";
import type { Message, WechatReader } from "../src/domain/types";
const voices: Message[] = Array.from({ length: 45 }, (_, i) => ({
  id: `v${i}`,
  conversationId: "c",
  timestamp: i,
  sender: "other",
  text: "[语音]",
  kind: "voice",
}));
const reader: WechatReader = {
  detect: async () => ({ readable: true, code: "ready", detail: "" }),
  listContacts: async () => [
    {
      id: "c",
      displayName: "synthetic",
      aliases: [],
      isMe: false,
      kind: "person",
    },
  ],
  listConversations: async () => [],
  getMessages: async () => [],
};
const turn = () => new Promise((resolve) => setImmediate(resolve));
async function finish(queue: BackgroundSpeech) {
  for (let i = 0; i < 2000 && queue.running; i++) await turn();
  assert.equal(queue.running, false);
  return queue.status()!;
}
test("background queue runs at most 20, persists successes and never retries completed or missing messages", async () => {
  const saved = new Map<string, string>([["v0", "cached"]]);
  let live = 0,
    max = 0,
    calls = 0;
  const repo = {
    cachedVoiceMessages: () => [...voices, voices[1]],
    getTranscript: (id: string) => saved.get(id) ?? null,
    saveTranscript: (id: string, text: string) => {
      saved.set(id, text);
    },
  };
  const queue = new BackgroundSpeech(reader, repo, {
    transcribe: async (_r, m) => {
      calls++;
      live++;
      max = Math.max(max, live);
      await turn();
      live--;
      if (m.id === "v2") throw new VoiceError("missing");
      return "synthetic";
    },
  });
  queue.tick(defaultSettings);
  const done = await finish(queue);
  assert.equal(max, 20);
  assert.equal(calls, 44);
  assert.equal(saved.size, 44);
  assert.equal(done.skipped, 1);
  assert.equal(done.state, "limited");
  queue.tick(defaultSettings);
  await turn();
  assert.equal(calls, 44);
  const restart = new BackgroundSpeech(reader, repo, {
    transcribe: async () => {
      calls++;
      throw new VoiceError("missing");
    },
  });
  restart.tick(defaultSettings);
  await finish(restart);
  assert.equal(calls, 45); // Only missing one is checked next launch, successes never re-run.
});
test("pause waits for all 20 workers, preserves completed text and resume continues pending voices", async () => {
  const saved = new Map<string, string>();
  const releases: (() => void)[] = [];
  const queue = new BackgroundSpeech(
    reader,
    {
      cachedVoiceMessages: () => voices,
      getTranscript: (id) => saved.get(id) ?? null,
      saveTranscript: (id, text) => {
        saved.set(id, text);
      },
    },
    {
      transcribe: async (_r, m, signal) => {
        await new Promise<void>((resolve) => releases.push(resolve));
        signal.throwIfAborted();
        return m.id;
      },
    },
  );
  queue.tick(defaultSettings);
  await turn();
  assert.equal(releases.length, 20);
  releases[0]();
  await turn();
  assert.equal(saved.size, 1);
  let stopped = false;
  const stopping = queue.stop().then(() => {
    stopped = true;
  });
  await turn();
  assert.equal(stopped, false);
  for (const release of releases.slice(1)) release();
  await stopping;
  assert.equal(queue.status()?.state, "cancelled");
  assert.equal(saved.size, 1);
  queue.tick(defaultSettings);
  assert.equal(queue.running, false);
  queue.resume();
  queue.tick(defaultSettings);
  await turn();
  assert.equal(queue.running, true);
  const again = queue.stop();
  for (const release of releases) release();
  await again;
});
test("disabled auto transcription and unreadable source produce no transcription calls", async () => {
  let calls = 0;
  const q = new BackgroundSpeech(
    {
      ...reader,
      detect: async () => ({ readable: false, code: "missing", detail: "" }),
    },
    {
      cachedVoiceMessages: () => voices,
      getTranscript: () => null,
      saveTranscript: () => {},
    },
    {
      transcribe: async () => {
        calls++;
        return "wrong";
      },
    },
  );
  q.tick({ ...defaultSettings, autoTranscribe: false });
  assert.equal(q.status(), null);
  q.tick(defaultSettings);
  assert.equal((await finish(q)).state, "failed");
  assert.equal(calls, 0);
  q.tick(defaultSettings);
  assert.equal(q.running, false);
  assert.equal(
    settingsSchema.safeParse({ ...defaultSettings, speechConcurrency: 200 })
      .success,
    false,
  );
});

test("background completion does not overwrite text corrected during recognition", async () => {
  const saved = new Map<string, string>();
  let release: (() => void) | undefined;
  const queue = new BackgroundSpeech(
    reader,
    {
      cachedVoiceMessages: () => [voices[0]],
      getTranscript: (id) => saved.get(id) ?? null,
      saveTranscript: (id, text) => {
        saved.set(id, text);
      },
    },
    {
      transcribe: async () => {
        await new Promise<void>((r) => {
          release = r;
        });
        return "automatic";
      },
    },
  );
  queue.tick(defaultSettings);
  await turn();
  saved.set("v0", "user corrected");
  release!();
  await finish(queue);
  assert.equal(saved.get("v0"), "user corrected");
});
