import type { Analysis, Metric } from "../domain/types";
import { behaviorDefinitions } from "../infrastructure/jev-behaviors";
export type Scenario = {
  id: "friendship" | "explore" | "routine" | "distance";
  title: string;
  basis: "observed" | "possible" | "unknown" | "blocked";
  explanation: string;
  conditions: string[];
  counterpoints: string[];
  evidence: {
    position: number;
    metric: Metric;
    label: string;
    first: number;
  }[];
};
export function relationshipOutlook(a: Analysis) {
  const segments = a.segments ?? [];
  const available =
    segments.length > 0 &&
    segments.every((s) =>
      Object.keys(behaviorDefinitions).every((id) => s.result.behaviors?.[id]),
    );
  const cautions = [
    "这是条件情景，不是经验证的未来预测；没有发展概率、时间承诺或关系结局保证。",
    "倾诉过去受伤经历可以是个人分享，谈论第三人的爱恨不能当作对你的浪漫表达。",
  ];
  if (
    a.status === "partial" ||
    (a.totalBatches !== undefined && segments.length < a.totalBatches)
  )
    cautions.push("所选范围分析未完成，仅依据已成功分析的部分。");
  if (!available)
    return {
      available: false,
      version: "conditional-outlook-v1",
      scoreMeaning:
        "旧结果缺少完整行为判断，不能仅凭分数推断关系；请手动分析获得依据。",
      cautions,
      scenarios: [] as Scenario[],
      lastObserved: null as number | null,
    };
  const observed = (id: string) =>
    segments.flatMap((s, position) => {
      const o = s.result.behaviors![id];
      return ["clear", "strong"].includes(o.choice) &&
        o.confidence >= 0.6 &&
        o.stable !== false &&
        (o.probabilities.unclear ?? 0) < 0.5 &&
        (o.probabilities.clear ?? 0) + (o.probabilities.strong ?? 0) >= 0.5
        ? [
            {
              position,
              metric: (id === "romantic_hint" || id === "personal_compliment"
                ? "flirting"
                : id === "new_topic" || id === "follow_up"
                  ? "initiative"
                  : id === "personal_sharing" || id === "emotional_support"
                    ? "emotional_investment"
                    : id === "mutual_trust" || id === "shared_history"
                      ? "closeness"
                      : "romantic_interest") as Metric,
              label:
                behaviorDefinitions[id as keyof typeof behaviorDefinitions]
                  .label,
              first: s.first,
            },
          ]
        : [];
    });
  const romance = [
    ...observed("romantic_hint"),
    ...observed("personal_compliment"),
  ];
  const bond = [
    ...observed("personal_care"),
    ...observed("mutual_trust"),
    ...observed("shared_history"),
  ];
  const sharing = observed("personal_sharing");
  const plans = observed("shared_plans"),
    boundary = observed("boundary"),
    transaction = observed("transaction");
  const boundaryUnknown = segments.some((s) => {
    const o = s.result.behaviors!.boundary;
    return o.choice === "unclear" || o.stable === false || o.confidence < 0.6;
  });
  if (boundary.length)
    cautions.push("已观察到明确边界；不能以热情、倾诉或高分推定边界已撤回。");
  if (boundaryUnknown)
    cautions.push("部分关系边界无法可靠评价，不能据此支持关系升级。");
  if (a.rubricVersion && !a.rubricVersion.includes("v8"))
    cautions.push(
      "此结果使用旧版行为判据；本机情景不会重新识别第三人归属，需手动分析应用新版判据。",
    );
  const signal = a.metrics.romantic_interest.summary?.signal;
  const scoreMeaning =
    a.metrics.romantic_interest.quality === "insufficient"
      ? "正文无法评价，当前不能解释好感强度。"
      : romance.length
        ? `当前好感信号 ${a.metrics.romantic_interest.score}/100 是已识别表达的描述强度。定位到 ${new Set(romance.map((r) => r.position)).size} 段明确亲近或浪漫表达${signal ? `、${signal.episodes} 次独立浪漫交流` : ""}；${signal?.episodes === 1 ? "单次较强表达不能证明持续关系趋势。" : "需结合持续性、替代解释和双方明确意愿。"}`
        : `当前好感信号 ${a.metrics.romantic_interest.score}/100 主要需结合友好或歧义表达解读；不能仅凭分数推断喜欢。${sharing.length ? "有个人倾诉，但倾诉本身不证明浪漫意图。" : "未定位到可信的明确浪漫表达，不等于明确拒绝。"}`;
  const scenarios: Scenario[] = [
    {
      id: "friendship",
      title: "保持或加深朋友式亲近",
      basis: bond.length ? "observed" : sharing.length ? "possible" : "unknown",
      explanation: bond.length
        ? "已观察到具体关心、共享经历或双向信任，支持讨论朋友式亲近的情景。"
        : "分享经历可能是寻求理解，尚不能确认双向亲近。",
      conditions: [
        "若双方继续主动分享、回应彼此需要并尊重边界，可逐渐增加熟悉和信任。",
      ],
      counterpoints: [
        "朋友也会关心、安慰和倾诉，这些行为不自动指向恋爱。",
        ...(transaction.length ? ["部分热情存在事务性解释。"] : []),
      ],
      evidence: [...bond, ...sharing],
    },
    {
      id: "explore",
      title: "探索更亲近的关系",
      basis: boundary.length
        ? "blocked"
        : boundaryUnknown
          ? "unknown"
          : romance.length > 0 && (signal?.episodes ?? 0) > 1
            ? "observed"
            : romance.length
              ? "possible"
              : "unknown",
      explanation: boundary.length
        ? "已有明确边界，当前不支持据此推进浪漫关系。"
        : romance.length
          ? "已定位亲近或浪漫表达，可讨论后续双方进一步澄清意愿的情景，尚不能确定会成为恋人。"
          : "尚缺明确指向你的浪漫表达，不能由消息量、倾诉或单一高分推导关系升级。",
      conditions: [
        "只有后续双方明确、自愿表达意愿，且持续互动与具体安排相互一致，才有依据进一步探索。",
        "仍需区分委婉表达、普通友好、玩笑、引用和谈论第三人。",
      ],
      counterpoints: [
        "目前未测量双方真实意愿、线下关系与其他生活因素。",
        ...(transaction.length ? ["事务联系可能解释部分热情。"] : []),
        ...(romance.length && (signal?.episodes ?? 0) < 2
          ? ["明确表达尚未在多次独立交流中确认。"]
          : []),
      ],
      evidence: [...romance, ...plans, ...boundary],
    },
    {
      id: "routine",
      title: "保持普通或事务联系",
      basis: transaction.length ? "observed" : "unknown",
      explanation: transaction.length
        ? "已有具体事务交流，可将继续保持普通联系作为一种情景。"
        : "现有记录不能确定未来是否仅保持普通联系。",
      conditions: [
        "若后续仍主要围绕具体事务、没有新增个人或浪漫表达，可能继续保持目前的交流方式。",
      ],
      counterpoints: ["普通闲聊不能当作关系恶化，暂时没表达也不是拒绝。"],
      evidence: transaction,
    },
    {
      id: "distance",
      title: "保持距离或减少互动",
      basis: boundary.length
        ? "observed"
        : a.metrics.romantic_interest.summary?.trend === "falling"
          ? "possible"
          : "unknown",
      explanation: boundary.length
        ? "已有要求保持距离或不发展浪漫关系的边界，应以原文与发生时间为准。"
        : "没有足够依据确认正在疏远；分数变化也不能确定未来会断联。",
      conditions: [
        "若明确表达不愿继续或要求距离，应尊重对方选择。",
        "若只是忙碌、消息减少或回复变慢，仍需了解现实情境，不能直接推断拒绝。",
      ],
      counterpoints: [
        "缺失媒体、选取范围和事务变化可能影响观察，不能用它们替代对方明确意愿。",
      ],
      evidence: boundary,
    },
  ];
  return {
    available: true,
    version: "conditional-outlook-v1",
    scoreMeaning,
    cautions,
    scenarios,
    lastObserved: Math.max(...segments.map((s) => s.last)),
  };
}
