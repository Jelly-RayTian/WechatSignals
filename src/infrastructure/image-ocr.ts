import { execFile } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  rm,
  chmod,
  stat,
  readFile,
  writeFile,
} from "node:fs/promises";
import { unwrapWxgf } from "./wxgf";
import { join } from "node:path";
import { z } from "zod";
import type { MediaObservation, Message, WechatReader } from "../domain/types";

// A bounded allowlist of coarse objects only. No identity/emotion/relationship labels.
const coarseLabels = new Set([
  "food",
  "drink",
  "dessert",
  "fruit",
  "flower",
  "plant",
  "cat",
  "dog",
  "animal",
  "landscape",
  "sky",
  "beach",
  "mountain",
  "building",
  "vehicle",
  "car",
  "book",
  "document",
  "text",
  "screenshot",
]);
export function parseVisionObservation(raw: unknown): MediaObservation {
  const result = z
    .object({
      text: z.string().max(10000),
      confidence: z.number().min(0).max(1),
      labels: z
        .array(
          z.object({
            name: z.string().max(100),
            confidence: z.number().min(0).max(1),
          }),
        )
        .max(20)
        .optional(),
      width: z.number().int().positive().optional(),
      height: z.number().int().positive().optional(),
      frameCount: z.number().int().positive().optional(),
      barcodeCount: z.number().int().min(0).max(10000).optional(),
      classificationAvailable: z.boolean().optional(),
    })
    .parse(raw);
  return {
    ...result,
    version: "vision-local-v2",
    status: result.text.trim() ? "recognized" : "no_text",
    text: result.text.trim(),
    labels: (result.labels ?? [])
      .filter((l) => coarseLabels.has(l.name) && l.confidence >= 0.7)
      .slice(0, 5),
  };
}

export interface ImageRecognizer {
  recognize(
    reader: WechatReader,
    message: Message,
    signal?: AbortSignal,
  ): Promise<MediaObservation>;
}
export class LocalImageRecognizer implements ImageRecognizer {
  constructor(
    private helper: string,
    private tempRoot: string,
    private ffmpeg?: string,
  ) {}
  async recognize(
    reader: WechatReader,
    message: Message,
    signal?: AbortSignal,
  ): Promise<MediaObservation> {
    if (message.kind !== "image" || !reader.materializeImage)
      throw new Error("图片读取不可用");
    await mkdir(this.tempRoot, { recursive: true, mode: 0o700 });
    await chmod(this.tempRoot, 0o700);
    const dir = await mkdtemp(join(this.tempRoot, "ocr-"));
    const path = join(dir, "source");
    try {
      const format = await reader.materializeImage(
        message.conversationId,
        message.id,
        path,
        signal,
      );
      const file = await stat(path);
      if (!file.isFile() || file.size > 30 * 1024 * 1024)
        throw new Error("图片超过本地OCR限制");
      await chmod(path, 0o600);
      let input = path;
      if (format === "wxgf") {
        const content = unwrapWxgf(await readFile(path));
        input = join(dir, "frame.png");
        if (content.format === "image")
          await writeFile(input, content.bytes, { mode: 0o600 });
        else {
          if (!this.ffmpeg) throw new Error("本机WXGF转换尚未配置");
          const bitstream = join(dir, "frame.hevc");
          await writeFile(bitstream, content.bytes, { mode: 0o600 });
          await new Promise<void>((resolve, reject) => {
            execFile(
              this.ffmpeg!,
              [
                "-hide_banner",
                "-loglevel",
                "error",
                "-threads",
                "1",
                "-f",
                "hevc",
                "-i",
                bitstream,
                "-frames:v",
                "1",
                "-threads",
                "1",
                input,
              ],
              { signal, timeout: 30000, maxBuffer: 128 * 1024 },
              (err) => {
                if (err) reject(new Error("本机WXGF转换失败"));
                else resolve();
              },
            );
          });
          await chmod(input, 0o600);
        }
      }
      const raw = await new Promise<string>((resolve, reject) => {
        execFile(
          this.helper,
          [input],
          { signal, timeout: 45000, maxBuffer: 128 * 1024 },
          (err, stdout) => {
            if (err) reject(new Error("本机图片OCR未完成"));
            else resolve(stdout);
          },
        );
      });
      return parseVisionObservation(JSON.parse(raw));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
