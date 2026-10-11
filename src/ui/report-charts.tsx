import React from "react";
import { metricLabels, type Analysis, type Metric } from "../domain/types";
import { behaviorDefinitions } from "../infrastructure/jev-behaviors";
export function ReportCharts({
  analysis,
  onSelect,
}: {
  analysis: Analysis;
  onSelect: (metric: Metric, index: number) => void;
}) {
  const segments = analysis.segments ?? [];
  const rows = segments.length ? segments.map((s) => s.result) : [analysis];
  return (
    <div className="report-charts">
      <section className="chart">
        <h3>五项信号对比</h3>
        <p className="note">
          同一已分析范围的描述指数；好感与暧昧在新版中表示信号出现时的强度，其他三项为分段中位数。各项不能相加成为喜欢概率。点击指标查看依据。
        </p>
        {Object.entries(metricLabels).map(([id, label]) => {
          const m = analysis.metrics[id as Metric];
          const known = m.quality !== "insufficient";
          return (
            <button
              className="signal-comparison"
              key={id}
              onClick={() =>
                onSelect(id as Metric, Math.max(0, segments.length - 1))
              }
              aria-label={`查看${label}评价`}
            >
              <span>{label}</span>
              <span className="comparison-track">
                <span style={{ width: known ? `${m.score}%` : "0%" }} />
              </span>
              <b>{known ? m.score : "—"}</b>
              <small>
                {m.quality === "limited"
                  ? "需复核"
                  : known
                    ? "有评分"
                    : "无法评价"}
              </small>
            </button>
          );
        })}
      </section>
      {segments.length > 0 && (
        <details className="chart matrix-disclosure">
          <summary>
            分段信号矩阵 <small>展开分段详情</small>
          </summary>
          <p className="note">
            左早右晚，每列一段；颜色深浅表示指数，灰色表示无法评价。点击格子切换到该指标与分段；●表示需复核。
          </p>
          <div className="signal-matrix-scroll">
            <div
              className="signal-matrix"
              style={{
                gridTemplateColumns: `86px repeat(${segments.length}, minmax(30px,1fr))`,
              }}
            >
              <span>指标 / 段</span>
              {segments.map((s, i) => (
                <small key={s.index}>{i + 1}</small>
              ))}
              {Object.entries(metricLabels).map(([id, label]) => (
                <React.Fragment key={id}>
                  <b>{label}</b>
                  {segments.map((s, i) => {
                    const m = s.result.metrics[id as Metric];
                    const known = m.quality !== "insufficient";
                    return (
                      <button
                        key={s.index}
                        className={!known ? "matrix-unknown" : ""}
                        style={
                          known
                            ? {
                                backgroundColor: `hsl(158 30% ${96 - m.score * 0.48}%)`,
                              }
                            : undefined
                        }
                        aria-label={`查看${label}第${i + 1}段：${known ? m.score + "分" : "无法评价"}`}
                        title={`${new Date(s.first * 1000).toLocaleDateString()} · ${known ? m.score + "/100" : "无法评价"}${m.quality === "limited" ? " · 需复核" : ""}`}
                        onClick={() => onSelect(id as Metric, i)}
                      >
                        {known ? m.score : "—"}
                        {m.quality === "limited" && <sup>●</sup>}
                      </button>
                    );
                  })}
                </React.Fragment>
              ))}
            </div>
          </div>
        </details>
      )}
      {rows.some((r) => r.behaviors) && (
        <section className="chart">
          <h3>具体行为出现情况</h3>
          <p className="note">
            明确或反复行为段 /
            可评价段。缺失行为记录与无法评价不进入分母；分段重复不等于独立事件。
          </p>
          {Object.entries(behaviorDefinitions).map(([id, def]) => {
            const observations = rows
              .map((r) => r.behaviors?.[id])
              .filter(
                (o) =>
                  o &&
                  o.choice !== "unclear" &&
                  (o.probabilities.unclear ?? 0) < 0.5,
              );
            const count = observations.filter(
              (o) => o?.choice === "clear" || o?.choice === "strong",
            ).length;
            return (
              <div className="behavior-frequency" key={id}>
                <span>{def.label}</span>
                <span className="comparison-track">
                  <span
                    style={{
                      width: `${observations.length ? (count / observations.length) * 100 : 0}%`,
                    }}
                  />
                </span>
                <b>
                  {count}/{observations.length}
                </b>
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}
export const metricExplanations: Record<
  Metric,
  { meaning: string; alternative: string; check: string }
> = {
  romantic_interest: {
    meaning:
      "关注对方指向你的具体关心、私人活动安排、个人化亲近赞美与浪漫表达；普通友好与浪漫指向分别考虑，明确表达不要求其他行为同时出现。",
    alternative:
      "普通朋友也会关心和约活动。学习、工作、求助与礼貌可以解释热情；不要只看消息量或一句夸奖。",
    check:
      "检查是否由Person A主动表达、是否明确指向Me、是否有引用/反讽/转写错误，以及当时是否存在明确关系边界。",
  },
  initiative: {
    meaning: "观察对方自主开启新内容、提出具体追问和延续话题的行为。",
    alternative: "事务催办、索取帮助与被动回答不等于主动发展关系。",
    check:
      "查看主动提出的内容与后续回应；本项语义判断不推断回复速度，本地开启次数另见统计图表。",
  },
  emotional_investment: {
    meaning: "观察针对你具体感受的支持，以及有上下文的个人情绪分享。",
    alternative: "单纯长消息、倾诉自己的问题或套话安慰不等于对你的情绪投入。",
    check:
      "核对是否回应你的感受与需要，分享是否有上下文；缺失语音可能改变解释。",
  },
  closeness: {
    meaning: "观察双方共同认可的经历、默契和双向私人信任表达。",
    alternative: "单方声称关系亲密、客套称呼与工作熟悉不能证明双向亲密。",
    check: "核对双方是否真正回应并认可彼此；这不推断恋人身份或现实关系承诺。",
  },
  flirting: {
    meaning: "观察指向你的个人化亲近赞美及明确调情或浪漫暗示。",
    alternative:
      "普通玩笑、感谢、工作成果夸奖、性相关事务或转述他人不自动构成调情。",
    check:
      "检查相邻上下文、否定与反讽，以及对方是否要求保持边界；孤立表达应谨慎复核。",
  },
};
