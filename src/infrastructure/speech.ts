import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, chmod, readFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { VoiceError, type VoiceErrorCode } from "../domain/voice-errors";
import type { Message, WechatReader } from "../domain/types";
const exec = promisify(execFile);
export interface SpeechTranscriber {
  transcribe(
    reader: WechatReader,
    message: Message,
    signal: AbortSignal,
    mode?: "fast" | "accurate",
    threads?: number,
  ): Promise<string>;
}
export class LocalSpeechTranscriber implements SpeechTranscriber {
  constructor(
    private assets: string,
    private cache: string,
  ) {}
  async transcribe(
    reader: WechatReader,
    m: Message,
    signal: AbortSignal,
    mode: "fast" | "accurate" = "fast",
    threads = 2,
  ) {
    if (!reader.materializeVoice) throw new Error("读取插件没有语音提取能力");
    await mkdir(this.cache, { recursive: true, mode: 0o700 });
    await chmod(this.cache, 0o700);
    const dir = await mkdtemp(join(this.cache, "speech-"));
    await chmod(dir, 0o700);
    let stage: VoiceErrorCode = "source";
    try {
      const audio = join(dir, "voice"),
        wav = join(dir, "voice.wav"),
        output = join(dir, "result");
      const format = await reader.materializeVoice(
        m.conversationId,
        m.id,
        audio,
        signal,
      );
      stage = "convert";
      if (!["ogg", "wav", "mp3", "flac"].includes(format))
        throw new Error("语音格式未能转换");
      stage = "convert";
      await exec(
        join(this.assets, "ffmpeg"),
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-nostdin",
          "-i",
          audio,
          "-ar",
          "16000",
          "-ac",
          "1",
          wav,
        ],
        { signal, timeout: 60000, maxBuffer: 1024 * 1024 },
      );
      stage = "recognition";
      await exec(
        join(this.assets, "whisper-cli"),
        [
          "-m",
          join(
            this.assets,
            mode === "fast" ? "ggml-base-q5_1.bin" : "ggml-small-q5_1.bin",
          ),
          "-f",
          wav,
          "-l",
          "auto",
          "-otxt",
          "-of",
          output,
          "-nt",
          "-t",
          String(Math.max(1, Math.min(4, threads))),
        ],
        { signal, timeout: 240000, maxBuffer: 4 * 1024 * 1024 },
      );
      stage = "empty";
      const text = (await readFile(output + ".txt", "utf8")).trim();
      if (!text || text.length > 10000) throw new Error("没有可靠转写文本");
      return text;
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof VoiceError) throw error;
      throw new VoiceError(stage);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
