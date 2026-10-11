import { execFile } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { VoiceError } from "../domain/voice-errors";
type LocalRunner = (
  executable: string,
  args: string[],
  input?: Buffer,
  signal?: AbortSignal,
  allowExit?: boolean,
) => Promise<string>;
export function voiceMaterializer(
  binary: string,
  helper: string,
  ffmpeg: string,
  options: {
    runner?: LocalRunner;
    keyPath?: string;
    kind?: "voice" | "image";
  } = {},
) {
  const run: LocalRunner =
    options.runner ??
    ((
      executable: string,
      args: string[],
      input?: Buffer,
      signal?: AbortSignal,
      allowExit = false,
    ) =>
      new Promise<string>((resolve, reject) => {
        const child = execFile(
          executable,
          args,
          {
            signal,
            timeout: 60000,
            maxBuffer: 16 * 1024 * 1024,
            env: { ...process.env, FFMPEG_PATH: ffmpeg },
          },
          (err, stdout) => {
            if (err && !allowExit) reject(new Error("本地语音提取失败"));
            else resolve(stdout);
          },
        );
        child.stdin?.on("error", () => {});
        child.stdin?.end(input);
      }));
  let root: Promise<string> | undefined;
  let rootExpires = 0;
  const databaseRoot = (signal?: AbortSignal) => {
    if (!root || Date.now() >= rootExpires) {
      rootExpires = Date.now() + 5 * 60 * 1000;
      root = run(
        helper,
        ["preflight", "--json", "--include-paths"],
        undefined,
        signal,
        true,
      )
        .then(
          (raw) =>
            z
              .object({
                formatVersion: z.literal(1),
                databaseRoot: z.object({ path: z.string().min(1) }),
              })
              .parse(JSON.parse(raw)).databaseRoot.path,
        )
        .catch(() => {
          root = undefined;
          throw new Error("本机数据目录检测失败");
        });
    }
    return root;
  };
  return async (
    id: string,
    messageId: string,
    output: string,
    signal?: AbortSignal,
  ) => {
    // Paths stay in the main process. Acquisition preflight is non-mutating; non-root exit is expected.
    const sourceRoot = await databaseRoot(signal);
    signal?.throwIfAborted();
    const keyPath =
      options.keyPath ??
      join(homedir(), ".greenbubbles-acquire/passphrase.txt");
    const st = statSync(keyPath);
    if (
      !st.isFile() ||
      st.uid !== process.getuid?.() ||
      (st.mode & 0o077) !== 0
    )
      throw new Error("数据库密钥文件权限不安全");
    const key = readFileSync(keyPath);
    if (!/^[a-fA-F0-9]{64}\s*$/.test(key.toString()))
      throw new Error("数据库密钥格式无效");
    const common = [
      sourceRoot,
      "--conversation",
      id,
      "--message",
      messageId,
      "--kind",
      options.kind ?? "voice",
      "--passphrase-stdin",
    ];
    try {
      const inspect = z
        .object({
          schema: z.literal("greenbubbles.attachment.v1"),
          formatVersion: z.literal(1),
          ok: z.literal(true),
          preferredAttachmentId: z.string().nullable().optional(),
          availability: z.string().optional(),
        })
        .parse(
          JSON.parse(
            await run(
              binary,
              ["attachment", "inspect", ...common],
              key,
              signal,
            ),
          ),
        );
      if (!inspect.preferredAttachmentId) {
        if (inspect.availability === "notDownloaded")
          throw new VoiceError("missing");
        throw new VoiceError("source");
      }
      const result = z
        .object({
          schema: z.literal("greenbubbles.attachment.v1"),
          formatVersion: z.literal(1),
          ok: z.literal(true),
          decodedFormat: z.string(),
        })
        .parse(
          JSON.parse(
            await run(
              binary,
              [
                "attachment",
                "materialize",
                ...common,
                "--attachment",
                inspect.preferredAttachmentId,
                "--output",
                output,
              ],
              key,
              signal,
            ),
          ),
        );
      return result.decodedFormat;
    } catch (error) {
      if (error instanceof VoiceError && error.code === "missing") throw error;
      // Exact source/message validation still runs for every attachment. Rediscover after failure.
      root = undefined;
      signal?.throwIfAborted();
      throw new VoiceError("source");
    } finally {
      key.fill(0);
    }
  };
}
