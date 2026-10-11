export const interactionDefinitions = {
  invitation: {
    label: "邀请与回应",
    condition:
      "双方对具体私人共同活动邀请的表达与回应；区分接受、提出替代安排、明确拒绝、未回应和纯事务；未回应不自动等于拒绝。",
  },
  support: {
    label: "情绪支持互动",
    condition:
      "双方针对彼此具体情绪的回应支持；倾诉自己的问题不等于支持对方，感谢一句不自动证明双向支持。",
  },
  affection: {
    label: "亲近表达互动",
    condition:
      "双方指向彼此的个人化亲近或浪漫表达与承接；礼貌应答、第三方往事、引用及孤立表情不等于互相表达。",
  },
} as const;
export const interactionCriteria = {
  mutual: "双方都有明确表达或具体承接；不因此推断恋人关系",
  one_sided_me: "仅 Me 明确表达，对方没有明确承接；不把沉默解释成拒绝",
  one_sided_other: "仅 Person A 明确表达，Me 没有明确承接",
  declined: "明确拒绝这次互动或明确要求保持边界，针对当前双方而非第三方",
  not_observed: "没有观察到本题互动；普通日常聊天不算负面",
  unclear: "对象、回应、转写或上下文不明，无法可靠判断",
} as const;
export const interactionLabels: Record<string, string> = {
  mutual: "双方明确承接",
  one_sided_me: "仅我方明确表达",
  one_sided_other: "仅对方明确表达",
  declined: "明确拒绝 / 边界",
  not_observed: "未观察到此类互动",
  unclear: "无法判断",
};
