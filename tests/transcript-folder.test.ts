import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SqliteRepository } from "../src/infrastructure/sqlite";
test("desktop copies backfill existing transcripts, remain private, update edits and restore without recognition", async () => {
  const dir = mkdtempSync(join(tmpdir(), "transcript-export-")),
    file = join(dir, "store.sqlite"),
    folder = join(dir, "Desktop", "微信语音转写");
  try {
    let repo = await SqliteRepository.open(file);
    repo.saveTranscript("../opaque/path/token", "合成文字一");
    repo.saveTranscript("second", "合成文字二");
    repo.close();
    repo = await SqliteRepository.open(file, undefined, folder);
    const files = readdirSync(folder).filter((x) => x.endsWith(".txt"));
    assert.equal(files.length, 2);
    assert.ok(files.every((x) => /^语音-[a-f0-9]{32}\.txt$/.test(x)));
    assert.equal(statSync(folder).mode & 0o777, 0o700);
    const first = files.find((x) =>
      readFileSync(join(folder, x), "utf8").includes("合成文字一"),
    )!;
    assert.equal(statSync(join(folder, first)).mode & 0o777, 0o600);
    repo.saveTranscript("../opaque/path/token", "修正后合成文字");
    assert.equal(readFileSync(join(folder, first), "utf8"), "修正后合成文字\n");
    rmSync(join(folder, first));
    assert.deepEqual(repo.syncTranscriptFolder(), { count: 2, error: false });
    assert.equal(repo.getTranscript("../opaque/path/token"), "修正后合成文字");
    assert.equal(readdirSync(folder).length, 2);
    repo.close();
    repo = await SqliteRepository.open(file, undefined, folder);
    assert.equal(repo.getTranscript("second"), "合成文字二");
    assert.equal(readdirSync(folder).length, 2);
    repo.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("export failure does not discard SQLite transcript or prevent reopening", async () => {
  const dir = mkdtempSync(join(tmpdir(), "transcript-export-fail-")),
    file = join(dir, "store.sqlite"),
    blocked = join(dir, "blocked");
  try {
    writeFileSync(blocked, "synthetic file");
    let repo = await SqliteRepository.open(file, undefined, blocked);
    repo.saveTranscript("one", "合成保留文字");
    assert.equal(repo.getTranscript("one"), "合成保留文字");
    assert.equal(repo.syncTranscriptFolder().error, true);
    repo.close();
    repo = await SqliteRepository.open(file);
    assert.equal(repo.getTranscript("one"), "合成保留文字");
    repo.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("settings persist across reopen and cache enumeration supplies only voices", async () => {
  const directory = mkdtempSync(join(tmpdir(), "signals-preferences-"));
  try {
    const path = join(directory, "db.sqlite");
    let repo = await SqliteRepository.open(path);
    assert.deepEqual(repo.getSettings(), {
      autoTranscribe: true,
      jevConsistency: false,
      speechMode: "fast",
      speechConcurrency: 20,
    });
    repo.setSettings({
      autoTranscribe: false,
      speechMode: "accurate",
      speechConcurrency: 16,
    });
    repo.cacheMessages("c", [
      {
        id: "v",
        conversationId: "c",
        kind: "voice",
        sender: "me",
        timestamp: 1,
        text: "[语音]",
      },
      {
        id: "t",
        conversationId: "c",
        kind: "text",
        sender: "me",
        timestamp: 1,
        text: "synthetic",
      },
    ]);
    repo.close();
    repo = await SqliteRepository.open(path);
    assert.equal(repo.getSettings().autoTranscribe, false);
    assert.equal(repo.getSettings().speechConcurrency, 16);
    assert.deepEqual(
      repo.cachedVoiceMessages().map((m) => m.id),
      ["v"],
    );
    repo.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
