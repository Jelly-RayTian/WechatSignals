import { createHash } from "node:crypto";
import {
  mkdirSync,
  chmodSync,
  existsSync,
  writeFileSync,
  renameSync,
  lstatSync,
} from "node:fs";
import { join } from "node:path";
// Application-managed copies. Opaque message identifiers never become path components.
export class TranscriptFolder {
  constructor(public readonly directory: string) {}
  ensure() {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    if (lstatSync(this.directory).isSymbolicLink())
      throw new Error("转写目录不能是符号链接");
    chmodSync(this.directory, 0o700);
  }
  save(id: string, text: string, overwrite = true) {
    this.ensure();
    const file = join(
      this.directory,
      `语音-${createHash("sha256").update(id).digest("hex").slice(0, 32)}.txt`,
    );
    if (!overwrite && existsSync(file)) return;
    const temporary = file + ".tmp";
    if (existsSync(temporary) && lstatSync(temporary).isSymbolicLink())
      throw new Error("转写临时文件不安全");
    writeFileSync(temporary, text + "\n", { mode: 0o600 });
    chmodSync(temporary, 0o600);
    renameSync(temporary, file);
  }
}
