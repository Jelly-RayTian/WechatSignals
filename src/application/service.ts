import type { ImageRecognizer } from "../infrastructure/image-ocr";
import { availableParallelism } from "node:os";
import { VoiceError } from "../domain/voice-errors";
import { randomUUID } from "node:crypto";
import type {
  Analysis,
  AnalysisRepository,
  WechatReader,
  Conversation,
  Message,
  WechatReaderPlugin,
  ReadRange,
  ReadCoverage,
  Job,
  View,
  AnalysisPlan,
  AnalysisSegment,
} from "../domain/types";
import type { JevAnalysisService } from "../infrastructure/jev";
import { sanitize } from "./sanitizer";
import { statistics } from "./stats";
import { chartData } from "./charts";
import {
  prepareBatches,
  aggregateSegments,
  repairSavedAggregate,
} from "./batches";
import type { SpeechTranscriber } from "../infrastructure/speech";
type Loaded = { messages: Message[]; coverage: ReadCoverage; cursor?: string };
export class ApplicationService {
  private conversations: Conversation[] = [];
  private messages = new Map<string, Message[]>();
  private loaded = new Map<string, Loaded>();
  private jobs = new Map<string, Job>();
  private controllers = new Map<string, AbortController>();
  private plans = new Map<
    string,
    { id: string; plan: AnalysisPlan; states: string[] }
  >();
  private busy = false;
  constructor(
    private reader: WechatReader,
    private jev: Pick<JevAnalysisService, "analyze">,
    private repo: AnalysisRepository,
    private plugin?: WechatReaderPlugin,
    private speech?: SpeechTranscriber,
    private images?: ImageRecognizer,
  ) {}
  async connection() {
    if (!this.plugin) throw new Error("未安装本机读取插件");
    return this.plugin.inspectConnection();
  }
  status() {
    return this.reader.detect();
  }
  async list() {
    this.conversations = await this.reader.listConversations();
    this.repo.cacheContacts(
      await this.reader.listContacts(),
      this.conversations,
    );
    return this.conversations;
  }
  private selected(id: string) {
    const c = this.conversations.find((c) => c.id === id);
    if (!c) throw new Error("请选择已识别的单聊");
    return c;
  }
  async open(id: string) {
    const conversation = this.selected(id);
    const messages = await this.reader.getMessages(id, 200);
    this.messages.set(id, messages);
    this.repo.cacheMessages(id, messages);
    return {
      conversation,
      messages,
      stats: statistics(messages),
      analysis: (() => {
        const saved = this.repo.latest(id);
        return saved ? repairSavedAggregate(saved) : null;
      })(),
    };
  }
  async preview(id: string) {
    this.selected(id);
    const messages = this.messages.get(id);
    if (!messages) throw new Error("请先读取聊天");
    const sanitized = sanitize(messages, await this.reader.listContacts(), id);
    if (sanitized.state.length > 100000)
      throw new Error("聊天文本超过单次上限，请使用分段分析");
    return sanitized;
  }
  async analyze(id: string, expectedState: string) {
    if (this.busy) throw new Error("正在处理，请稍候");
    this.busy = true;
    try {
      const preview = await this.preview(id);
      if (preview.state !== expectedState)
        throw new Error("内容已变化，请重新预览");
      const result = await this.jev.analyze(
        id,
        preview.state,
        preview.messageCount,
      );
      this.repo.save(result);
      return result;
    } finally {
      this.busy = false;
    }
  }
  private createJob(kind: Job["kind"]) {
    if (this.busy) throw new Error("已有任务正在处理");
    this.busy = true;
    const job: Job = {
      id: randomUUID(),
      kind,
      state: "running",
      count: 0,
      pages: 0,
      completedBatches: 0,
      totalBatches: 0,
      detail: kind === "read" ? "正在读取本机聊天" : "正在分析",
    };
    this.jobs.set(job.id, job);
    const controller = new AbortController();
    this.controllers.set(job.id, controller);
    return { job, controller };
  }
  job(id: string) {
    const job = this.jobs.get(id);
    if (!job) throw new Error("任务不存在");
    return { ...job };
  }
  cancelJob(id: string) {
    this.controllers.get(id)?.abort();
    const job = this.jobs.get(id);
    if (job?.state === "running")
      job.detail = "正在停止任务，等待当前操作结束；尚未完成";
  }
  get isBusy() {
    return this.busy;
  }
  refreshView(id: string) {
    return this.loaded.has(id) ? this.view(id) : null;
  }
  private view(id: string): View {
    const data = this.loaded.get(id)!;
    for (const m of data.messages) {
      if (m.kind === "image" && !m.media)
        m.media = this.repo.getMedia?.(m.id) ?? undefined;
      if (m.kind === "voice" && !m.transcript) {
        const saved = this.repo.getTranscript?.(m.id);
        if (saved) {
          m.transcript = saved;
          delete m.voiceError;
        }
      }
    }
    let analysis: Analysis | null = null;
    try {
      const saved = this.repo.latest(id);
      analysis = saved ? repairSavedAggregate(saved) : null;
    } catch {
      // Keep local history viewable if saved analysis cannot be read.
    }
    return {
      conversation: this.selected(id),
      messages: data.messages.slice(-300),
      stats: statistics(data.messages),
      charts: chartData(data.messages, data.coverage.range),
      coverage: { ...data.coverage },
      analysis,
      contentCoverage: {
        total: data.messages.length,
        images: data.messages.filter((m) => m.kind === "image").length,
        imageProcessed: data.messages.filter(
          (m) =>
            m.kind === "image" && m.media && m.media.status !== "unavailable",
        ).length,
        imageOcr: data.messages.filter(
          (m) => m.kind === "image" && m.media?.status === "recognized",
        ).length,
        imagePending: data.messages.filter(
          (m) => m.kind === "image" && !m.media,
        ).length,
        imageUnavailable: data.messages.filter(
          (m) => m.kind === "image" && m.media?.status === "unavailable",
        ).length,
        text: data.messages.filter((m) => m.kind === "text").length,
        voice: data.messages.filter((m) => m.kind === "voice").length,
        transcribed: data.messages.filter(
          (m) => m.kind === "voice" && m.transcript,
        ).length,
        emoji: data.messages.filter((m) => m.kind === "emoji").length,
        other: data.messages.filter(
          (m) => !["text", "voice", "emoji"].includes(m.kind),
        ).length,
      },
    };
  }
  startRead(id: string, range: ReadRange, resume = false) {
    this.selected(id);
    if (!this.reader.getMessagePage)
      throw new Error("该读取插件尚未支持历史分页");
    if (
      !Number.isSafeInteger(range.until) ||
      (range.since !== undefined &&
        (!Number.isSafeInteger(range.since) || range.since > range.until))
    )
      throw new Error("日期范围无效");
    const previous = this.loaded.get(id);
    if (
      resume &&
      (!previous ||
        !previous.coverage.hasMore ||
        JSON.stringify(previous.coverage.range) !== JSON.stringify(range))
    )
      throw new Error("没有可继续的相同范围读取");
    const { job, controller } = this.createJob("read");
    for (const [token, plan] of this.plans)
      if (plan.id === id) this.plans.delete(token);
    const data: Loaded = resume
      ? previous!
      : {
          messages: [],
          coverage: {
            range: { ...range },
            count: 0,
            pages: 0,
            complete: false,
            hasMore: true,
            first: null,
            last: null,
            crossDatabaseAtomic: true,
            state: "running",
          },
        };
    data.coverage.state = "running";
    data.coverage.complete = false;
    this.loaded.set(id, data);
    job.count = data.messages.length;
    job.pages = data.coverage.pages;
    void this.readLoop(id, data, job, controller);
    return { ...job };
  }
  private async readLoop(
    id: string,
    data: Loaded,
    job: Job,
    controller: AbortController,
  ) {
    const seen = new Set(data.messages.map((m) => m.id));
    const cursors = new Set<string>();
    let added = 0;
    let roundPages = 0;
    try {
      while (true) {
        if (controller.signal.aborted) {
          job.state = "cancelled";
          job.detail = "读取已停止，已读内容保留，覆盖不完整";
          break;
        }
        const page = await this.reader.getMessagePage!(id, {
          ...data.coverage.range,
          cursor: data.cursor,
          limit: 500,
          signal: controller.signal,
        });
        controller.signal.throwIfAborted();
        roundPages++;
        if (
          page.hasMore &&
          (!page.nextCursor ||
            page.nextCursor === data.cursor ||
            cursors.has(page.nextCursor))
        )
          throw new Error("分页游标无效");
        for (const m of page.messages) {
          if (
            m.conversationId !== id ||
            m.timestamp > data.coverage.range.until ||
            (data.coverage.range.since !== undefined &&
              m.timestamp < data.coverage.range.since)
          )
            throw new Error("分页范围不一致");
          if (!seen.has(m.id)) {
            if (m.kind === "voice")
              m.transcript = this.repo.getTranscript?.(m.id) ?? undefined;
            if (m.kind === "image")
              m.media = this.repo.getMedia?.(m.id) ?? undefined;
            seen.add(m.id);
            data.messages.push(m);
            added++;
          }
        }
        data.coverage.pages++;
        data.coverage.crossDatabaseAtomic &&= page.crossDatabaseAtomic;
        data.coverage.hasMore = page.hasMore;
        data.cursor = page.nextCursor;
        if (page.nextCursor) cursors.add(page.nextCursor);
        job.count = data.messages.length;
        job.pages = data.coverage.pages;
        job.detail = `已读取 ${job.count} 条 / ${job.pages} 页，正在继续`;
        if (!page.hasMore) {
          job.state = "complete";
          data.coverage.complete = true;
          job.detail = `所选范围已读完，共 ${job.count} 条；仅覆盖本机已有记录`;
          break;
        }
        if (added >= 50000 || roundPages >= 1000) {
          job.state = "limited";
          job.detail = "本轮达到读取保护上限，仍有历史；点击继续读取";
          break;
        }
      }
    } catch {
      job.state = controller.signal.aborted ? "cancelled" : "failed";
      job.detail =
        "读取未完成。检查微信授权、数据库兼容性或分页状态；已读内容仅作为部分数据。";
    } finally {
      data.messages.sort((a, b) => a.timestamp - b.timestamp);
      data.coverage.count = data.messages.length;
      data.coverage.first = data.messages[0]?.timestamp ?? null;
      data.coverage.last = data.messages.at(-1)?.timestamp ?? null;
      data.coverage.state = job.state === "running" ? "failed" : job.state;
      data.coverage.complete = job.state === "complete";
      this.messages.set(id, data.messages);
      try {
        this.repo.cacheMessages(id, data.messages);
        job.view = this.view(id);
      } catch {
        job.state = "failed";
        data.coverage.state = "failed";
        data.coverage.complete = false;
        job.detail = "本地缓存保存失败，未完成；请检查磁盘空间。";
        job.view = this.view(id);
      }
      this.controllers.delete(job.id);
      this.busy = false;
    }
  }
  startTranscription(
    id: string,
    messageId?: string,
    mode: "fast" | "accurate" = "fast",
    concurrency = 4,
  ) {
    this.selected(id);
    if (![2, 4, 6, 8, 12, 16, 20].includes(concurrency))
      throw new Error("无效并行数量");
    const data = this.loaded.get(id);
    if (!data?.coverage.complete || !this.speech)
      throw new Error("请先完整读取并配置本地转写");
    const voices = data.messages.filter(
      (m) =>
        m.kind === "voice" &&
        !m.transcript &&
        (!messageId || m.id === messageId),
    );
    if (!voices.length) throw new Error("没有待转写语音");
    const { job, controller } = this.createJob("transcription");
    job.totalBatches = voices.length;
    job.skipped = 0;
    job.failureCounts = {};
    job.concurrency = Math.min(concurrency, voices.length);
    job.detail = "正在本机转写语音，不上传音频";
    this.invalidatePlans(id);
    void (async () => {
      let failures = 0;
      try {
        let cursor = 0;
        const worker = async () => {
          while (cursor < voices.length) {
            controller.signal.throwIfAborted();
            const m = voices[cursor++];
            try {
              const text = await this.speech!.transcribe(
                this.reader,
                m,
                controller.signal,
                mode,
                Math.max(
                  1,
                  Math.min(4, Math.floor(availableParallelism() / concurrency)),
                ),
              );
              controller.signal.throwIfAborted();
              try {
                this.repo.saveTranscript?.(m.id, text);
              } catch {
                throw new VoiceError("storage");
              }
              m.transcript = text;
              delete m.voiceError;
              job.count++;
            } catch (error) {
              controller.signal.throwIfAborted();
              const code = error instanceof VoiceError ? error.code : "unknown";
              m.voiceError = code;
              job.failureCounts![code] = (job.failureCounts![code] ?? 0) + 1;
              if (code === "missing") job.skipped!++;
              else failures++;
            }
            job.completedBatches++;
            job.detail = `本地转写 ${job.completedBatches}/${job.totalBatches}，成功 ${job.count}，缺失音频 ${job.skipped}，失败 ${failures}`;
            this.repo.cacheMessages(id, data.messages);
            job.view = this.view(id);
          }
        };
        // Bound CPU/memory usage. Wait for both workers to stop before releasing the job lock.
        const workers = await Promise.allSettled(
          Array.from({ length: Math.min(concurrency, voices.length) }, worker),
        );
        const failedWorker = workers.find((r) => r.status === "rejected");
        if (failedWorker?.status === "rejected") throw failedWorker.reason;
        job.state = failures ? "failed" : job.skipped ? "limited" : "complete";
        job.detail = `本地转写${failures || job.skipped ? "部分未完成" : "已完成"}：成功 ${job.count}，缺失音频 ${job.skipped}，失败 ${failures}。请检查自动转写文字。`;
      } catch {
        job.state = controller.signal.aborted ? "cancelled" : "failed";
        job.detail = "本地转写未完成，成功文本已保留。";
      } finally {
        job.view = this.view(id);
        this.busy = false;
        this.controllers.delete(job.id);
      }
    })();
    return { ...job };
  }
  private invalidatePlans(id: string) {
    for (const [token, p] of this.plans)
      if (p.id === id) this.plans.delete(token);
  }
  editTranscript(id: string, messageId: string, text: string) {
    if (this.busy) throw new Error("任务运行中");
    this.selected(id);
    const data = this.loaded.get(id),
      m = data?.messages.find((m) => m.id === messageId && m.kind === "voice");
    if (!m || typeof text !== "string" || text.length > 10000)
      throw new Error("无效转写编辑");
    this.repo.saveTranscript?.(m.id, text.trim());
    m.transcript = text.trim();
    this.repo.cacheMessages(id, data!.messages);
    this.invalidatePlans(id);
    return this.view(id);
  }
  startMediaRecognition(id: string, retry = false) {
    this.selected(id);
    const data = this.loaded.get(id);
    if (!data?.coverage.complete || !this.images)
      throw new Error("请先读完范围并配置本机OCR");
    this.view(id);
    const images = data.messages.filter(
      (m) =>
        m.kind === "image" &&
        (!m.media || (retry && m.media.status === "unavailable")),
    );
    if (!images.length)
      throw new Error("本范围没有待识别图片；已缓存结果会直接复用");
    const { job, controller } = this.createJob("media");
    job.totalBatches = images.length;
    job.concurrency = Math.min(4, images.length);
    job.detail = "本机图片OCR · 不上传图片 · 4路并行";
    this.invalidatePlans(id);
    void (async () => {
      let cursor = 0;
      const worker = async () => {
        while (cursor < images.length) {
          controller.signal.throwIfAborted();
          const m = images[cursor++];
          try {
            const observed = await this.images!.recognize(
              this.reader,
              m,
              controller.signal,
            );
            controller.signal.throwIfAborted();
            m.media = observed;
            this.repo.saveMedia?.(m.id, m.media);
            job.count++;
          } catch {
            if (controller.signal.aborted) return;
            m.media = {
              version: "vision-ocr-v1",
              status: "unavailable",
              text: "",
              confidence: null,
            };
            this.repo.saveMedia?.(m.id, m.media);
            job.failed = (job.failed ?? 0) + 1;
          }
          job.completedBatches++;
          job.detail = `本机图片OCR ${job.completedBatches}/${images.length} · 已处理 ${job.count} · 不可用 ${job.failed ?? 0}`;
        }
      };
      try {
        const workers = await Promise.allSettled(
          Array.from({ length: job.concurrency! }, worker),
        );
        if (
          workers.some((w) => w.status === "rejected") &&
          !controller.signal.aborted
        )
          throw new Error("本地图片任务未完成");
        this.repo.cacheMessages(id, data.messages);
        job.state = controller.signal.aborted
          ? "cancelled"
          : job.failed
            ? "failed"
            : "complete";
        job.detail = controller.signal.aborted
          ? "图片OCR已停止，已完成结果保留"
          : `图片OCR处理结束：${job.count}/${images.length} 已处理，${job.failed ?? 0} 不可用；无文字图片不代表没有互动`;
      } catch {
        job.state = controller.signal.aborted ? "cancelled" : "failed";
        job.detail =
          "本机图片处理或缓存未完成；已保存结果保留，请检查本地存储后重试";
      } finally {
        job.view = this.view(id);
        this.invalidatePlans(id);
        this.controllers.delete(job.id);
        this.busy = false;
      }
    })();
    return { ...job };
  }
  async previewPlan(id: string) {
    this.selected(id);
    if (this.busy) throw new Error("请等待当前任务结束");
    const data = this.loaded.get(id);
    if (!data?.coverage.complete)
      throw new Error("所选范围尚未读完，请先完成读取");
    this.view(id);
    const prepared = prepareBatches(
      data.messages,
      await this.reader.listContacts(),
      id,
    );
    for (const [token, plan] of this.plans)
      if (plan.id === id) this.plans.delete(token);
    this.plans.set(prepared.plan.token, { id, ...prepared });
    return prepared.plan;
  }
  previewBatch(token: string, index: number) {
    const prepared = this.plans.get(token);
    if (
      !prepared ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= prepared.states.length
    )
      throw new Error("预览已失效");
    return prepared.states[index];
  }
  startAnalysis(id: string, token: string) {
    this.selected(id);
    const prepared = this.plans.get(token),
      data = this.loaded.get(id);
    if (!prepared || prepared.id !== id || !data?.coverage.complete)
      throw new Error("分析预览已失效，请重新生成");
    const { job, controller } = this.createJob("analysis");
    job.totalBatches = prepared.states.length;
    this.plans.delete(token);
    void this.analysisLoop(id, data, prepared, job, controller);
    return { ...job };
  }
  private async analysisLoop(
    id: string,
    data: Loaded,
    prepared: { plan: AnalysisPlan; states: string[] },
    job: Job,
    controller: AbortController,
  ) {
    const segments: AnalysisSegment[] = [];
    try {
      for (let i = 0; i < prepared.states.length; i++) {
        controller.signal.throwIfAborted();
        job.detail = `Jev 正在分析第 ${i + 1}/${prepared.states.length} 段`;
        const summary = prepared.plan.batches[i];
        const result = await this.jev.analyze(
          id,
          prepared.states[i],
          summary.messageCount,
          controller.signal,
        );
        segments.push({
          index: i,
          first: summary.first,
          last: summary.last,
          result,
        });
        job.count += result.messageCount;
        job.completedBatches = segments.length;
        job.analysis = aggregateSegments(
          job.id,
          id,
          segments,
          prepared.states.length,
          data.coverage.range,
          "partial",
        );
        job.analysis.inputCoverage = prepared.plan.inputCoverage;
        this.repo.save(job.analysis);
      }
      job.analysis = aggregateSegments(
        job.id,
        id,
        segments,
        prepared.states.length,
        data.coverage.range,
        "complete",
      );
      job.analysis.inputCoverage = prepared.plan.inputCoverage;
      this.repo.save(job.analysis);
      job.state = "complete";
      job.detail = `全部 ${segments.length} 段分析并保存成功`;
    } catch {
      job.state = controller.signal.aborted ? "cancelled" : "failed";
      job.detail = `分析${job.state === "cancelled" ? "已停止" : "失败"}：仅 ${segments.length}/${prepared.states.length} 段成功，不能视为完整分析。已保存的分段结果保留。`;
    } finally {
      job.view = this.view(id);
      this.controllers.delete(job.id);
      this.busy = false;
    }
  }
}
