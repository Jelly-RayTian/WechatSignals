import React from "react";
import type { Analysis, Metric } from "../domain/types";
import { relationshipOutlook } from "../application/relationship-outlook";
export function RelationshipOutlook({
  analysis,
  onSelect,
}: {
  analysis: Analysis;
  onSelect: (metric: Metric, position: number) => void;
}) {
  const outlook = relationshipOutlook(analysis);
  const labels = {
    observed: "有当前行为依据",
    possible: "仅能条件讨论",
    unknown: "目前依据不足",
    blocked: "边界不支持推进",
  };
  return (
    <section className="relationship-outlook" aria-label="未来关系推断">
      <div className="panel-heading">
        <h3>未来关系推断</h3>
        <span className="pill">条件情景 · 非结局预测</span>
      </div>
      <section className="score-meaning">
        <h4>这个好感强度代表什么？</h4>
        <p>{outlook.scoreMeaning}</p>
        <p className="note">
          高强度描述表达有多明确；出现频率描述它是否常见。情绪投入和亲密程度不是浪漫程度，谈前任或向你吐槽别人也不等于喜欢你或不喜欢你。
        </p>
      </section>
      {outlook.lastObserved !== null && (
        <p className="note">
          依据截至 {new Date(outlook.lastObserved * 1000).toLocaleString()}{" "}
          的已分析聊天；不是对现在或未来的实时判断。
        </p>
      )}
      {!outlook.available ? (
        <p>暂无可追溯行为依据。请手动分析后再查看关系情景。</p>
      ) : (
        outlook.scenarios.map((s) => (
          <details
            className="outlook-scenario"
            key={s.id}
            open={s.basis === "observed" || s.basis === "blocked"}
          >
            <summary>
              <b>{s.title}</b>
              <span>{labels[s.basis]}</span>
            </summary>
            <p>{s.explanation}</p>
            <h4>如果未来出现这些变化</h4>
            <ul>
              {s.conditions.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <h4>反证与仍不能确定的部分</h4>
            <ul>
              {s.counterpoints.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <div className="outlook-evidence" aria-label={s.title + "依据"}>
              {s.evidence.slice(0, 6).map((e, i) => (
                <button key={i} onClick={() => onSelect(e.metric, e.position)}>
                  第{e.position + 1}段 · {e.label}
                </button>
              ))}
              {!s.evidence.length && (
                <small>尚未定位到足够的相关明确行为。</small>
              )}
            </div>
          </details>
        ))
      )}
      <details className="outlook-limits">
        <summary>依据与限制</summary>
        <ul>
          {outlook.cautions.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <p>
          使用已保存的官方 Jev
          行为判断，由本机固定模板组织；不新增调用，不生成发展概率，不修改原分数。
        </p>
      </details>
    </section>
  );
}
