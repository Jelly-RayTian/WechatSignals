import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { sanitize } from "../src/application/sanitizer";
import { prepareBatches } from "../src/application/batches";
import { ApplicationService } from "../src/application/service";
import { SqliteRepository } from "../src/infrastructure/sqlite";
import { LocalImageRecognizer } from "../src/infrastructure/image-ocr";
import { voiceMaterializer } from "../src/infrastructure/greenbubbles-voice";
import { buildRequest } from "../src/infrastructure/jev";
import { unwrapWxgf } from "../src/infrastructure/wxgf";
import type {
  Message,
  MediaObservation,
  WechatReader,
  Job,
} from "../src/domain/types";
const observation: MediaObservation = {
  version: "vision-ocr-v1",
  status: "recognized",
  text: "Synthetic OCR",
  confidence: 0.9,
};
const message = (kind: Message["kind"], i = 0): Message => ({
  id: String(i),
  conversationId: "friend",
  timestamp: 100 + i,
  sender: "other",
  kind,
  text: "明天一起吃饭？❤️",
});
const contacts = [
  {
    id: "friend",
    displayName: "小红",
    aliases: ["小红"],
    isMe: false,
    kind: "person",
  },
];
test("WXGF extracts embedded standard images or validated HEVC parameter starts and rejects unknown containers", () => {
  const header = Buffer.from("wxgf-synthetic-header");
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
  assert.deepEqual(unwrapWxgf(Buffer.concat([header, jpg])), {
    format: "image",
    bytes: jpg,
  });
  const hevc = Buffer.from([0, 0, 0, 1, 0x40, 0x01, 0x02]);
  assert.deepEqual(unwrapWxgf(Buffer.concat([header, hevc])), {
    format: "hevc",
    bytes: hevc,
  });
  assert.throws(() => unwrapWxgf(Buffer.from("not an image")));
  assert.throws(() =>
    unwrapWxgf(Buffer.concat([header, Buffer.from([0, 0, 1, 0x02, 0x03])])),
  );
});
test("mixed modality order survives anonymization without sending raw metadata or attributing image text", () => {
  const rows = [
    message("text"),
    {
      ...message("image", 1),
      media: {
        ...observation,
        text: "小红 13800138000 /Users/private/photo.png wxid_secret https://private.test",
      },
    },
    message("voice", 2),
    message("emoji", 3),
  ];
  const result = sanitize(rows, contacts, "friend");
  const sent = JSON.parse(result.state).messages;
  assert.equal(sent.length, 4);
  assert.equal(sent[1].modality, "image");
  assert.match(sent[1].text, /不是发送者陈述/);
  assert.equal(sent[2].contentStatus, "unknown");
  assert.equal(sent[3].contentStatus, "unknown");
  for (const secret of [
    "小红",
    "13800138000",
    "/Users/",
    "wxid_secret",
    "private.test",
    "conversationId",
    "confidence",
    "timestamp",
  ])
    assert.ok(!result.state.includes(secret));
  assert.equal(result.modalities.image_ocr, 1);
  assert.equal(result.modalities.unknown_content, 2);
  assert.throws(
    () => sanitize([message("emoji"), message("voice")], []),
    /附件占位/,
  );
});
test("batching retains modality and exact target order under byte budgets", () => {
  const rows = Array.from({ length: 25 }, (_, i) =>
    i % 2 ? { ...message("image", i), media: observation } : message("text", i),
  );
  const result = prepareBatches(rows, [], "friend", 1600);
  const sent = result.states.flatMap((s) => JSON.parse(s).messages);
  assert.equal(sent.length, 25);
  assert.equal(sent.filter((m) => m.modality === "image").length, 12);
  assert.equal(result.plan.inputCoverage.modalities.image_ocr, 12);
  for (const state of result.states)
    assert.ok(Buffer.byteLength(state) <= 1600);
});
test("preview partitions include full optional question overhead within transport budget", () => {
  const rows = Array.from({ length: 220 }, (_, i) => ({
    ...message("text", i),
    text: "长段合成上下文❤️".repeat(30),
  }));
  const result = prepareBatches(rows, [], "friend");
  assert.equal(result.plan.messageCount, 220);
  for (const state of result.states)
    assert.ok(
      Buffer.byteLength(
        JSON.stringify(buildRequest(state, "jev-1.13.0", true)),
      ) <= 64000,
    );
});
test("cancelled OCR waits for workers and never persists their late observations", async () => {
  const rows = [message("text"), message("image", 1)];
  let release!: () => void,
    saved = 0;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reader: WechatReader = {
    detect: async () => ({ readable: true, code: "ready", detail: "" }),
    listContacts: async () => contacts,
    listConversations: async () => [
      { id: "friend", displayName: "Synthetic", updatedAt: 100 },
    ],
    getMessages: async () => rows,
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
        throw Error("no network");
      },
    },
    {
      save: () => {},
      latest: () => null,
      cacheContacts: () => {},
      cacheMessages: () => {},
      saveMedia: () => {
        saved++;
      },
    },
    undefined,
    undefined,
    {
      recognize: async () => {
        await pending;
        return observation;
      },
    },
  );
  await service.list();
  await finished(
    service,
    service.startRead("friend", { until: 1000, label: "Synthetic" }).id,
  );
  const job = service.startMediaRecognition("friend");
  service.cancelJob(job.id);
  assert.equal(service.isBusy, true);
  release();
  const result = await finished(service, job.id);
  assert.equal(result.state, "cancelled");
  assert.equal(saved, 0);
  assert.equal(rows[1].media, undefined);
  assert.equal(service.isBusy, false);
});
test("OCR cache persists across SQLite reopen and remains source bound", async () => {
  const dir = mkdtempSync(join(tmpdir(), "media-cache-"));
  try {
    const path = join(dir, "store.sqlite");
    let repo = await SqliteRepository.open(path);
    repo.bindSource("synthetic-source");
    repo.saveMedia("opaque-message", observation);
    repo.close();
    repo = await SqliteRepository.open(path);
    assert.deepEqual(repo.getMedia("opaque-message"), observation);
    assert.throws(() => repo.bindSource("different-source"));
    repo.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
async function finished(service: ApplicationService, id: string): Promise<Job> {
  for (let i = 0; i < 1000; i++) {
    const job = service.job(id);
    if (job.state !== "running") return job;
    await new Promise((r) => setTimeout(r, 1));
  }
  throw new Error("local job timed out");
}
test("local OCR is bounded to four workers, caches successes, exposes failures and never calls Jev", async () => {
  const rows = [
    message("text"),
    ...Array.from({ length: 9 }, (_, i) => message("image", i + 1)),
  ];
  const saved = new Map<string, MediaObservation>();
  let running = 0,
    maximum = 0,
    calls = 0,
    jevCalls = 0;
  const reader: WechatReader = {
    detect: async () => ({ readable: true, code: "ready", detail: "" }),
    listContacts: async () => contacts,
    listConversations: async () => [
      { id: "friend", displayName: "Synthetic", updatedAt: 100 },
    ],
    getMessages: async () => rows,
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
        jevCalls++;
        throw Error("unexpected network");
      },
    },
    {
      save: () => {},
      latest: () => null,
      cacheContacts: () => {},
      cacheMessages: () => {},
      saveMedia: (id, value) => {
        saved.set(id, value);
      },
      getMedia: (id) => saved.get(id) ?? null,
    },
    undefined,
    undefined,
    {
      recognize: async (_r, m) => {
        calls++;
        maximum = Math.max(maximum, ++running);
        await new Promise((r) => setTimeout(r, 2));
        running--;
        if (m.id === "9") throw Error("missing image");
        return observation;
      },
    },
  );
  await service.list();
  await finished(
    service,
    service.startRead("friend", { until: 1000, label: "Synthetic" }).id,
  );
  const plan = await service.previewPlan("friend");
  const job = await finished(
    service,
    service.startMediaRecognition("friend").id,
  );
  assert.equal(maximum, 4);
  assert.equal(job.count, 8);
  assert.equal(job.failed, 1);
  assert.equal(job.state, "failed");
  assert.equal(saved.size, 9);
  assert.equal(jevCalls, 0);
  assert.throws(() => service.previewBatch(plan.token, 0), /失效/);
  assert.throws(() => service.startMediaRecognition("friend"), /没有待识别/);
  await finished(service, service.startMediaRecognition("friend", true).id);
  assert.equal(calls, 10, "only failed image retries");
});
test("failed native OCR cleans local image derivative and does not expose source path", async () => {
  const dir = mkdtempSync(join(tmpdir(), "media-private-"));
  let derivative = "";
  try {
    const reader = {
      materializeImage: async (_id: string, _m: string, path: string) => {
        derivative = path;
        writeFileSync(path, "synthetic-not-image");
        return "jpg";
      },
    } as WechatReader;
    const recognizer = new LocalImageRecognizer(
      "/nonexistent-synthetic-helper",
      dir,
    );
    await assert.rejects(
      recognizer.recognize(reader, message("image")),
      (error) => error instanceof Error && !error.message.includes(dir),
    );
    assert.ok(!existsSync(derivative));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("image attachment adapter uses documented message-bound image kind without export or writes to source", async () => {
  const dir = mkdtempSync(join(tmpdir(), "image-adapter-"));
  const keyPath = join(dir, "synthetic-key");
  writeFileSync(keyPath, "b".repeat(64), { mode: 0o600 });
  const commands: string[][] = [];
  try {
    const materialize = voiceMaterializer("reader", "probe", "ffmpeg", {
      kind: "image",
      keyPath,
      runner: async (binary, args) => {
        if (binary === "probe")
          return JSON.stringify({
            formatVersion: 1,
            databaseRoot: { path: "/synthetic-root" },
          });
        commands.push(args);
        return JSON.stringify({
          schema: "greenbubbles.attachment.v1",
          formatVersion: 1,
          ok: true,
          preferredAttachmentId: "bound-artifact",
          decodedFormat: "jpg",
        });
      },
    });
    assert.equal(
      await materialize("friend", "opaque-message", join(dir, "output")),
      "jpg",
    );
    for (const args of commands) {
      assert.equal(args[args.indexOf("--kind") + 1], "image");
      assert.ok(args.includes("opaque-message"));
      assert.ok(args.includes("--passphrase-stdin"));
    }
    assert.equal(commands[1][1], "materialize");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
