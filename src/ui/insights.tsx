import React, { useState } from "react";
import {
  metricLabels,
  type Analysis,
  type Metric,
  type View,
} from "../domain/types";
import {
  interactionDefinitions,
  interactionLabels,
} from "../infrastructure/jev-interactions";

export function CoveragePanel({ view }: { view: View }) {
  const c = view.contentCoverage;
  if (!c)
    return (
      <section className="insight-card">
        <h3>数据覆盖</h3>
        <p>等待完整读取；不从最新聊天面板推算全部覆盖。</p>
      </section>
    );
  const voiceReady = Math.min(c.voice, c.transcribed),
    imageReady = Math.min(c.images ?? 0, c.imageOcr ?? 0);
  const usable = c.text + voiceReady + imageReady;
  const rows = [
    ["文字", c.text, c.text],
    ["语音", voiceReady, c.voice],
    ["图片文字", imageReady, c.images ?? 0],
  ] as const;
  return (
    <section className="insight-card coverage-panel" aria-label="数据覆盖">
      <div className="panel-heading">
        <h3>数据覆盖</h3>
        <span className="pill">当前读取 · 本机统计</span>
      </div>
      <div className="coverage-head">
        <strong>
          {usable.toLocaleString()}
          <small> / {c.total.toLocaleString()} 条有可用文字</small>
        </strong>
        <span>{view.coverage?.complete ? "范围已读完" : "范围未完整读取"}</span>
      </div>
      <div
        className="coverage-stack"
        role="img"
        aria-label={`可用文字${usable}条，其他或内容未知${Math.max(0, c.total - usable)}条`}
      >
        <span style={{ width: `${c.total ? (usable / c.total) * 100 : 0}%` }} />
      </div>
      <div className="coverage-grid">
        {rows.map(([label, ready, total]) => (
          <div key={label}>
            <span>{label}</span>
            <b>
              {ready}/{total}
            </b>
            <meter
              min={0}
              max={Math.max(1, total)}
              value={ready}
              aria-label={`${label}可用比例`}
            />
          </div>
        ))}
      </div>
      <p className="note">
        未转写语音 {c.voice - voiceReady} · 无可用图片文字{" "}
        {(c.images ?? 0) - imageReady} · 贴图 {c.emoji} · 其他 {c.other}
        。图片分类不计为语义证据；内容未知不是负面信号。
      </p>
      {view.analysis && (
        <p className="coverage-snapshot">
          已保存报告：{view.analysis.range?.label ?? "旧范围"} ·{" "}
          {view.analysis.messageCount.toLocaleString()} 条 ·{" "}
          {new Date(view.analysis.createdAt).toLocaleString()}
          。当前覆盖不代表旧报告已经包含新转写或图片文字。
        </p>
      )}
    </section>
  );
}
export function InteractionPanel({
  view,
  position,
  onSelect,
}: {
  view: View;
  position?: number;
  onSelect?: (metric: Metric, index: number) => void;
}) {
  const r = view.interactions,
    segments = view.analysis?.segments ?? [];
  const [chosen, setChosen] = useState(-1);
  const index =
    position ??
    (chosen < 0
      ? Math.max(0, segments.length - 1)
      : Math.min(chosen, segments.length - 1));
  const result = segments[index]?.result ?? view.analysis;
  const max = Math.max(1, r?.me.started ?? 0, r?.other.started ?? 0);
  return (
    <section className="insight-card" aria-label="双方互动">
      <div className="panel-heading">
        <h3>双方互动</h3>
        <span className="pill">方向与承接分开看</span>
      </div>
      {r ? (
        <>
          <p>
            {r.bilateralSessions}/{r.sessions}{" "}
            个交流会话有双方发言。首段起点不明，排除发起计数。
          </p>
          <div className="direction-rows">
            {(["me", "other"] as const).map((side) => (
              <div key={side}>
                <b>{side === "me" ? "我" : "对方"}</b>
                <span className="direction-bar">
                  <i style={{ width: `${(r[side].started / max) * 100}%` }} />
                </span>
                <span>
                  发起 {r[side].started} · 得到回应 {r[side].receivedReply}
                </span>
                <small>
                  尚无回应 {r[side].unanswered} · 观察期不足 {r[side].pending} ·
                  发言轮次 {r[side].turns}
                </small>
              </div>
            ))}
          </div>
          <p className="note">
            六小时停顿分隔会话；连续同一方消息算一个轮次。尚无回应不是拒绝，回复不等于认同或支持。
          </p>
        </>
      ) : (
        <p className="note">重新读取范围后显示双方轮次统计。</p>
      )}
      {segments.length > 0 && position === undefined && (
        <label className="field">
          双向语义分段
          <select
            aria-label="双向互动分段"
            value={index}
            onChange={(e) => setChosen(Number(e.target.value))}
          >
            {segments.map((s, i) => (
              <option key={s.index} value={i}>
                {i + 1} · {new Date(s.first * 1000).toLocaleString()}
              </option>
            ))}
          </select>
        </label>
      )}
      {result?.interactions ? (
        <div className="mutual-grid">
          {Object.entries(interactionDefinitions).map(([id, def]) => {
            const o = result.interactions?.[id];
            return (
              <section key={id}>
                <h4>{def.label}</h4>
                <b>
                  {o ? (interactionLabels[o.choice] ?? "无法判断") : "未记录"}
                </b>
                <small>
                  官方 confidence {o?.confidence.toFixed(2) ?? "—"}
                  {o && o.confidence < 0.6 ? " · 需复核" : ""}
                </small>
                {onSelect && (
                  <button
                    onClick={() =>
                      onSelect(
                        id === "support"
                          ? "emotional_investment"
                          : "romantic_interest",
                        index,
                      )
                    }
                  >
                    查看本段依据
                  </button>
                )}
              </section>
            );
          })}
        </div>
      ) : (
        <p className="note">
          未记录双向语义判断；旧报告可继续查看，手动确认新分析后获得。不会从消息数量猜测双方意愿。
        </p>
      )}
      <p className="note">
        双向判断独立展示，不加减原五项分数，也不代表双方真实心理状态。
      </p>
    </section>
  );
}
export function SignalTimeline({
  analysis,
  onSelect,
}: {
  analysis: Analysis | null;
  onSelect: (metric: Metric, index: number) => void;
}) {
  const segments = analysis?.segments ?? [];
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(0);
  const events = segments.flatMap((s, i) => {
    const b = s.result.behaviors;
    const clear = (id: string) => {
      const o = b?.[id];
      return (
        o &&
        ["clear", "strong"].includes(o.choice) &&
        o.confidence >= 0.6 &&
        o.stable !== false
      );
    };
    return [
      clear("boundary")
        ? {
            type: "boundary",
            label: "明确边界",
            metric: "romantic_interest" as Metric,
          }
        : null,
      clear("romantic_hint") || clear("personal_compliment")
        ? {
            type: "affection",
            label: "亲近 / 暧昧表达",
            metric: "flirting" as Metric,
          }
        : null,
      clear("shared_plans")
        ? {
            type: "plans",
            label: "共同活动安排",
            metric: "romantic_interest" as Metric,
          }
        : null,
      clear("emotional_support")
        ? {
            type: "support",
            label: "情绪支持",
            metric: "emotional_investment" as Metric,
          }
        : null,
    ]
      .filter(Boolean)
      .map((e) => ({ ...e!, index: i, first: s.first, last: s.last }));
  });
  const visible =
    filter === "all" ? events : events.filter((e) => e.type === filter);
  const pageRows = visible.slice(page * 60, (page + 1) * 60);
  const types = ["boundary", "affection", "plans", "support"];
  const names: Record<string, string> = {
    boundary: "边界",
    affection: "亲近表达",
    plans: "活动安排",
    support: "情绪支持",
  };
  const first = segments[0]?.first ?? 0,
    last = segments.at(-1)?.last ?? first;
  return (
    <section className="insight-card signal-timeline">
      <div className="panel-heading">
        <h3>关系信号时间线</h3>
        <span className="pill">点击检查上下文</span>
      </div>
      <p className="note">
        记录已分析单元内的明确行为；同一事件可能跨多段，列表数量不是独立事件数量。边界不被其他信号抵消。
      </p>
      {!analysis ? (
        <p>手动分析后显示真实 Jev 观察。</p>
      ) : !events.length ? (
        <p>
          未定位可可靠展示的明确行为。请查看弱信号与无法判断项；未表达不等于不喜欢。
        </p>
      ) : (
        <>
          <div className="timeline-counts">
            {["boundary", "affection", "plans", "support"].map((type) => {
              const labels: Record<string, string> = {
                boundary: "边界",
                affection: "亲近表达",
                plans: "活动安排",
                support: "情绪支持",
              };
              return (
                <span key={type}>
                  {labels[type]}{" "}
                  <b>{events.filter((e) => e.type === type).length}</b>
                </span>
              );
            })}
          </div>
          <div className="timeline-chart-wrap">
            <svg
              viewBox="0 0 680 210"
              role="img"
              aria-label="按实际日期展示四类明确信号，圆点可点击查看依据"
            >
              {types.map((type, i) => (
                <g key={type}>
                  <text x={0} y={30 + i * 42}>
                    {names[type]}
                  </text>
                  <line x1={95} x2={665} y1={26 + i * 42} y2={26 + i * 42} />
                </g>
              ))}
              {visible.slice(page * 60, (page + 1) * 60).map((e, i) => (
                <g
                  key={i}
                  role="button"
                  tabIndex={0}
                  aria-label={
                    e.label +
                    " " +
                    new Date(e.first * 1000).toLocaleDateString() +
                    " 查看第" +
                    (e.index + 1) +
                    "段"
                  }
                  onClick={() => onSelect(e.metric, e.index)}
                  onKeyDown={(k) => {
                    if (k.key === "Enter" || k.key === " ") {
                      k.preventDefault();
                      onSelect(e.metric, e.index);
                    }
                  }}
                >
                  <title>
                    {e.label} · {new Date(e.first * 1000).toLocaleString()}
                  </title>
                  <circle
                    className={e.type}
                    cx={
                      95 + ((e.first - first) / Math.max(1, last - first)) * 570
                    }
                    cy={26 + types.indexOf(e.type!) * 42}
                    r={6}
                  />
                </g>
              ))}
              <text x={95} y={200}>
                {new Date(first * 1000).toLocaleDateString()}
              </text>
              <text x={575} y={200}>
                {new Date(last * 1000).toLocaleDateString()}
              </text>
            </svg>
          </div>
          <label className="timeline-filter">
            行为类型{" "}
            <select
              aria-label="时间线行为类型"
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setPage(0);
              }}
            >
              <option value="all">全部</option>
              {types.map((t) => (
                <option key={t} value={t}>
                  {names[t]}
                </option>
              ))}
            </select>
          </label>
          <ol className="event-list">
            {pageRows.map((e, j) => (
              <li key={e.index + "-" + j} className={e.type}>
                <button onClick={() => onSelect(e.metric, e.index)}>
                  <time>{new Date(e.first * 1000).toLocaleString()}</time>
                  <strong>{e.label}</strong>
                  <small>
                    第 {e.index + 1} 段 · {metricLabels[e.metric]}依据 →
                  </small>
                </button>
              </li>
            ))}
          </ol>
          <div className="timeline-pages">
            <button disabled={page === 0} onClick={() => setPage(page - 1)}>
              上一页
            </button>
            <span>
              第 {page + 1}/{Math.max(1, Math.ceil(visible.length / 60))} 页 ·
              共 {visible.length} 个行为标记
            </span>
            <button
              disabled={(page + 1) * 60 >= visible.length}
              onClick={() => setPage(page + 1)}
            >
              下一页
            </button>
          </div>
        </>
      )}
    </section>
  );
}
export function MetricEvidenceDigest({
  analysis,
  metric,
  onSelect,
}: {
  analysis: Analysis;
  metric: Metric;
  onSelect: (metric: Metric, index: number) => void;
}) {
  const rows = (analysis.segments ?? []).map((s, index) => ({
    ...s,
    position: index,
    m: s.result.metrics[metric],
  }));
  const support = rows.filter((s) => s.m.support),
    counter = rows.filter((s) => s.m.counter);
  const low = rows.filter((s) => s.m.quality === "limited"),
    unknown = rows.filter((s) => s.m.quality === "insufficient");
  return (
    <section className="insight-card evidence-digest">
      <h3>{metricLabels[metric]} · 结论依据</h3>
      <p>
        已定位支持 {support.length} 段 · 反证或替代解释 {counter.length} 段 ·
        需复核 {low.length} 段 · 无法评价 {unknown.length} 段。
      </p>
      <p className="note">
        这是已保存证据的目录，不是对方心理结论。支持与反证一起检查；低信号不等于证据不足，没有选中反证也不等于不存在反证。
      </p>
      <div className="digest-grid">
        {(
          [
            ["支持", support],
            ["反证 / 替代解释", counter],
          ] as const
        ).map(([label, list]) => (
          <details key={label} open={list.length > 0}>
            <summary>
              {label} · {list.length} 段
            </summary>
            {list.length ? (
              <div className="digest-links">
                {list.map((s) => (
                  <button
                    key={s.index}
                    onClick={() => onSelect(metric, s.position)}
                  >
                    第 {s.position + 1} 段 ·{" "}
                    {new Date(s.first * 1000).toLocaleDateString()} ·{" "}
                    {s.m.quality === "insufficient"
                      ? "无法评价"
                      : s.m.score + "/100"}
                  </button>
                ))}
              </div>
            ) : (
              <p className="note">
                未定位明确片段。结合具体行为与原上下文核对。
              </p>
            )}
          </details>
        ))}
      </div>
    </section>
  );
}
