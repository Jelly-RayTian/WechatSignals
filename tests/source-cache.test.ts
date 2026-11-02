import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteRepository } from "../src/infrastructure/sqlite";

test("source changes select isolated cache without rewriting or mixing the legacy database", async () => {
  const { repositoryPathForSource } =
    await import("../src/infrastructure/source-cache");
  const dir = await mkdtemp(join(tmpdir(), "wechat-source-")),
    path = join(dir, "signals.sqlite");
  const repo = await SqliteRepository.open(path);
  repo.bindSource("old-source");
  repo.close();
  const before = await readFile(path);
  assert.equal(await repositoryPathForSource(path, "old-source"), path);
  assert.equal(await repositoryPathForSource(path, undefined), path);
  const next = await repositoryPathForSource(path, "new-private-source");
  assert.notEqual(next, path);
  assert.ok(!next.includes("new-private-source"));
  assert.equal(next, await repositoryPathForSource(path, "new-private-source"));
  assert.deepEqual(await readFile(path), before);
  const fresh = await SqliteRepository.open(next);
  fresh.bindSource("new-private-source");
  assert.throws(() => fresh.bindSource("old-source"));
  fresh.close();
  assert.deepEqual(await readFile(path), before);
});
test("first connection retains default cache location", async () => {
  const { repositoryPathForSource } =
    await import("../src/infrastructure/source-cache");
  const dir = await mkdtemp(join(tmpdir(), "wechat-source-")),
    path = join(dir, "signals.sqlite");
  assert.equal(await repositoryPathForSource(path, "first-source"), path);
});

test('cache binding failures expose a specific reconnect message, never opaque identities',async()=>{
 const {GreenBubblesAdapter}=await import('../src/infrastructure/greenbubbles');
 const reader=new GreenBubblesAdapter(async()=>JSON.stringify({ok:true,source:{identity:'private-current-source'},databaseCount:1}),()=>{throw Error('private-old-source')});
 const status=await reader.detect();
 assert.equal(status.readable,false);assert.equal(status.code,'source_changed');
 assert.ok(status.detail.includes('数据源'));assert.ok(!status.detail.includes('private-'));
});
