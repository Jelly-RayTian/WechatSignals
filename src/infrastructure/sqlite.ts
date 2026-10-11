import {
  settingsSchema,
  defaultSettings,
  type AppSettings,
} from "../domain/settings";
import { TranscriptFolder } from "./transcript-folder";
import initSqlJs, { type Database } from "sql.js";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  chmodSync,
} from "node:fs";
import { dirname } from "node:path";
import type {
  Analysis,
  AnalysisRepository,
  Contact,
  Conversation,
  Message,
  MediaObservation,
} from "../domain/types";
export class SqliteRepository implements AnalysisRepository {
  private constructor(
    private db: Database,
    private path: string,
    private transcriptFolder?: TranscriptFolder,
  ) {}
  static async open(
    path: string,
    wasmPath?: string,
    transcriptDirectory?: string,
  ) {
    const SQL = await initSqlJs(wasmPath ? { locateFile: () => wasmPath } : {});
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    chmodSync(dirname(path), 0o700);
    const db = new SQL.Database(
      existsSync(path) ? readFileSync(path) : undefined,
    );
    db.run(
      "CREATE TABLE IF NOT EXISTS contacts(id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS messages(conversation_id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS analyses(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL,created_at INTEGER NOT NULL,data TEXT NOT NULL); CREATE INDEX IF NOT EXISTS analysis_latest ON analyses(conversation_id,created_at DESC); CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL); PRAGMA user_version=1;",
    );
    db.run(
      "CREATE TABLE IF NOT EXISTS transcripts(id TEXT PRIMARY KEY,text TEXT NOT NULL)",
    );
    db.run(
      "CREATE TABLE IF NOT EXISTS behavior_labels(analysis_id TEXT, segment INTEGER, behavior TEXT, expected TEXT, original TEXT, created_at INTEGER, PRIMARY KEY(analysis_id, segment, behavior))",
    );
    db.run(
      "CREATE TABLE IF NOT EXISTS media_observations(id TEXT PRIMARY KEY,data TEXT NOT NULL)",
    );
    const repo = new SqliteRepository(
      db,
      path,
      transcriptDirectory
        ? new TranscriptFolder(transcriptDirectory)
        : undefined,
    );
    repo.syncTranscriptFolder();
    return repo;
  }
  getMedia(id: string): MediaObservation | null {
    const stmt = this.db.prepare(
      "SELECT data FROM media_observations WHERE id=?",
    );
    try {
      stmt.bind([id]);
      return stmt.step() ? JSON.parse(String(stmt.get()[0])) : null;
    } finally {
      stmt.free();
    }
  }
  saveMedia(id: string, value: MediaObservation) {
    this.db.run("INSERT OR REPLACE INTO media_observations VALUES(?,?)", [
      id,
      JSON.stringify(value),
    ]);
    this.persist();
  }
  getTranscript(id: string) {
    const s = this.db.prepare("SELECT text FROM transcripts WHERE id=?");
    try {
      s.bind([id]);
      return s.step() ? String(s.get()[0]) : null;
    } finally {
      s.free();
    }
  }
  labelBehavior(
    analysisId: string,
    segment: number,
    behavior: string,
    expected: string,
  ) {
    if (
      !Number.isInteger(segment) ||
      segment < 0 ||
      !["absent", "weak", "clear", "strong", "unclear"].includes(expected)
    )
      throw new Error("无效校对标签");
    const stmt = this.db.prepare("SELECT data FROM analyses WHERE id=?");
    let analysis: Analysis | null = null;
    try {
      stmt.bind([analysisId]);
      if (stmt.step()) analysis = JSON.parse(String(stmt.get()[0]));
    } finally {
      stmt.free();
    }
    const result =
      analysis?.segments?.[segment]?.result ??
      (segment === 0 && !analysis?.segments?.length ? analysis : null);
    const original = result?.behaviors?.[behavior]?.choice;
    if (!original) throw new Error("不存在可校对的行为记录");
    this.db.run("INSERT OR REPLACE INTO behavior_labels VALUES(?,?,?,?,?,?)", [
      analysisId,
      segment,
      behavior,
      expected,
      original,
      Date.now(),
    ]);
    this.persist();
  }
  behaviorLabelCount() {
    return Number(
      this.db.exec("SELECT COUNT(*) FROM behavior_labels")[0]?.values[0]?.[0] ??
        0,
    );
  }
  saveTranscript(id: string, text: string) {
    this.db.run("INSERT OR REPLACE INTO transcripts VALUES(?,?)", [id, text]);
    this.persist();
    if (this.transcriptFolder) {
      try {
        this.transcriptFolder.save(id, text);
        this.exportError = false;
      } catch {
        this.exportError = true;
      }
    }
  }
  private exportError = false;
  syncTranscriptFolder() {
    let count = 0;
    if (this.transcriptFolder) {
      try {
        this.transcriptFolder.ensure();
        const rows =
          this.db.exec(
            "SELECT id,text FROM transcripts WHERE length(text)>0",
          )[0]?.values ?? [];
        for (const [id, text] of rows) {
          this.transcriptFolder.save(String(id), String(text), false);
          count++;
        }
        this.exportError = false;
      } catch {
        this.exportError = true;
      }
    }
    return { count, error: this.exportError };
  }
  getSettings(): AppSettings {
    const stmt = this.db.prepare(
      "SELECT value FROM metadata WHERE key='appSettings'",
    );
    try {
      if (!stmt.step()) return { ...defaultSettings };
      const parsed = settingsSchema.safeParse(
        JSON.parse(String(stmt.get()[0])),
      );
      return parsed.success ? parsed.data : { ...defaultSettings };
    } catch {
      return { ...defaultSettings };
    } finally {
      stmt.free();
    }
  }
  setSettings(value: AppSettings) {
    const settings = settingsSchema.parse(value);
    this.db.run("INSERT OR REPLACE INTO metadata VALUES('appSettings',?)", [
      JSON.stringify(settings),
    ]);
    this.persist();
    return settings;
  }
  cachedVoiceMessages(): Message[] {
    const rows = this.db.exec("SELECT data FROM messages")[0]?.values ?? [];
    return rows.flatMap(([data]) =>
      (JSON.parse(String(data)) as Message[]).filter((m) => m.kind === "voice"),
    );
  }
  getJevModel() {
    const s = this.db.prepare(
      "SELECT value FROM metadata WHERE key='jevModel'",
    );
    try {
      return s.step() ? String(s.get()[0]) : "jev-latest";
    } finally {
      s.free();
    }
  }
  setJevModel(model: string) {
    this.db.run("INSERT OR REPLACE INTO metadata VALUES('jevModel',?)", [
      model,
    ]);
    this.persist();
  }
  bindSource(identity: string) {
    const stmt = this.db.prepare(
      "SELECT value FROM metadata WHERE key='sourceIdentity'",
    );
    let existing: string | null = null;
    try {
      if (stmt.step()) existing = String(stmt.get()[0]);
    } finally {
      stmt.free();
    }
    if (existing && existing !== identity)
      throw new Error("该缓存已绑定另一个微信数据源，当前版本只支持单账号");
    if (!existing) {
      this.db.run("INSERT INTO metadata VALUES('sourceIdentity',?)", [
        identity,
      ]);
      this.persist();
    }
  }
  private persist() {
    const tmp = this.path + ".tmp";
    writeFileSync(tmp, this.db.export(), { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, this.path);
  }
  save(a: Analysis) {
    this.db.run("INSERT OR REPLACE INTO analyses VALUES(?,?,?,?)", [
      a.id,
      a.conversationId,
      a.createdAt,
      JSON.stringify(a),
    ]);
    this.persist();
  }
  latest(id: string) {
    const stmt = this.db.prepare(
      "SELECT data FROM analyses WHERE conversation_id=? ORDER BY created_at DESC LIMIT 1",
    );
    try {
      stmt.bind([id]);
      return stmt.step()
        ? (JSON.parse(String(stmt.get()[0])) as Analysis)
        : null;
    } finally {
      stmt.free();
    }
  }
  cacheContacts(contacts: Contact[], conversations: Conversation[]) {
    this.db.run("BEGIN");
    try {
      for (const [table, rows] of [
        ["contacts", contacts],
        ["conversations", conversations],
      ] as const) {
        this.db.run(`DELETE FROM ${table}`);
        for (const row of rows)
          this.db.run(`INSERT INTO ${table} VALUES(?,?)`, [
            row.id,
            JSON.stringify(row),
          ]);
      }
      this.db.run("COMMIT");
    } catch (e) {
      this.db.run("ROLLBACK");
      throw e;
    }
    this.persist();
  }
  cacheMessages(id: string, messages: Message[]) {
    this.db.run("INSERT OR REPLACE INTO messages VALUES(?,?)", [
      id,
      JSON.stringify(messages),
    ]);
    this.persist();
  }
  close() {
    this.db.close();
  }
}
