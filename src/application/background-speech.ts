import { availableParallelism } from "node:os";
import { VoiceError } from "../domain/voice-errors";
import type { AppSettings } from "../domain/settings";
import type { Job, Message, WechatReader } from "../domain/types";
import type { SpeechTranscriber } from "../infrastructure/speech";
export interface BackgroundSpeechRepository {
  cachedVoiceMessages(): Message[];
  getTranscript(id: string): string | null;
  saveTranscript(id: string, text: string): void;
}
// Separate local queue: no Jev dependency, no mutation of conversation caches.
export class BackgroundSpeech {
  private attempted = new Set<string>();
  private controller?: AbortController;
  private pending?: Promise<void>;
  private current: Job | null = null;
  private paused = false;
  constructor(
    private reader: WechatReader,
    private repo: BackgroundSpeechRepository,
    private speech: SpeechTranscriber,
  ) {}
  status() {
    return this.current ? structuredClone(this.current) : null;
  }
  get running() {
    return !!this.pending;
  }
  resume() {
    this.paused = false;
  }
  async stop() {
    this.paused = true;
    this.controller?.abort();
    await this.pending;
  }
  async shutdown() {
    await this.stop();
  }
  tick(settings: AppSettings) {
    if (!settings.autoTranscribe || this.paused || this.pending) return;
    const seen = new Set<string>();
    const voices = this.repo.cachedVoiceMessages().filter((m) => {
      if (
        m.kind !== "voice" ||
        this.repo.getTranscript(m.id) ||
        this.attempted.has(m.id) ||
        seen.has(m.id)
      )
        return false;
      seen.add(m.id);
      return true;
    });
    if (!voices.length) return;
    const controller = (this.controller = new AbortController());
    const job: Job = (this.current = {
      id: "background-speech",
      kind: "transcription",
      state: "running",
      count: 0,
      pages: 0,
      completedBatches: 0,
      totalBatches: voices.length,
      skipped: 0,
      failureCounts: {},
      concurrency: Math.min(settings.speechConcurrency, voices.length),
      detail: "后台本机转写",
    });
    this.pending = (async () => {
      let cursor = 0,
        failures = 0;
      try {
        // Revalidate current source before using cached opaque selectors.
        if (!(await this.reader.detect()).readable)
          throw new VoiceError("source");
        // Materialization accepts only contacts resolved by the current adapter.
        const contacts = await this.reader.listContacts();
        const singleChats = new Set(
          contacts
            .filter((c) => c.kind === "person" && !c.isMe)
            .map((c) => c.id),
        );
        const worker = async () => {
          while (cursor < voices.length) {
            controller.signal.throwIfAborted();
            const m = voices[cursor++];
            try {
              if (!singleChats.has(m.conversationId))
                throw new VoiceError("source");
              if (!this.repo.getTranscript(m.id)) {
                const text = await this.speech.transcribe(
                  this.reader,
                  m,
                  controller.signal,
                  settings.speechMode,
                  Math.max(
                    1,
                    Math.min(
                      4,
                      Math.floor(
                        availableParallelism() / settings.speechConcurrency,
                      ),
                    ),
                  ),
                );
                controller.signal.throwIfAborted();
                try {
                  // A user may correct the text while this worker is running.
                  if (!this.repo.getTranscript(m.id))
                    this.repo.saveTranscript(m.id, text);
                } catch {
                  throw new VoiceError("storage");
                }
                job.count++;
              }
              this.attempted.add(m.id);
            } catch (error) {
              controller.signal.throwIfAborted();
              this.attempted.add(m.id);
              const code = error instanceof VoiceError ? error.code : "unknown";
              job.failureCounts![code] = (job.failureCounts![code] ?? 0) + 1;
              if (code === "missing") job.skipped!++;
              else failures++;
            }
            job.completedBatches++;
            job.detail = `后台转写 ${job.completedBatches}/${job.totalBatches} · 成功 ${job.count} · 缺失 ${job.skipped} · 失败 ${failures}`;
          }
        };
        const results = await Promise.allSettled(
          Array.from({ length: job.concurrency! }, worker),
        );
        if (results.some((r) => r.status === "rejected"))
          throw new Error("worker stopped");
        job.state = failures ? "failed" : job.skipped ? "limited" : "complete";
        job.detail = `后台转写${job.state === "complete" ? "完成" : "部分未完成"} · 成功 ${job.count} · 缺失 ${job.skipped} · 失败 ${failures}`;
      } catch {
        job.state = controller.signal.aborted ? "cancelled" : "failed";
        job.detail = controller.signal.aborted
          ? "后台转写已暂停，成功文字已保存"
          : "后台转写未完成，请检查微信连接；本轮不自动重试";
        if (!controller.signal.aborted) this.paused = true;
      } finally {
        this.pending = undefined;
        this.controller = undefined;
      }
    })();
  }
}
