import { MessageBrowser } from "./message-browser";
import { ImageObservation } from "./image-observation";
import { CoveragePanel, InteractionPanel } from "./insights";
import { MetricReport } from "./report";
import { LocalComparison } from "./local-comparison";
import { ConversationSearch } from "./conversation-search";
import {
  defaultSettings,
  speechConcurrencyOptions,
  type AppSettings,
} from "../domain/settings";
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  type DesktopApi,
  type EvidenceContext,
  type Metric,
  type Conversation,
  type View,
  type ConnectionReport,
  type ReadRange,
  type Job,
  type AnalysisPlan,
  type EvaluationSummary,
} from "../domain/types";
import { Dashboard, SignalTrend } from "./charts";
import "./style.css";
import "./taste.css";
import { voiceErrorLabels, type VoiceErrorCode } from "../domain/voice-errors";
declare global {
  interface Window {
    wechat?: DesktopApi;
  }
}
function App() {
  const api = window.wechat;
  const [uiTheme, setUiTheme] = useState(
    () => localStorage.getItem("wechat-ui-theme") || "system",
  );
  useEffect(() => {
    document.documentElement.dataset.theme = uiTheme;
    localStorage.setItem("wechat-ui-theme", uiTheme);
  }, [uiTheme]);
  const [status, setStatus] = useState("正在检测本机微信"),
    [readable, setReadable] = useState(false),
    [chats, setChats] = useState<Conversation[]>([]),
    [selected, setSelected] = useState(""),
    [view, setView] = useState<View | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [key, setKey] = useState(""),
    [hasKey, setHasKey] = useState(false),
    [connection, setConnection] = useState<ConnectionReport | null>(null),
    [rangeMode, setRangeMode] = useState("30"),
    [sinceDate, setSinceDate] = useState(""),
    [untilDate, setUntilDate] = useState(""),
    [job, setJob] = useState<Job | null>(null),
    [plan, setPlan] = useState<AnalysisPlan | null>(null),
    [batchIndex, setBatchIndex] = useState(0),
    [batchText, setBatchText] = useState(""),
    [tab, setTab] = useState("report"),
    [settings, setSettings] = useState(false),
    [speechConcurrency, setSpeechConcurrency] = useState(20),
    [preferences, setPreferences] = useState<AppSettings>(defaultSettings),
    [background, setBackground] = useState<Job | null>(null),
    [settingsTab, setSettingsTab] = useState("jev"),
    [evaluation, setEvaluation] = useState<EvaluationSummary | null>(null),
    [speechMode, setSpeechMode] = useState<"fast" | "accurate">("fast"),
    [model, setModel] = useState("jev-latest"),
    [editing, setEditing] = useState<{
      id: string;
      text: string;
      kind?: "image";
    } | null>(null),
    [evidenceContext, setEvidenceContext] = useState<EvidenceContext | null>(
      null,
    );
  const openContext = (
    segment: number,
    metric: Metric,
    side: "support" | "counter",
  ) =>
    run(async () => {
      if (!api || !view?.analysis) return;
      const version = selection.current;
      const context = await api.evidenceContext(
        selected,
        view.analysis.id,
        segment,
        metric,
        side,
      );
      if (version === selection.current) setEvidenceContext(context);
    });
  useEffect(() => {
    if (!settings && !editing && !plan && !connection && !evidenceContext)
      return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = Array.from(
      document.querySelectorAll<HTMLElement>(".overlay"),
    ).at(-1);
    dialog?.querySelector<HTMLElement>("button,input,select,textarea")?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSettings(false);
        setKey("");
        setEditing(null);
        setPlan(null);
        setConnection(null);
        setEvidenceContext(null);
      }
      if (event.key === "Tab" && dialog) {
        const items = Array.from(
          dialog.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
          ),
        ).filter((e) => e.getClientRects().length > 0);
        if (!items.length) return;
        const first = items[0],
          last = items.at(-1)!;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      previous?.focus();
    };
  }, [settings, !!editing, !!plan, !!connection, !!evidenceContext]);
  const [messageRevision, setMessageRevision] = useState(0);
  const selection = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmounted = useRef(false);
  const pageVersion = useRef(0);
  const running = job?.state === "running";
  const locked = busy || running;
  const settingsLocked = busy || (running && job?.kind === "analysis");
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch {
      setError("本次操作未完成。请检查微信连接、读取覆盖、钥匙串或 Jev 服务。");
    } finally {
      setBusy(false);
    }
  };
  const refresh = () =>
    run(async () => {
      if (!api) {
        setStatus("请用 Electron 启动客户端，浏览器不能连接本机微信");
        return;
      }
      const s = await api.status();
      setStatus(s.detail);
      setReadable(s.readable);
      if (!s.readable) {
        setChats([]);
        setView(null);
        setSelected("");
      }
      setHasKey(await api.hasKey());
      setModel(await api.jevModel());
      const preferences = await api.settings();
      setPreferences(preferences);
      setEvaluation(await api.evaluationReport());
      setSpeechMode(preferences.speechMode);
      setSpeechConcurrency(preferences.speechConcurrency);
      if (s.readable) setChats(await api.conversations());
    });
  useEffect(() => {
    unmounted.current = false;
    void refresh();
    return () => {
      unmounted.current = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  const updatePreferences = (patch: Partial<AppSettings>) =>
    void run(async () => {
      const next = await api!.saveSettings({ ...preferences, ...patch });
      setPreferences(next);
      setSpeechMode(next.speechMode);
      setSpeechConcurrency(next.speechConcurrency);
    });
  useEffect(() => {
    if (!api) return;
    let disposed = false,
      polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const status = await api.backgroundStatus();
        if (!disposed) setBackground(status);
        if (selected && !running && !plan) {
          const updated = await api.refreshView(selected);
          if (!disposed && updated) setView(updated);
        }
      } catch {
        /* Background status does not expose source errors or chat content. */
      } finally {
        polling = false;
      }
    };
    void poll();
    const interval = setInterval(() => void poll(), 1500);
    return () => {
      disposed = true;
      clearInterval(interval);
    };
  }, [selected, running, plan]);
  const watch = (id: string, token: number) => {
    timer.current = setTimeout(async () => {
      try {
        const next = await api!.job(id);
        if (unmounted.current || token !== selection.current) return;
        setJob(next);
        if (next.view) setView(next.view);
        if (next.state === "running") watch(id, token);
        else if (next.state === "failed" || next.state === "cancelled")
          setError(next.detail);
      } catch {
        setError("无法取得任务状态；不能确认任务是否完成。");
        setJob((j) =>
          j
            ? { ...j, state: "failed", detail: "状态查询失败，完成状态未知" }
            : null,
        );
      }
    }, 700);
  };
  const range = (): ReadRange => {
    const until = Math.floor(Date.now() / 1000);
    if (rangeMode === "all") return { until, label: "全部本机历史" };
    if (rangeMode === "custom") {
      if (!sinceDate || !untilDate) throw new Error("日期未选择");
      const since = Math.floor(
          new Date(sinceDate + "T00:00:00").getTime() / 1000,
        ),
        end = Math.floor(new Date(untilDate + "T23:59:59").getTime() / 1000);
      if (!Number.isFinite(since) || !Number.isFinite(end) || since > end)
        throw new Error("日期无效");
      return {
        since,
        until: Math.min(until, end),
        label: `${sinceDate} 至 ${untilDate}`,
      };
    }
    return {
      since: until - Number(rangeMode) * 86400,
      until,
      label: `最近 ${rangeMode} 天`,
    };
  };
  const read = (id: string, resume = false) =>
    run(async () => {
      setPlan(null);
      const token = ++selection.current;
      setSelected(id);
      if (!resume) {
        setView(null);
        setJob(null);
      }
      const next = await api!.startRead(
        id,
        resume ? view!.coverage!.range : range(),
        resume,
      );
      setJob(next);
      watch(next.id, token);
    });
  const preview = () =>
    run(async () => {
      const next = await api!.previewPlan(selected);
      setPlan(next);
      setBatchIndex(0);
      setBatchText(await api!.previewBatch(next.token, 0));
    });
  const changeBatch = (index: number) =>
    run(async () => {
      const version = ++pageVersion.current;
      const text = await api!.previewBatch(plan!.token, index);
      if (version === pageVersion.current) {
        setBatchIndex(index);
        setBatchText(text);
      }
    });
  const analyze = () =>
    run(async () => {
      const next = await api!.startAnalysis(selected, plan!.token);
      setPlan(null);
      setJob(next);
      watch(next.id, selection.current);
    });
  const analysis = view?.analysis;
  const complete = view?.coverage?.complete === true;
  return (
    <>
      <header>
        <div>
          <h1>微信聊天信号</h1>
          <small>本地聊天行为分析</small>
        </div>
        <div className="toolbar-actions">
          <button
            className="theme-toggle"
            aria-label={`切换外观：${uiTheme === "system" ? "跟随系统" : uiTheme === "light" ? "浅色" : "深色"}`}
            onClick={() =>
              setUiTheme(
                uiTheme === "system"
                  ? "light"
                  : uiTheme === "light"
                    ? "dark"
                    : "system",
              )
            }
          >
            {uiTheme === "system"
              ? "跟随系统"
              : uiTheme === "light"
                ? "浅色"
                : "深色"}
          </button>
          <button onClick={() => setSettings(true)}>
            设置 · {hasKey ? "已配置" : "未配置"}
          </button>
          <button
            disabled={
              locked ||
              background?.state === "running" ||
              !complete ||
              !view?.contentCoverage ||
              view.contentCoverage.voice <= view.contentCoverage.transcribed
            }
            onClick={() =>
              run(async () => {
                setPlan(null);
                const next = await api!.startTranscription(
                  selected,
                  undefined,
                  speechMode,
                  speechConcurrency,
                );
                setJob(next);
                watch(next.id, selection.current);
              })
            }
          >
            语音转文字
          </button>
          <button
            className="primary"
            disabled={locked || !complete}
            onClick={preview}
          >
            用 Jev 判断
          </button>
        </div>
      </header>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      <details className="system-status">
        <summary>
          <span className={readable ? "connection-ready" : ""}>
            {readable ? "微信已连接" : "微信未连接"}
          </span>
          <span>
            {running
              ? `${job?.kind === "analysis" ? "Jev分析" : job?.kind === "read" ? "读取记录" : "语音转写"}进行中`
              : background?.state === "running"
                ? "后台转写中"
                : "本机只读"}
          </span>
          <span className="status-hint">连接与任务详情</span>
        </summary>
        <div className="status">
          <span>{status}</span>
          <div className="connect-actions">
            <button
              disabled={locked || !api}
              onClick={() =>
                run(async () => setConnection(await api!.connection()))
              }
            >
              连接本机微信
            </button>
            <button disabled={locked} onClick={refresh}>
              重新检测
            </button>
          </div>
        </div>
        <div className="workflow">
          <span className={readable ? "verified" : ""}>
            ① 微信连接：{readable ? "可读" : "未完成"}
          </span>
          <span className={complete ? "verified" : ""}>
            ② 范围读取：
            {complete
              ? "已读完"
              : job?.kind === "read" && running
                ? "读取中"
                : "未完整读取"}
          </span>
          <span className={analysis?.status === "complete" ? "verified" : ""}>
            ③ Jev 分析：
            {job?.kind === "analysis" && running
              ? "分析中"
              : analysis?.status === "complete"
                ? "所显示结果已完成"
                : analysis
                  ? "部分结果"
                  : "未完成"}
          </span>
        </div>

        {job && (
          <div className={"job " + job.state}>
            <strong>{job.detail}</strong>
            <span>
              {job.kind === "read"
                ? `${job.count} 条 · ${job.pages} 页`
                : `${job.completedBatches}/${job.totalBatches} ${job.kind === "transcription" ? "条语音" : job.kind === "media" ? "张图片" : "段"} · 成功 ${job.count}`}
            </span>
            {job.kind === "transcription" && (
              <span>
                {job.concurrency} 条并行 ·{" "}
                {Object.entries(job.failureCounts ?? {})
                  .map(
                    ([code, count]) =>
                      `${voiceErrorLabels[code as VoiceErrorCode]} ${count}`,
                  )
                  .join("；")}
                {job.skipped
                  ? "。缺失音频需先在微信中播放或下载，再重试。"
                  : ""}
              </span>
            )}
            {running && (
              <button onClick={() => run(async () => api!.cancelJob(job.id))}>
                停止任务
              </button>
            )}
          </div>
        )}
        <div className="background-status">
          <span>
            {background?.detail ||
              (preferences.autoTranscribe
                ? "后台自动转写已启用 · 等待已缓存语音"
                : "后台自动转写已关闭")}
          </span>
          <small>
            {speechConcurrency} 条并行 · 仅在本机处理 · Jev 需手动确认
          </small>
          {background?.failureCounts && (
            <small>
              {Object.entries(background.failureCounts)
                .map(
                  ([code, count]) =>
                    `${voiceErrorLabels[code as VoiceErrorCode]} ${count}`,
                )
                .join("；")}
            </small>
          )}
          {background?.state === "running" ? (
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await api!.pauseBackground();
                  setBackground(await api!.backgroundStatus());
                })
              }
            >
              暂停后台转写
            </button>
          ) : preferences.autoTranscribe ? (
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await api!.resumeBackground();
                })
              }
            >
              继续后台转写
            </button>
          ) : null}
        </div>
      </details>
      {running && (
        <div className="task-inline" role="status">
          <span>{job?.detail}</span>
          <button onClick={() => run(async () => api!.cancelJob(job!.id))}>
            停止任务
          </button>
        </div>
      )}
      <main>
        <aside>
          <ConversationSearch
            chats={chats}
            selected={selected}
            disabled={locked}
            onSelect={(id) => read(id)}
          />
        </aside>
        <article>
          <h2 className="conversation-title">
            {view?.conversation.displayName ||
              chats.find((c) => c.id === selected)?.displayName ||
              "选择联系人开始"}
          </h2>
          <details className="read-tools">
            <summary>
              {view?.coverage
                ? `${view.coverage.range.label} / ${view.coverage.count.toLocaleString()} 条`
                : "读取范围与语音工具"}
              <span>调整范围与转写</span>
            </summary>
            <div className="range-controls">
              <label>
                读取范围{" "}
                <select
                  disabled={locked}
                  value={rangeMode}
                  onChange={(e) => {
                    setRangeMode(e.target.value);
                    setView(null);
                    setJob(null);
                    setPlan(null);
                  }}
                >
                  <option value="7">最近 7 天</option>
                  <option value="30">最近 30 天</option>
                  <option value="90">最近 90 天</option>
                  <option value="custom">自定义日期</option>
                  <option value="all">全部本机历史</option>
                </select>
              </label>
              {rangeMode === "custom" && (
                <>
                  <input
                    type="date"
                    disabled={locked}
                    value={sinceDate}
                    onChange={(e) => {
                      setSinceDate(e.target.value);
                      setView(null);
                      setPlan(null);
                      setJob(null);
                    }}
                  />
                  <input
                    type="date"
                    disabled={locked}
                    value={untilDate}
                    onChange={(e) => {
                      setUntilDate(e.target.value);
                      setView(null);
                      setPlan(null);
                      setJob(null);
                    }}
                  />
                </>
              )}
              <button
                disabled={locked || !selected}
                onClick={() => read(selected)}
              >
                读取此范围
              </button>
            </div>
            <div className="speech-inline">
              <span>
                本机转写 · {speechMode === "fast" ? "快速 Base" : "精细 Small"}{" "}
                · {speechConcurrency} 路并行
              </span>
              <button
                onClick={() => {
                  setSettingsTab("speech");
                  setSettings(true);
                }}
              >
                调整转写设置
              </button>
              <button
                disabled={!api}
                onClick={() =>
                  void run(async () => {
                    const result = await api!.openTranscriptFolder();
                    if (result.error)
                      setError(
                        "桌面转写文件夹暂不可用；SQLite 中的文字仍保留。",
                      );
                  })
                }
              >
                转写文件夹
              </button>
            </div>
          </details>
          {view && (
            <details className="source-details">
              <summary>
                数据覆盖与缺失说明{" "}
                <small>{complete ? "所选范围已读完" : "读取未完成"}</small>
              </summary>
              {view?.coverage && (
                <div
                  className={"coverage " + (complete ? "complete" : "partial")}
                >
                  <strong>
                    {view.coverage.range.label} ·{" "}
                    {view.coverage.count.toLocaleString()} 条 ·{" "}
                    {complete ? "所选范围已读完" : "覆盖不完整"}
                  </strong>
                  <details className="coverage-details">
                    <summary>查看日期与读取边界</summary>
                    <p>
                      {view.coverage.first === null
                        ? "没有消息"
                        : `${new Date(view.coverage.first * 1000).toLocaleString()} — ${new Date(view.coverage.last! * 1000).toLocaleString()}`}
                    </p>
                    <small>
                      覆盖仅指本机已有、可解码的记录。
                      {!view.coverage.crossDatabaseAtomic &&
                        "跨数据库非原子快照，微信同时写入可能造成边界变化。"}
                      {view.coverage.hasMore && "仍有未读取历史。"}
                    </small>
                  </details>
                  {!complete && view.coverage.hasMore && (
                    <button
                      disabled={locked}
                      onClick={() => read(selected, true)}
                    >
                      继续读取
                    </button>
                  )}
                </div>
              )}
              {view?.contentCoverage && (
                <div className="content-coverage">
                  <span>
                    文字 {view.contentCoverage.text} · 语音{" "}
                    {view.contentCoverage.voice}（已转写{" "}
                    {view.contentCoverage.transcribed}）· 表情贴图{" "}
                    {view.contentCoverage.emoji} · 其他{" "}
                    {view.contentCoverage.other}
                  </span>
                  <details>
                    <summary>转写与缺失内容说明</summary>
                    <small>
                      启用自动转写后，已读取并缓存的语音会在后台本机处理，已保存文字直接复用。Jev
                      仅在预览并确认后调用。缺失音频需先在微信播放或下载；后台本轮失败项不循环重试，可暂停后台后手动重试。图片可用本机OCR提取文字；照片画面、贴图含义和视频尚不识别，不会猜测内容。请检查转写与OCR文字。
                    </small>
                  </details>
                </div>
              )}
            </details>
          )}
          {view?.contentCoverage && (
            <section className="multimodal-summary" aria-label="多模态证据准备">
              <div>
                <b>多模态证据</b>
                <small>
                  语音已转写 {view.contentCoverage.transcribed}/
                  {view.contentCoverage.voice} · 图片已处理{" "}
                  {view.contentCoverage.imageProcessed ?? 0}/
                  {view.contentCoverage.images ?? 0}（有文字{" "}
                  {view.contentCoverage.imageOcr ?? 0}）· 贴图{" "}
                  {view.contentCoverage.emoji}（含义未知）
                </small>
              </div>
              <button
                disabled={
                  locked ||
                  !complete ||
                  !(
                    (view.contentCoverage.imagePending ?? 0) +
                    (view.contentCoverage.imageUnavailable ?? 0)
                  )
                }
                onClick={() =>
                  run(async () => {
                    setPlan(null);
                    const next = await api!.startMediaRecognition(
                      selected,
                      true,
                    );
                    setJob(next);
                    watch(next.id, selection.current);
                  })
                }
              >
                本机观察图片
              </button>
              {!!view.contentCoverage.imageLegacy && (
                <button
                  disabled={locked || !complete}
                  onClick={() =>
                    run(async () => {
                      setPlan(null);
                      const next = await api!.startMediaRecognition(
                        selected,
                        true,
                        true,
                      );
                      setJob(next);
                      watch(next.id, selection.current);
                    })
                  }
                >
                  升级旧图片观察（{view.contentCoverage.imageLegacy}）
                </button>
              )}
              <small>
                图片不上传；已识别结果本地缓存。识别不等于 Jev
                判断，仍需点击顶部按钮并确认。
              </small>
            </section>
          )}
          <div className="tabs" role="group" aria-label="工作区页面">
            <button
              className={tab === "report" ? "selected" : ""}
              onClick={() => setTab("report")}
            >
              评价报告
            </button>
            <button
              className={tab === "charts" ? "selected" : ""}
              onClick={() => setTab("charts")}
            >
              统计图表
            </button>
            <button
              className={tab === "messages" ? "selected" : ""}
              onClick={() => setTab("messages")}
            >
              聊天记录
            </button>
            <button
              className={tab === "signals" ? "selected" : ""}
              onClick={() => setTab("signals")}
            >
              信号走势
            </button>
          </div>
          {!view && running && job?.kind === "read" ? (
            <div className="reading-placeholder" role="status">
              <h3>正在读取本机聊天记录</h3>
              <p>
                已读取 {job.count.toLocaleString()}{" "}
                条，完成后显示保存的评价与统计。
              </p>
              <div className="skeleton-line" />
              <div className="skeleton-line" />
              <div className="skeleton-line short" />
            </div>
          ) : !view ? (
            <div className="empty">
              <h3>从完整日期范围看聊天行为</h3>
              <p>
                可选 7、30、90 天、自定义范围或全部历史；每轮最多读取 50000
                条，可继续读取直到完成。
              </p>
              <p>
                聊天频率、主动开启、回复分布与活跃时段全部在本机计算。只有你预览并确认分析时，匿名化文本才发送到
                Jev。
              </p>
              <p>当前没有真实数据，因此图表和 AI 分数保持空白。</p>
            </div>
          ) : tab === "report" ? (
            <MetricReport
              key={view.conversation.id + (view.analysis?.id ?? "")}
              view={view}
              onOpenContext={openContext}
            />
          ) : tab === "charts" ? (
            <>
              <CoveragePanel view={view} />
              <InteractionPanel view={view} />
              <Dashboard view={view} />
              <LocalComparison view={view} />
            </>
          ) : tab === "signals" ? (
            <SignalTrend view={view} />
          ) : (
            <MessageBrowser
              key={
                view.conversation.id +
                ":" +
                view.coverage?.range.since +
                ":" +
                view.coverage?.range.until
              }
              conversationId={view.conversation.id}
              coverage={view.coverage}
              revision={`${view.coverage?.count}:${view.contentCoverage?.transcribed}:${view.contentCoverage?.imageOcr}:${messageRevision}`}
              search={api!.searchMessages}
              renderMessage={(m) => (
                <div key={m.id} className={"message " + m.sender}>
                  <small>
                    {m.sender === "me"
                      ? "我"
                      : m.sender === "other"
                        ? "对方"
                        : "未知发送者"}{" "}
                    · {new Date(m.timestamp * 1000).toLocaleString()}
                  </small>
                  <p>
                    {m.kind === "voice" && m.transcript ? m.transcript : m.text}
                  </p>
                  {m.kind === "image" && (
                    <div>
                      <ImageObservation media={m.media} />
                      <button
                        disabled={locked}
                        onClick={() =>
                          setEditing({
                            id: m.id,
                            text: m.media?.text ?? "",
                            kind: "image",
                          })
                        }
                      >
                        检查 / 编辑图片文字
                      </button>
                    </div>
                  )}
                  {m.kind === "voice" && (
                    <div className="voice-tools">
                      {!m.transcript && (
                        <button
                          disabled={locked || background?.state === "running"}
                          onClick={() =>
                            run(async () => {
                              setPlan(null);
                              const next = await api!.startTranscription(
                                selected,
                                m.id,
                                speechMode,
                                speechConcurrency,
                              );
                              setJob(next);
                              watch(next.id, selection.current);
                            })
                          }
                        >
                          转写这条
                        </button>
                      )}
                      <small>
                        {m.transcript
                          ? m.transcriptReviewed
                            ? "文字已人工核对 · 无语气信息"
                            : "语音自动转写 · 无可信度标注，请核对"
                          : m.voiceError
                            ? voiceErrorLabels[m.voiceError]
                            : "未转写 · 不参与 AI 语义分析"}
                      </small>
                      <button
                        disabled={locked}
                        onClick={() =>
                          setEditing({ id: m.id, text: m.transcript || "" })
                        }
                      >
                        检查 / 编辑文字
                      </button>
                    </div>
                  )}
                </div>
              )}
            />
          )}
        </article>
      </main>
      {settings && (
        <div
          className="overlay settings-page"
          role="dialog"
          aria-modal="true"
          aria-label="应用设置"
        >
          <section className="dialog settings-dialog">
            <div className="dialog-title">
              <h2>应用设置</h2>
              <button
                onClick={() => {
                  setSettings(false);
                  setKey("");
                }}
              >
                关闭
              </button>
            </div>
            <div className="tabs settings-tabs" aria-label="设置页面导航">
              <button
                className={settingsTab === "media" ? "selected" : ""}
                onClick={() => setSettingsTab("media")}
              >
                图片与隐私
              </button>
              <button
                className={settingsTab === "speech" ? "selected" : ""}
                onClick={() => setSettingsTab("speech")}
              >
                转写与缓存
              </button>
              <button
                className={settingsTab === "jev" ? "selected" : ""}
                onClick={() => setSettingsTab("jev")}
              >
                Jev 与 Key
              </button>
              <button
                className={settingsTab === "rubric" ? "selected" : ""}
                onClick={() => setSettingsTab("rubric")}
              >
                评分标准
              </button>
            </div>
            {settingsTab === "media" && (
              <section className="settings-media">
                <h3>本机图片观察</h3>
                <p>
                  使用 macOS 自带
                  Vision，无需购买或接入其他模型。提取图片文字、检测条码数量，并在支持时显示有限粗分类。
                </p>
                <p>
                  不会保存条码内容，不分析人物身份、心理或表情情绪。图片和粗分类标签不会发给
                  Jev；只有你预览确认的匿名文字会发送。
                </p>
                <p>
                  旧 OCR
                  缓存仍可复用。需要粗分类时，点击工作区“升级旧图片观察”；人工核对过的文字会保留。
                </p>
                <p>
                  多帧图片只处理首帧；没有标签不代表画面没有内容，无法理解复杂梗图或照片背后的意图。
                </p>
                <h3>语音质量</h3>
                <p>
                  当前 Whisper
                  接口未提供可校准的逐句可信度，因此不显示伪造的百分比。重要语音建议核对；编辑后的文字会标记“人工核对”并在本机持久保存。
                </p>
                <h3>数据与密钥</h3>
                <p>
                  聊天、识别文字与分析存 SQLite；API Key 存
                  Keychain。后台转写不调用 Jev，不自动发送微信消息。
                </p>
              </section>
            )}
            {settingsTab === "speech" && (
              <section>
                <h3>后台语音转文字</h3>
                <label className="setting-toggle">
                  <input
                    type="checkbox"
                    checked={preferences.autoTranscribe}
                    disabled={busy}
                    onChange={(e) =>
                      updatePreferences({ autoTranscribe: e.target.checked })
                    }
                  />{" "}
                  打开软件后自动在后台转写
                </label>
                <p className="note">
                  处理已读取并缓存的单聊语音，新读取的语音会加入队列。已完成的直接复用，失败或缺失音频本轮不反复重试。这里只在本机运行，不调用
                  Jev。
                </p>
                <label className="field">
                  并行数量
                  <select
                    aria-label="设置并行数量"
                    value={speechConcurrency}
                    disabled={busy}
                    onChange={(e) =>
                      updatePreferences({
                        speechConcurrency: Number(
                          e.target.value,
                        ) as AppSettings["speechConcurrency"],
                      })
                    }
                  >
                    {speechConcurrencyOptions.map((n) => (
                      <option key={n} value={n}>
                        {n} 条并行
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  转写模式
                  <select
                    aria-label="设置转写模式"
                    value={speechMode}
                    disabled={busy}
                    onChange={(e) =>
                      updatePreferences({
                        speechMode: e.target.value as "fast" | "accurate",
                      })
                    }
                  >
                    <option value="fast">快速 · Base</option>
                    <option value="accurate">精细 · Small（较慢）</option>
                  </select>
                </label>
                <p className="note">
                  20
                  条并行是同时处理上限，不保证比低并行更快。精细模式适合重要语音；两种模式都可能识别错误，可在聊天记录中校对文字。
                </p>
                <h3>保存与复用</h3>
                <p>
                  文字保存到本机
                  SQLite，并复制到桌面「微信语音转写」。重开软件不重复处理已完成语音。设置自动保存。
                </p>
                <button
                  onClick={() =>
                    void run(async () => {
                      const result = await api!.openTranscriptFolder();
                      if (result.error)
                        setError(
                          "桌面转写文件夹暂不可用，已有文字仍保留在 SQLite。",
                        );
                    })
                  }
                >
                  打开桌面转写文件夹
                </button>
              </section>
            )}
            {settingsTab === "rubric" && (
              <section>
                <h3>行为评分 · 对话证据版 v9</h3>
                <p className="report-coverage">
                  实验性规则，尚未校准。规则与案例已冻结并校验摘要；任何评分变更必须留下版本与评测记录，不能仅因觉得偏高或偏低而改权重。当前没有真实关系准确率。
                </p>
                <p>
                  先独立判断12个具体行为，再由本机透明规则组合为五项0–100行为指数。每个行为保存
                  Jev 官方
                  confidence；证据定位的不确定性不会删除整段评分。明确拒绝与事务解释限制好感、暧昧解读。按会话与容量切分，前文只作为背景。好感和暧昧分别显示信号强度、片段频率与独立交流次数。普通聊天不稀释明确表达；其他三项仍取可评价分段中位数。确实无法评价的段排除。
                </p>
                <ul>
                  <li>区分 Me 与 Person A，避免把单方热情归给对方。</li>
                  <li>结合上下文、反证、礼貌、事务联系、拒绝和明确边界。</li>
                  <li>单条赞美、消息量和长文字不自动等于好感或暧昧。</li>
                  <li>不猜测缺失语音、图片、回复时长或对方心理。</li>
                  <li>
                    一次明确表达可形成较强信号；是否反复出现单独展示，不将孤立表达当作持续趋势。
                  </li>
                </ul>
                <p className="note">
                  这些分数反映聊天行为信号，不代表对方真实心理状态。此前v4已使用合成行为标签运行官方API评测；下方报告是其历史基线，不能代表当前v9效果或真实聊天准确率。分析前请检查转写与匿名化预览。
                </p>
              </section>
            )}
            {settingsTab === "rubric" && (
              <section className="evaluation-settings">
                <label className="setting-toggle">
                  <input
                    type="checkbox"
                    checked={preferences.jevConsistency === true}
                    disabled={busy}
                    onChange={(e) =>
                      updatePreferences({ jevConsistency: e.target.checked })
                    }
                  />{" "}
                  启用 Jev 选项换序复核
                </label>
                <p className="note">
                  下次手动分析时，在同一请求中增加12题，比较选项顺序变化后的行为等级。存在差异标记需复核；不替换初次判断。会增加请求题数和费用，默认关闭。
                </p>
                <h3>评价验证与分类误差</h3>
                {evaluation ? (
                  <>
                    <p>
                      评测版本 {evaluation.rubricVersion} ·
                      历史报告，不能用于验证当前 v9
                      汇总。此前查看过的保留集不再视为新的盲测集。
                    </p>
                    <p>
                      官方模型 {evaluation.model} · {evaluation.cases} 个案例 ·{" "}
                      {evaluation.correct}/{evaluation.labels} 个行为标签匹配
                    </p>
                    <p>
                      保留集 {evaluation.holdoutCorrect}/
                      {evaluation.holdoutLabels} · 换序一致 {evaluation.stable}/
                      {evaluation.checked} · 请求失败 {evaluation.failed}
                    </p>
                    <p>
                      误报 {evaluation.falsePositive}/
                      {evaluation.negativeLabels} · 漏报 {evaluation.missed}/
                      {evaluation.positiveLabels} · 本地校对{" "}
                      {evaluation.localLabels} 条
                    </p>
                    <p>
                      完整运行覆盖：
                      {evaluation.coverage == null
                        ? "旧报告未记录"
                        : Math.round(evaluation.coverage * 100) + "%"}{" "}
                      · 数据来源：
                      {evaluation.independentAnnotation
                        ? "提供方声明独立标注（不等于真实关系验证）"
                        : "开发者编写合成样例，未独立盲测"}
                    </p>
                    {evaluation.perCategory && (
                      <table className="evaluation-breakdown">
                        <thead>
                          <tr>
                            <th>类别</th>
                            <th>标签匹配</th>
                            <th>误报</th>
                            <th>漏报</th>
                            <th>无法判断</th>
                            <th>失败案例</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(evaluation.perCategory).map(
                            ([name, r]) => (
                              <tr key={name}>
                                <td>{name}</td>
                                <td>
                                  {r.correct}/{r.labels}
                                </td>
                                <td>
                                  {r.falsePositive}/{r.negativeLabels}
                                </td>
                                <td>
                                  {r.missed}/{r.positiveLabels}
                                </td>
                                <td>{r.abstained}</td>
                                <td>
                                  {r.failedCases}/{r.cases}
                                </td>
                              </tr>
                            ),
                          )}
                        </tbody>
                      </table>
                    )}
                    <small>
                      行为标签匹配不代表真实关系判断准确率。独立性只能依据数据来源说明，系统无法替代人工核验。真实案例可在评价报告中校对行为标签，校对只保存在本机，不修改原评分、不发送Jev。
                    </small>
                  </>
                ) : (
                  <p>尚无在线合成案例报告。程序测试不能代替模型语义评测。</p>
                )}
              </section>
            )}
            <div hidden={settingsTab !== "jev"}>
              <p>
                这里配置官方 TypeSafe Jev。无需下载模型；API Key 只保存在 macOS
                钥匙串。
              </p>
              <label className="field">
                官方模型
                <select
                  aria-label="官方 Jev 模型"
                  value={model}
                  disabled={settingsLocked}
                  onChange={(e) => {
                    const value = e.target.value;
                    void run(async () => {
                      await api!.setJevModel(value);
                      setModel(value);
                    });
                  }}
                >
                  <option value="jev-latest">Jev 最新稳定版（推荐）</option>
                  <option value="jev-1.13.0">固定版本 Jev 1.13.0</option>
                </select>
              </label>
              <div className="toolbar-actions">
                <button
                  disabled={!api}
                  onClick={() =>
                    void run(async () => {
                      await api!.openJevWebsite("home");
                    })
                  }
                >
                  打开 Jev 官网 ↗
                </button>
                <button
                  disabled={!api}
                  onClick={() =>
                    void run(async () => {
                      await api!.openJevWebsite("console");
                    })
                  }
                >
                  配置 Key / 购买额度 ↗
                </button>
              </div>
              <p className="website-help">
                在系统浏览器打开官方页面。登录后管理 API Key 和使用额度，再把
                Key 填入下方。
              </p>
              <small>
                官方地址：api.typesafe.ai ·
                只接收文本。设置或切换模型不会发送聊天。
              </small>
              <section className="key settings-key">
                <h3>TypeSafe API Key</h3>
                <p>{hasKey ? "已存钥匙串" : "尚未设置；本地统计仍可使用"}</p>
                <input
                  type="password"
                  autoComplete="off"
                  placeholder="官方 TypeSafe Key"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                />
                <button
                  disabled={settingsLocked || !key || !api}
                  onClick={() =>
                    run(async () => {
                      await api!.saveKey(key);
                      setKey("");
                      setHasKey(true);
                    })
                  }
                >
                  保存到钥匙串
                </button>
                {hasKey && (
                  <button
                    disabled={settingsLocked}
                    onClick={() =>
                      run(async () => {
                        await api!.deleteKey();
                        setHasKey(false);
                      })
                    }
                  >
                    删除 Key
                  </button>
                )}
              </section>
            </div>
          </section>
        </div>
      )}
      {evidenceContext && (
        <div
          className="overlay"
          role="dialog"
          aria-modal="true"
          aria-label="证据聊天上下文"
        >
          <section className="dialog context-dialog">
            <div className="dialog-title">
              <h2>证据聊天上下文</h2>
              <button onClick={() => setEvidenceContext(null)}>关闭</button>
            </div>
            <p>{evidenceContext.detail}</p>
            <div className="context-messages">
              {evidenceContext.messages.map((m) => (
                <div
                  key={m.id}
                  className={
                    "message " +
                    m.sender +
                    (evidenceContext.targetIds.includes(m.id)
                      ? " evidence-target"
                      : "")
                  }
                >
                  <small>
                    {m.sender === "me"
                      ? "我"
                      : m.sender === "other"
                        ? "对方"
                        : "未知"}{" "}
                    · {new Date(m.timestamp * 1000).toLocaleString()}
                    {evidenceContext.targetIds.includes(m.id)
                      ? " · 所选证据范围"
                      : " · 相邻上下文"}
                  </small>
                  <p>
                    {m.kind === "voice"
                      ? m.transcript || "[语音未转写]"
                      : m.kind === "image"
                        ? m.media?.text || "[图片无可用文字]"
                        : m.text}
                  </p>
                  {m.kind !== "text" && (
                    <small>
                      来源：{m.kind} · 文字可能有误；画面和语气未理解
                    </small>
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
      {editing && (
        <div
          className="overlay"
          role="dialog"
          aria-modal="true"
          aria-label={
            editing.kind === "image" ? "检查图片文字" : "检查语音转写"
          }
        >
          <section className="dialog">
            <h2>
              {editing.kind === "image" ? "检查图片文字" : "检查语音转写"}
            </h2>
            <p>
              识别可能漏字或误识别。请只校正实际内容，不补写未观察到的信息。编辑只保存在本机；分析时仍需匿名化预览。
            </p>
            <textarea
              aria-label={
                editing.kind === "image" ? "图片识别文字" : "语音转写文字"
              }
              value={editing.text}
              onChange={(e) => setEditing({ ...editing, text: e.target.value })}
            />
            <button disabled={locked} onClick={() => setEditing(null)}>
              取消
            </button>
            <button
              disabled={locked}
              onClick={() =>
                run(async () => {
                  setView(
                    await (
                      editing.kind === "image"
                        ? api!.editImageText
                        : api!.editTranscript
                    )(selected, editing.id, editing.text),
                  );
                  setPlan(null);
                  setMessageRevision((n) => n + 1);
                  setEditing(null);
                })
              }
            >
              保存本地文字
            </button>
          </section>
        </div>
      )}
      {connection && (
        <div className="overlay">
          <section className="dialog">
            <h2>连接本机微信</h2>
            <p>{connection.detail}</p>
            <ul className="connection-checks">
              {connection.checks.map((c) => (
                <li key={c.label}>
                  {c.ok ? "✓" : "待完成"} · {c.label}
                </li>
              ))}
            </ul>
            {connection.needsSetup && (
              <>
                <p>
                  首次授权会打开本机终端，只有你明确同意并输入管理员密码后才重签微信。随后需要在微信退出账号并重新登录。打开助手不代表连接成功；只有再次检测数据库可读才算完成。
                </p>
                <button
                  disabled={locked}
                  onClick={() => run(async () => api!.openWechatSetup())}
                >
                  打开首次连接助手
                </button>
                <button
                  disabled={locked}
                  onClick={() =>
                    run(async () => {
                      const next = await api!.connection();
                      setConnection(next);
                      if (next.readable) {
                        setReadable(true);
                        setStatus(next.detail);
                        setChats(await api!.conversations());
                        setConnection(null);
                      }
                    })
                  }
                >
                  授权后检查连接
                </button>
              </>
            )}
            <button disabled={locked} onClick={() => setConnection(null)}>
              关闭
            </button>
          </section>
        </div>
      )}
      {plan && (
        <div className="overlay">
          <section className="dialog">
            <h2>检查即将发送的全部分段</h2>
            <p>
              {plan.messageCount} 条匿名消息（含来源和缺失标记） ·{" "}
              {plan.batches.length} 次官方 Jev
              请求（每次12项具体行为、3项双向互动、10项证据选择
              {preferences.jevConsistency ? "，另加12项换序复核" : ""}） · 排除{" "}
              {plan.omitted} 条 · 截短 {plan.truncated}{" "}
              条长消息。检查正文中可能残留的人名；可以取消。
            </p>
            <label>
              预览分段{" "}
              <select
                disabled={busy}
                value={batchIndex}
                onChange={(e) => changeBatch(Number(e.target.value))}
              >
                {plan.batches.map((b) => (
                  <option key={b.index} value={b.index}>
                    第 {b.index + 1} 段 · {b.messageCount} 条 ·{" "}
                    {new Date(b.first * 1000).toLocaleDateString()} —{" "}
                    {new Date(b.last * 1000).toLocaleDateString()}
                  </option>
                ))}
              </select>
            </label>
            <pre>{batchText}</pre>
            <p className="note">
              仅将各段 speaker（Me / Person
              A）、清理后的正文、来源类型与内容可用状态发送到
              api.typesafe.ai。context / followingContext
              为有限前后文，只用于理解，不重复计数。日期、联系人 ID
              和本地统计不发送。规则匿名化可能遗漏自由文本身份信息。
            </p>
            <button disabled={busy} onClick={() => setPlan(null)}>
              取消
            </button>
            <button disabled={busy || !hasKey} onClick={analyze}>
              确认发送 {plan.batches.length} 段给 Jev 判断
            </button>
            {!hasKey && (
              <p>
                请先点击顶部「设置 → Jev 与 Key」保存官方 API
                Key；尚未发送任何文本。
              </p>
            )}
          </section>
        </div>
      )}
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
