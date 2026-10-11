import type { EvaluationCase } from "./corpus";
const a = (text: string) => ({ speaker: "Person A" as const, text }),
  me = (text: string) => ({ speaker: "Me" as const, text });
// Development examples authored in-house, exposed to implementation; never call these independent holdout.
export const dialogueCases: EvaluationCase[] = [
  {
    id: "dialogue-invite-accept",
    split: "development",
    category: "双向邀请",
    messages: [me("周六一起去看展吗？"), a("好呀，下午两点我来买票。")],
    expected: { interaction_invitation: ["mutual"] },
    reason: "具体邀请得到实际承接，不单凭谢谢。",
  },
  {
    id: "dialogue-invite-alternative",
    split: "development",
    category: "双向邀请",
    messages: [
      a("周六一起看展吗？"),
      me("周六加班，周日可以，我订票。"),
      a("那周日见。"),
    ],
    expected: { interaction_invitation: ["mutual"] },
    reason: "替代安排不能简单视为拒绝。",
  },
  {
    id: "dialogue-invite-unanswered",
    split: "development",
    category: "单方邀请",
    messages: [me("周六一起看展吗？"), a("[语音缺失或未转写；内容未知]")],
    expected: { interaction_invitation: ["unclear"] },
    reason: "缺失回应不可推断同意或拒绝。",
  },
  {
    id: "dialogue-invite-decline",
    split: "development",
    category: "明确拒绝",
    messages: [
      a("今晚一起吃饭吧？"),
      me("我不想单独和你出去，请不要再约我了。"),
    ],
    expected: { interaction_invitation: ["declined"] },
    reason: "明确针对本次双方邀请。",
  },
  {
    id: "dialogue-invite-thirdparty",
    split: "development",
    category: "第三方引用",
    messages: [a("以前我约前任，他总说不想见我。"), me("听着挺难受的。")],
    expected: {
      interaction_invitation: ["not_observed"],
      boundary: ["absent"],
    },
    reason: "往事中第三人的拒绝不是当前双方邀请。",
  },
  {
    id: "dialogue-support-mutual",
    split: "development",
    category: "双向支持",
    messages: [
      me("面试没过，很失落。"),
      a("准备这么久真的不容易，我陪你复盘。"),
      a("我也在担心明天答辩。"),
      me("你之前讲得很清楚，今晚我陪你练一遍。"),
    ],
    expected: { interaction_support: ["mutual"] },
    reason: "双方各自情绪得到针对回应。",
  },
  {
    id: "dialogue-support-vent",
    split: "development",
    category: "单向倾诉",
    messages: [
      a("同事骂了我，难受得睡不着。"),
      me("听起来你被伤害了，要不要聊聊？"),
      a("谢谢你听我说。"),
    ],
    expected: { interaction_support: ["one_sided_me"], boundary: ["absent"] },
    reason: "感谢倾听不是对Me情绪的反向支持。",
  },
  {
    id: "dialogue-support-transaction",
    split: "development",
    category: "事务帮助",
    messages: [me("报告文件呢？"), a("发邮箱了。"), me("收到谢谢。")],
    expected: {
      interaction_support: ["not_observed"],
      interaction_affection: ["not_observed"],
    },
    reason: "事务协作不等于情绪支持或亲近表达。",
  },
  {
    id: "dialogue-affection-mutual",
    split: "development",
    category: "双向亲近",
    messages: [
      a("不是朋友那种喜欢，我想和你约会。"),
      me("我也是，我想认真和你试试。"),
    ],
    expected: {
      interaction_affection: ["mutual"],
      romantic_hint: ["clear", "strong"],
    },
    reason: "双方明确指向彼此的浪漫表达。",
  },
  {
    id: "dialogue-affection-polite",
    split: "development",
    category: "单方亲近",
    messages: [me("我喜欢你，想和你约会。"), a("谢谢你告诉我，我需要想想。")],
    expected: { interaction_affection: ["one_sided_me", "unclear"] },
    reason: "礼貌接受信息不等于认可或明确拒绝。",
  },
  {
    id: "dialogue-affection-ex",
    split: "development",
    category: "过去关系",
    messages: [a("前任以前说想我，我当时也说想他。"), me("那是以前的经历。")],
    expected: {
      interaction_affection: ["not_observed"],
      romantic_hint: ["absent"],
    },
    reason: "往事不能转移到双方。",
  },
  {
    id: "dialogue-affection-ocr",
    split: "development",
    category: "图片引文",
    messages: [
      a("[图片OCR；属于图片内文字，不是发送者陈述] 我爱你"),
      me("这是电影海报吧？"),
      a("对，新上映的电影。"),
    ],
    expected: {
      interaction_affection: ["not_observed"],
      romantic_hint: ["absent"],
    },
    reason: "海报文字不等于发送者表白。",
  },
];
