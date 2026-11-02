import initSqlJs from "sql.js";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
// Inspect only binding metadata; never rebind or merge an existing cache.
export async function repositoryPathForSource(
  path: string,
  identity: string | undefined,
  wasmPath?: string,
) {
  if (!identity || !existsSync(path)) return path;
  const SQL = await initSqlJs(wasmPath ? { locateFile: () => wasmPath } : {});
  const db = new SQL.Database(readFileSync(path));
  try {
    const rows = db.exec(
      "SELECT value FROM metadata WHERE key='sourceIdentity'",
    );
    const existing = rows[0]?.values[0]?.[0];
    if (!existing || existing === identity) return path;
    return join(
      dirname(path),
      "sources",
      createHash("sha256").update(identity).digest("hex"),
      "signals.sqlite",
    );
  } finally {
    db.close();
  }
}
