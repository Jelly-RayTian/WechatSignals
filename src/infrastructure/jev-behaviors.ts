import {
  metricLabels,
  type Metric,
  type MetricResult,
  type Analysis,
} from "../domain/types";
export const behaviorVersion = "behavior-v9-dialogue-context";
export const behaviorDefinitions = {
  personal_care: {
    label: "具体关心",
    condition:
      "Person A 主动关心 Me 的具体经历、状态或需要。普通你好/谢谢、索取帮助和仅 Me 的关心不算。",
  },
  shared_plans: {
    label: "共同活动安排",
    condition:
      "Person A 向 Me 提出或落实双方共同活动的具体安排。仅回答 Me 的邀约、工作交接、取货还书、课程组队和假设性玩笑不算主动安排；有具体私人活动内容才计入。",
  },
  new_topic: {
    label: "主动提出内容",
    condition:
      "Person A 自主提出新话题或新的个人信息，推动对话。只回答 Me 的问题或事务催办不算。",
  },
  follow_up: {
    label: "深入追问",
    condition:
      "Person A 针对 Me 的内容提出具体追问或主动延续话题。礼貌嗯/哈哈和重复原问题不算。",
  },
  emotional_support: {
    label: "针对性情绪支持",
    condition:
      "Person A 理解并回应 Me 的具体感受，提供安慰、支持或询问情绪需要。只倾诉自己的问题、套话和事务帮忙不算。",
  },
  personal_sharing: {
    label: "个人情绪分享",
    condition:
      "Person A 向Me分享自己的感受、受伤经历或心事，包括谈过去人际关系。可算个人分享，但不自动是浪漫或双向信任。单纯转述他人或长消息不算。",
  },
  shared_history: {
    label: "双方共享经历",
    condition:
      "双方在正文中共同认可具体共享经历、熟悉的默契或内部玩笑。单方声称很熟和客套称呼不算。",
  },
  mutual_trust: {
    label: "双向信任表达",
    condition:
      "双方都有回应的私人分享、信任或接纳表达。只有 Me 自述亲密、对方不回应不算双向信任。",
  },
  personal_compliment: {
    label: "个人化亲近赞美",
    condition:
      "Person A 对 Me 有指向个人特质或吸引力的亲近赞美，且上下文支持亲近含义。工作成果夸奖、服务客套和普通感谢不算；外貌夸赞也可能是友好，不自动等于浪漫。",
  },
  romantic_hint: {
    label: "明确调情或浪漫暗示",
    condition:
      "Person A 表达指向 Me、语境明确的调情或浪漫暗示。谈前任或第三人的喜欢/想念、引用、否定、反讽不算；倾诉受伤、寻求安慰不自动算对Me好感。必须确定表达对象。",
  },
  boundary: {
    label: "明确拒绝或边界",
    condition:
      "Person A 明确向 Me 拒绝发展关系、要求停止调情或保持距离。骂第三人、抱怨往事、复述别人辱骂不算对Me拒绝；泛化愤怒或某次没空不算。对象不明选weak或unclear。",
  },
  transaction: {
    label: "事务性替代解释",
    condition:
      "当前交流主要围绕工作、课程、买卖或索取帮助，可以解释表面上的热情。仅提到工作不代表整段都是事务。",
  },
} as const;
export const behaviorCriteria = {
  absent:
    "可读正文未观察到或否定本题行为；礼貌、引用、反讽、仅Me表达不算。未出现不等于正文不足。",
  weak: "有一个孤立、间接或有歧义的相关表达，仍容易有普通友好或事务解释。",
  clear:
    "至少一个具体、语境明确的行为即可，委婉表达也可。无关日常句子不降低等级。",
  strong:
    "不同内容反复出现明确一致行为，不要求每句都表达；不按消息长度数量判定。",
  unclear:
    "正文确实无法评价：关键内容缺失、不可读或无法确定含义。不能仅因没有正面信号选择本项。",
} as const;
export type BehaviorObservation = NonNullable<Analysis["behaviors"]>[string];
const mapping: Record<Metric, string[]> = {
  romantic_interest: [
    "personal_care",
    "shared_plans",
    "personal_compliment",
    "romantic_hint",
  ],
  initiative: ["new_topic", "follow_up"],
  emotional_investment: ["emotional_support", "personal_sharing"],
  closeness: ["shared_history", "mutual_trust"],
  flirting: ["personal_compliment", "romantic_hint"],
};
const weights: Record<string, number> = {
  absent: 0,
  weak: 25,
  clear: 75,
  strong: 100,
};
function index(o: BehaviorObservation) {
  const known = Object.keys(weights).reduce(
    (n, key) => n + (o.probabilities[key] ?? 0),
    0,
  );
  return known <= 0
    ? 0
    : Object.entries(weights).reduce(
        (n, [k, w]) => n + w * (o.probabilities[k] ?? 0),
        0,
      ) / known;
}
export function composeMetrics(
  observations: Record<string, BehaviorObservation>,
): Record<Metric, MetricResult> {
  const metrics = {} as Record<Metric, MetricResult>;
  for (const metric of Object.keys(metricLabels) as Metric[]) {
    const ids = mapping[metric],
      rows = ids.map((id) => observations[id]);
    if (rows.some((o) => !o)) throw new Error("缺少行为判断");
    const valid = rows.filter(
      (o) => o.choice !== "unclear" && (o.probabilities.unclear ?? 0) < 0.5,
    );
    const reasons: string[] = [];
    if (valid.length < rows.length) reasons.push("部分行为正文无法评价");
    if (valid.some((o) => o.confidence < 0.6))
      reasons.push("行为等级 confidence 偏低，评分供复核");
    if (rows.some((o) => o.stable === false))
      reasons.push("选项换序复核存在差异");
    let score = valid.length
      ? valid.reduce((n, o) => n + index(o), 0) / valid.length
      : 0;
    if (metric === "romantic_interest") {
      const usable = (o: BehaviorObservation) =>
        o.choice !== "unclear" && (o.probabilities.unclear ?? 0) < 0.5;
      const group = (items: BehaviorObservation[]) => {
        const known = items.filter(usable);
        return known.length
          ? known.reduce((n, o) => n + index(o), 0) / known.length
          : 0;
      };
      // A concrete romantic expression need not co-occur with every other behavior.
      // Compliments retain a discount because they can also reflect friendship.
      score = Math.max(
        0.4 * group(rows.slice(0, 2)) + 0.6 * group(rows.slice(2)),
        ...rows
          .slice(2)
          .filter(usable)
          .map((o) => index(o) * (o === rows[2] ? 0.8 : 1)),
      );
      if (rows.slice(2).every((o) => !usable(o) || o.choice === "absent")) {
        score = Math.min(score, 40);
        reasons.push("未观察到明确浪漫指向；关心和共同活动也可能是普通友好");
      }
      if (
        rows.slice(2).some((o) => o.choice === "weak") &&
        !rows
          .slice(2)
          .some((o) => o.choice === "clear" || o.choice === "strong")
      ) {
        score = Math.min(score, 60);
        reasons.push("亲近含义有歧义，需结合上下文复核");
      }
    }
    if (metric === "flirting") {
      score = Math.max(
        0,
        ...rows.map((o, i) =>
          valid.includes(o) ? index(o) * (i === 0 ? 0.8 : 1) : 0,
        ),
      );
    }
    // Transparent descriptive rules, not calibrated psychological estimates.
    if (metric === "romantic_interest" || metric === "flirting") {
      const b = observations.boundary,
        t = observations.transaction;
      if (b?.choice === "clear" || b?.choice === "strong") {
        score = Math.min(score, 25);
        reasons.push("有明确关系边界，限制好感/暧昧解读");
      }
      if (t?.choice === "clear" || t?.choice === "strong") {
        score = Math.min(score, metric === "romantic_interest" ? 35 : 50);
        reasons.push("事务性交流可解释部分信号");
      }
      if ([b, t].some((o) => o?.choice === "unclear" || o?.stable === false))
        reasons.push("反证行为存在歧义");
    }
    metrics[metric] = {
      score: Math.round(score),
      confidence: null,
      quality: !valid.length
        ? "insufficient"
        : reasons.length
          ? "limited"
          : "sufficient",
      reviewReasons: reasons,
      composition: ids,
    };
  }
  return metrics;
}
