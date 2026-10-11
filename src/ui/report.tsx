import React, { useState } from "react";
import {
  CoveragePanel,
  InteractionPanel,
  SignalTimeline,
  MetricEvidenceDigest,
} from "./insights";
import { RelationshipOutlook } from "./relationship-outlook";
import { ReportCharts, metricExplanations } from "./report-charts";
import { behaviorDefinitions } from "../infrastructure/jev-behaviors";
import {
  metricLabels,
  type Metric,
  type MetricResult,
  type View,
} from "../domain/types";
export const qualityLabels = {
  sufficient: "可评价",
  limited: "需复核",
  insufficient: "证据不足",
};
export function MetricReport({
  view,
  onOpenContext,
}: {
  view: View;
  onOpenContext?: (
    segment: number,
    metric: Metric,
    side: "support" | "counter",
  ) => void;
}) {
  const [panel, setPanel] = useState("overview");
  const [metric, setMetric] = useState<Metric>("romantic_interest");
  const [chosen, setChosen] = useState(-1);
  const [labelStatus, setLabelStatus] = useState("");
  const analysis = view.analysis;
  const segments = analysis?.segments ?? [];
  const eventMode = analysis?.aggregationVersion === "event-strength-v3";
  const index =
    chosen < 0
      ? Math.max(0, segments.length - 1)
      : Math.min(chosen, Math.max(0, segments.length - 1));
  const detail: MetricResult | undefined =
    segments[index]?.result.metrics[metric] ?? analysis?.metrics[metric];
  const total = analysis?.metrics[metric];
  const trend = total?.summary?.trend;
  const source = analysis?.inputCoverage;
  const behaviorResult = segments[index]?.result ?? analysis;
  const behaviorLabels: Record<string, string> = {
    absent: "未观察到",
    weak: "孤立 / 有歧义",
    clear: "明确行为",
    strong: "反复一致",
    unclear: "无法评价",
  };
  return (
    <section className="evaluation-report">
      <div className="panel-heading">
        <div>
          <h2>评价报告</h2>
        </div>
        <span className="pill">
          {eventMode
            ? analysis?.rubricVersion?.includes("v9")
              ? "对话证据版 v9 · 双向互动"
              : analysis?.rubricVersion?.includes("v8")
                ? "对象归属版 v8 · 事件汇总"
                : "信号事件汇总 · v7"
            : analysis?.rubricVersion?.includes("v6")
              ? "多模态证据版 v6"
              : analysis?.rubricVersion?.includes("v5")
                ? "好感分层版 v5"
                : analysis?.rubricVersion?.includes("v4")
                  ? "具体行为版 v4"
                  : analysis?.rubricVersion?.includes("v3")
                    ? "证据版 v3 · 汇总已修复"
                    : analysis
                      ? "旧版结果"
                      : "尚未分析"}
        </span>
      </div>
      <p className="note">这些分数反映聊天行为信号，不代表对方真实心理状态。</p>
      <details className="report-methods">
        <summary>评分依据与版本说明 · 实验性指数</summary>
        {analysis && (
          <p className="report-coverage" role="note">
            实验性行为指数 ·
            尚未经过独立盲测与校准。评分规则已冻结，不以分数高低调参。
            较强片段汇总可能放大少量表达；分段中位数可能稀释稀疏表达。两者差异不证明哪个更准确。
          </p>
        )}
        <p className="note">
          这些分数反映聊天行为信号，不代表对方真实心理状态。证据为已发送的匿名原文片段，正文由本机还原，Jev
          不生成引用。
        </p>
        {analysis?.rubricVersion?.includes("v3") &&
          analysis.aggregationVersion === "reviewable-median-v2" && (
            <p className="report-coverage">
              已在本机恢复需复核分段的汇总。没有重新请求Jev，原始分段评分保持不变；需复核不等于证据不足。
            </p>
          )}
        {eventMode && (
          <p className="report-coverage">
            已按信号事件在本机汇总。日常聊天计入出现频率，不稀释已观察到的明确表达。
            {!analysis?.rubricVersion?.match(/v[789]/) &&
              "使用已保存的旧版行为判断重新计算；没有重新请求 Jev，原始记录与分析日期保留。"}
          </p>
        )}
      </details>
      {analysis && (
        <div className="report-navigation" role="group" aria-label="报告视图">
          <button
            aria-pressed={panel === "overview"}
            onClick={() => setPanel("overview")}
          >
            总览图表
          </button>
          <button
            aria-pressed={panel === "outlook"}
            onClick={() => setPanel("outlook")}
          >
            关系走向
          </button>
          <button
            aria-pressed={panel === "evidence"}
            onClick={() => setPanel("evidence")}
          >
            证据与解释
          </button>
        </div>
      )}
      {analysis && (
        <div hidden={panel !== "outlook"}>
          <RelationshipOutlook
            analysis={analysis}
            onSelect={(id, position) => {
              setMetric(id);
              setChosen(position);
              setPanel("evidence");
            }}
          />
        </div>
      )}
      <div hidden={panel !== "overview"}>
        <CoveragePanel view={view} />
        {analysis && (
          <section className="five-metric-overview" aria-label="全部五项评价">
            <h3>全部五项评价</h3>
            <div className="five-metric-grid">
              {Object.entries(metricLabels).map(([id, label]) => {
                const m = analysis.metrics[id as Metric];
                const explanation = {
                  romantic_interest: "亲近或浪漫表达的信号强度",
                  initiative: "主动提出内容与延续话题",
                  emotional_investment: "情绪支持与个人分享",
                  closeness: "共享经历与双向信任",
                  flirting: "个人化赞美与浪漫暗示",
                }[id];
                return (
                  <button
                    key={id}
                    aria-label={`查看${label}依据`}
                    onClick={() => {
                      setMetric(id as Metric);
                      setPanel("evidence");
                    }}
                  >
                    <span>{label}</span>
                    <strong>
                      {m.quality === "insufficient" ? "—" : m.score}
                      <small>/100</small>
                    </strong>
                    <small>{explanation}</small>
                    <small>{qualityLabels[m.quality ?? "limited"]}</small>
                  </button>
                );
              })}
            </div>
            <p className="note">
              五项分别描述不同聊天行为。倾诉经历可增加情绪投入的依据，但不能直接等同好感或暧昧；负面情绪必须区分针对谁。
            </p>
            <button onClick={() => setPanel("outlook")}>
              分数含义与未来关系推断 →
            </button>
          </section>
        )}
        {analysis && (
          <section className="interest-overview" aria-label="好感信号概览">
            <div className="panel-heading">
              <h3>好感信号概览</h3>
              <span className="pill">行为指数 · 非心理概率</span>
            </div>
            <div className="interest-numbers">
              <div>
                <small>
                  {eventMode ? "观察到的信号强度" : "所选范围 · 历史中位数"}
                </small>
                <strong>
                  {analysis.metrics.romantic_interest.quality === "insufficient"
                    ? "—"
                    : analysis.metrics.romantic_interest.score}
                  <em>/100</em>
                </strong>
              </div>
              <div>
                <small>后段评分</small>
                <strong>
                  {analysis.metrics.romantic_interest.summary?.recentScore ??
                    "—"}
                </strong>
                <small>后段为时间顺序末三分之一，非最近7天</small>
              </div>
            </div>
            <p className="note">
              {eventMode
                ? "评分描述信号出现时的强度；频率与多次出现情况单独展示。一次明确表达可以较强，但不能据此推断持续好感。普通友好、事务解释与明确边界仍限制解读。"
                : analysis.rubricVersion?.includes("v5") ||
                    analysis.rubricVersion?.includes("v6")
                  ? "关心与共同活动占40%，个人化赞美与浪漫暗示占60%；检查具体行为与反证，避免把友好直接解释为浪漫。"
                  : "旧版结果，请手动分析获得分层评价。旧评分保留，不套用新版公式。"}
            </p>
            {eventMode && (
              <div className="signal-profiles">
                {(["romantic_interest", "flirting"] as const).map((id) => {
                  const result = analysis.metrics[id],
                    summary = result.summary,
                    signal = summary?.signal;
                  if (!signal) return null;
                  return (
                    <section
                      className="signal-profile"
                      key={id}
                      aria-label={metricLabels[id] + "出现情况"}
                    >
                      <div className="panel-heading">
                        <h4>{metricLabels[id]}</h4>
                        <b>
                          {result.quality === "insufficient"
                            ? "—"
                            : result.score}
                          /100
                        </b>
                      </div>
                      <p>
                        {result.quality === "insufficient"
                          ? "正文无法评价"
                          : signal.pattern === "repeated"
                            ? "多次观察"
                            : signal.pattern === "isolated"
                              ? "孤立信号"
                              : signal.pattern === "ambiguous"
                                ? "含义待复核"
                                : signal.pattern === "friendly_only"
                                  ? "观察到友好行为"
                                  : "未观察到明确信号"}{" "}
                        · {signal.episodes} 次独立浪漫交流
                      </p>
                      <label>
                        明确浪漫片段 {signal.clearSegments} /{" "}
                        {summary!.eligibleSegments}
                        <meter
                          min={0}
                          max={Math.max(1, summary!.eligibleSegments)}
                          value={signal.clearSegments}
                          aria-label={metricLabels[id] + "片段出现频率"}
                        />
                      </label>
                      <small>
                        普通 / 友好片段 {signal.ordinarySegments} · 含义待复核{" "}
                        {signal.ambiguousSegments} · 边界片段{" "}
                        {signal.boundarySegments}
                      </small>
                      <small>
                        具体关心 / 共同活动 {signal.friendlySegments}{" "}
                        段（不直接等同浪漫）
                      </small>
                      <small>
                        全部片段中位数 {signal.baselineMedian}（供对照）
                      </small>
                      {(result.reviewReasons ?? []).map((reason) => (
                        <small key={reason}>{reason}</small>
                      ))}
                    </section>
                  );
                })}
                <p className="note">
                  频率以可评价片段为分母，不是消息比例；分段长度会影响频率。间隔不足6小时的相邻信号合并为一次交流，取每次峰值的中位数。该规则描述表达强度，没有验证为真实心理概率。
                </p>
              </div>
            )}
            <div className="interest-facts">
              <span>
                支持片段：
                {segments.length
                  ? segments.filter(
                      (s) => s.result.metrics.romantic_interest.support,
                    ).length
                  : analysis.metrics.romantic_interest.support
                    ? 1
                    : 0}{" "}
                段
              </span>
              <span>
                反证 / 替代解释：
                {segments.length
                  ? segments.filter(
                      (s) => s.result.metrics.romantic_interest.counter,
                    ).length
                  : analysis.metrics.romantic_interest.counter
                    ? 1
                    : 0}{" "}
                段
              </span>
              <span>
                明确关系边界：
                {(segments.length
                  ? segments.map((s) => s.result)
                  : [analysis]
                ).some((r) => r.behaviors)
                  ? (segments.length
                      ? segments.map((s) => s.result)
                      : [analysis]
                    ).filter((r) =>
                      ["clear", "strong"].includes(
                        r.behaviors?.boundary?.choice ?? "",
                      ),
                    ).length + " 段"
                  : "旧版未记录"}
              </span>
            </div>
            {segments.length > 0 && (
              <>
                <p className="note">
                  逐段好感信号 · 左早右晚 ·
                  点击柱条查看该段证据；灰色表示无法评价。
                </p>
                <div
                  className="interest-bars"
                  role="group"
                  aria-label="逐段好感趋势"
                >
                  {segments.map((s, i) => {
                    const m = s.result.metrics.romantic_interest;
                    return (
                      <button
                        key={s.index}
                        aria-label={`好感第${i + 1}段：${m.quality === "insufficient" ? "证据不足" : m.score + "分"}`}
                        aria-pressed={
                          metric === "romantic_interest" && index === i
                        }
                        title={`${new Date(s.first * 1000).toLocaleDateString()} · ${m.quality === "insufficient" ? "证据不足" : m.score + "/100"}`}
                        className={
                          m.quality === "insufficient" ? "unknown" : ""
                        }
                        onClick={() => {
                          setMetric("romantic_interest");
                          setChosen(i);
                          setPanel("evidence");
                        }}
                      >
                        <span
                          style={{
                            height: `${m.quality === "insufficient" ? 4 : Math.max(3, m.score)}%`,
                          }}
                        />
                      </button>
                    );
                  })}
                </div>
              </>
            )}
            <p className="note">
              片段数量不是独立证据数量，相邻片段可能重复讨论同一件事。高分不抵消明确边界；请检查发生时间与上下文。
            </p>
          </section>
        )}
        <InteractionPanel
          view={view}
          onSelect={(id, i) => {
            setMetric(id);
            setChosen(i);
            setPanel("evidence");
          }}
        />
        <SignalTimeline
          analysis={analysis}
          onSelect={(id, i) => {
            setMetric(id);
            setChosen(i);
            setPanel("evidence");
          }}
        />
        {analysis && (
          <ReportCharts
            analysis={analysis}
            onSelect={(id, i) => {
              setMetric(id);
              setChosen(i);
              setPanel("evidence");
            }}
          />
        )}
        {source && (
          <div className="report-coverage">
            <b>本次分析覆盖</b>
            <span>
              已分析 {analysis?.messageCount} / {source.total} 条 · 排除{" "}
              {source.omitted} 条 · 未转写语音 {source.pendingVoice} 条 · 截短{" "}
              {source.truncated} 条
            </span>
            {source.modalities && (
              <div className="modality-bars" aria-label="本次已发送的证据来源">
                {(
                  [
                    ["text", "文字"],
                    ["voice", "语音"],
                    ["image", "图片"],
                    ["emoji", "贴图"],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key}>
                    <span>{label}</span>
                    <meter
                      min={0}
                      max={Math.max(1, source.total)}
                      value={source.modalities?.[key] ?? 0}
                      aria-label={label + "消息数量"}
                    />
                    <span>{source.modalities?.[key] ?? 0} 条</span>
                  </div>
                ))}
                <small>
                  含未知内容 {source.modalities.unknown_content ?? 0} 条 ·
                  已有语音文字 {source.modalities.voice_transcript ?? 0} 条 ·
                  已有图片文字 {source.modalities.image_ocr ?? 0} 条
                </small>
              </div>
            )}
            <small>
              语音转写与图片OCR标注来源后参与分析；未识别附件仅保留缺失标记，不作为负面证据。图片OCR不等于画面理解，旧报告需手动重新分析才能包含新证据。
            </small>
          </div>
        )}
      </div>
      <div
        className="report-detail"
        hidden={!!analysis && panel !== "evidence"}
      >
        <div className="metric-selector" role="group" aria-label="选择评价指标">
          {Object.entries(metricLabels).map(([id, label]) => (
            <button
              key={id}
              aria-pressed={metric === id}
              className={metric === id ? "selected" : ""}
              onClick={() => setMetric(id as Metric)}
            >
              {label}
            </button>
          ))}
        </div>
        {!analysis ? (
          <div className="report-empty">
            <h3>先查看聊天，再用 Jev 判断</h3>
            <p>
              点击顶部按钮，检查匿名化预览并确认发送后，这里才会显示真实证据与评价。不使用本地统计冒充
              AI 判断。
            </p>
          </div>
        ) : (
          <>
            <div className="report-summary">
              <div>
                <small>
                  {total?.summary?.signal
                    ? "观察到的信号强度"
                    : analysis.rubricVersion?.match(/v[3456789]/)
                      ? "历史中位数"
                      : "旧版汇总"}
                </small>
                <b>
                  {total?.quality === "insufficient"
                    ? "证据不足"
                    : (total?.score ?? "—")}
                </b>
                <small>
                  {total?.summary
                    ? `${total.summary.eligibleSegments}/${total.summary.totalSegments} 段有评分 · ${total.summary.reviewSegments ?? 0} 段需复核`
                    : "旧版汇总"}
                </small>
              </div>
              <div>
                <small>前段 → 后段</small>
                <b>
                  {total?.summary?.previousScore ?? "—"} →{" "}
                  {total?.summary?.recentScore ?? "—"}
                </b>
                <small>
                  {trend === "rising"
                    ? "后段信号较强"
                    : trend === "falling"
                      ? "后段信号较弱"
                      : trend === "stable"
                        ? "变化较小"
                        : "缺少可比较信号，无法判断变化"}
                </small>
              </div>
            </div>
            <p className="note">
              {eventMode
                ? "好感与暧昧按信号事件汇总，其他三项使用可评价分段中位数。前后各取时间顺序的三分之一；至少六段且两侧各有至少两段可评价才比较。好感与暧昧还要求两侧都出现明确信号，没有表达不视为下降或拒绝。"
                : "中位数包含可评价与需复核分段，确实无法评价的分段排除。前后各取时间顺序的三分之一；至少六段且两侧各有至少两段有评分才比较。"}
              差值达到15标记明显变化，需复核结果仍有不确定性。
            </p>
            {segments.length > 0 && (
              <label className="field">
                查看具体分段
                <select
                  aria-label="证据分段"
                  value={index}
                  onChange={(e) => setChosen(Number(e.target.value))}
                >
                  {segments.map((s, i) => (
                    <option value={i} key={s.index}>
                      第 {i + 1} 段 ·{" "}
                      {new Date(s.first * 1000).toLocaleDateString()} ·{" "}
                      {s.result.messageCount} 条
                    </option>
                  ))}
                </select>
              </label>
            )}
            <MetricEvidenceDigest
              analysis={analysis}
              metric={metric}
              onSelect={(id, i) => {
                setMetric(id);
                setChosen(i);
              }}
            />
            <section className="metric-explanation">
              <h3>如何理解{metricLabels[metric]}</h3>
              <p>{metricExplanations[metric].meaning}</p>
              <p>
                <b>替代解释：</b>
                {metricExplanations[metric].alternative}
              </p>
              <p>
                <b>需要核对的地方：</b>
                {metricExplanations[metric].check}
              </p>
              <p className="note">
                当前分段：
                {detail?.support ? "已定位支持片段" : "未定位明确支持片段"}；
                {detail?.counter
                  ? "已定位反证或替代解释"
                  : "未定位明确反证（不代表不存在反证）"}
                。请选择下方具体行为和原文检查；这些说明按已保存状态生成，没有额外调用Jev。
              </p>
            </section>
            <div className="evidence-status">
              <b>
                {detail?.quality
                  ? qualityLabels[detail.quality]
                  : "旧版未记录证据状态"}
              </b>
              <span>
                分段等级{" "}
                {detail?.quality === "insufficient"
                  ? "—"
                  : (detail?.score ?? "—")}{" "}
                ·{" "}
                {behaviorResult?.behaviors
                  ? "组合指数，官方 confidence 见各行为"
                  : `官方 confidence ${detail?.confidence?.toFixed(2) ?? "—"}`}
              </span>
              {!!detail?.reviewReasons?.length && (
                <small>
                  {detail.reviewReasons.join("；")}。confidence
                  提示阈值为0.6，尚未经过本项目样本校准。
                </small>
              )}
              {detail?.confidence !== null &&
                detail?.confidence !== undefined &&
                detail.confidence < 0.6 && (
                  <small>
                    confidence 较低，需复核。0.6 仅为界面提示阈值，不是准确率。
                  </small>
                )}
            </div>
            {behaviorResult?.behaviors && (
              <section className="behavior-report">
                <h3>具体行为与本地校对</h3>
                <p className="note">
                  每项由官方Jev独立判断；五项指数由本机规则组合，不是喜欢概率。校对标签只在本机保存，原结果保留。
                </p>
                <div className="behavior-table">
                  <table>
                    <thead>
                      <tr>
                        <th>行为</th>
                        <th>Jev等级</th>
                        <th>confidence</th>
                        <th>换序复核</th>
                        <th>人工校对</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(behaviorResult.behaviors).map(
                        ([id, o]) => (
                          <tr key={id}>
                            <td>
                              {behaviorDefinitions[
                                id as keyof typeof behaviorDefinitions
                              ]?.label ?? id}
                            </td>
                            <td>{behaviorLabels[o.choice] ?? o.choice}</td>
                            <td>{o.confidence.toFixed(2)}</td>
                            <td>
                              {o.stable === undefined
                                ? "未启用"
                                : o.stable
                                  ? "一致"
                                  : `不同：${behaviorLabels[o.checkChoice!] ?? o.checkChoice}`}
                            </td>
                            <td>
                              <select
                                aria-label={`校对${behaviorDefinitions[id as keyof typeof behaviorDefinitions]?.label ?? id}`}
                                key={`${analysis.id}:${index}:${id}`}
                                defaultValue=""
                                onChange={async (e) => {
                                  try {
                                    await window.wechat!.labelBehavior(
                                      analysis.id,
                                      index,
                                      id,
                                      e.target.value,
                                    );
                                    setLabelStatus(
                                      "校对已保存在本机；没有发送Jev。",
                                    );
                                  } catch {
                                    setLabelStatus("校对保存未完成，请重试。");
                                  }
                                }}
                              >
                                <option value="" disabled>
                                  选择标签
                                </option>
                                {Object.entries(behaviorLabels).map(
                                  ([v, l]) => (
                                    <option key={v} value={v}>
                                      {l}
                                    </option>
                                  ),
                                )}
                              </select>
                            </td>
                          </tr>
                        ),
                      )}
                    </tbody>
                  </table>
                </div>
                <small role="status">{labelStatus}</small>
                <p className="note">
                  组合项：
                  {detail?.composition
                    ?.map(
                      (id) =>
                        behaviorDefinitions[
                          id as keyof typeof behaviorDefinitions
                        ]?.label ?? id,
                    )
                    .join(" + ")}
                  。等级权重为0/25/75/100，按官方选项分布计算期望。
                  {eventMode
                    ? "好感取原分组公式与最强个人化浪漫表达的较大值，赞美单独乘0.8；暧昧取浪漫暗示与0.8倍个人赞美的较大值。其他行为未出现不会除低这一表达。"
                    : "v5/v6好感为40%关心/安排＋60%个人赞美/浪漫暗示。"}
                  没有浪漫指向时好感上限40，事务解释上限35，明确边界上限25。这些规则未做心理测量校准。
                </p>
              </section>
            )}
            {(["support", "counter"] as const).map((side) => (
              <section className={"evidence-block " + side} key={side}>
                <div className="panel-heading">
                  <h3>{side === "support" ? "支持片段" : "反证 / 替代解释"}</h3>
                  {detail?.[side] && onOpenContext && (
                    <button onClick={() => onOpenContext(index, metric, side)}>
                      定位完整聊天上下文 →
                    </button>
                  )}
                </div>
                <p className="note">
                  {side === "support"
                    ? "下列是模型选中的范围，需检查对象、引用与相邻回应，不能把范围内每句话都视为支持。"
                    : "反证也可能只是普通友好或事务解释；第三方负面情绪不等于对你疏远。"}
                </p>
                {detail?.[side] ? (
                  detail[side]!.messages.map((m, i) => (
                    <blockquote key={i}>
                      <b>{m.speaker}</b>
                      <p>{m.text}</p>
                    </blockquote>
                  ))
                ) : (
                  <p className="note">
                    本段未选出明确片段；这不等于没有该行为，也不等于分数为零。
                  </p>
                )}
              </section>
            ))}
          </>
        )}
      </div>
    </section>
  );
}
