// New authored cases for target attribution. Not independent labels, not live-tested.
import type { EvaluationCase } from "./corpus";
const a = (text: string) => ({ speaker: "Person A" as const, text });
const me = (text: string) => ({ speaker: "Me" as const, text });
export const attributionCases: EvaluationCase[] = [
  {
    id: "target-past-hurt",
    split: "development",
    category: "往事倾诉",
    messages: [
      a("我以前被一个很信任的朋友伤害过，想到就难受。"),
      me("愿意的话可以说说，我听着。"),
      a("谢谢你听我说，这件事我憋了很久。"),
    ],
    expected: {
      personal_sharing: ["clear", "strong"],
      romantic_hint: ["absent"],
      boundary: ["absent"],
    },
    reason: "分享自己的受伤经历，未表达对Me的浪漫意图或拒绝。",
  },
  {
    id: "target-angry-colleague",
    split: "development",
    category: "负面情绪对象",
    messages: [
      a("那个同事太混蛋了，又把我的功劳说成他的，我真的气死。"),
      me("听起来很委屈。"),
      a("就是他做得不对，和你没关系。"),
    ],
    expected: { boundary: ["absent"], romantic_hint: ["absent"] },
    reason: "愤怒明确指向同事，不是要求Me保持距离。",
  },
  {
    id: "target-quoted-insult",
    split: "development",
    category: "引用归属",
    messages: [
      a("前任当时对我说‘你滚，别再联系我’，我现在想起来还难受。"),
      me("那句话确实很伤人。"),
    ],
    expected: { boundary: ["absent"], personal_sharing: ["clear", "strong"] },
    reason: "拒绝话语是前任对Person A说的，并非Person A拒绝Me。",
  },
  {
    id: "target-miss-ex",
    split: "development",
    category: "浪漫对象",
    messages: [
      a("我还是想我的前男友，但不知道要不要再找他。"),
      me("你可以先想清楚自己需要什么。"),
    ],
    expected: {
      romantic_hint: ["absent"],
      personal_sharing: ["clear", "strong"],
    },
    reason: "想念对象是第三人，不是Me。",
  },
  {
    id: "target-real-boundary",
    split: "development",
    category: "真实边界",
    messages: [
      a("说清楚，我不想和你发展恋爱关系，请不要再对我说暧昧的话。"),
      me("明白了。"),
    ],
    expected: { boundary: ["clear", "strong"], romantic_hint: ["absent"] },
    reason: "明确向Me表达关系边界，不能被去负面规则忽略。",
  },
  {
    id: "target-both-directions",
    split: "development",
    category: "混合对象",
    messages: [
      a("我前任以前总是伤害我，但我现在说的是你：我喜欢你，想和你认真约会。"),
      me("谢谢你直接告诉我。"),
    ],
    expected: { romantic_hint: ["clear", "strong"], boundary: ["absent"] },
    reason: "不能只因提到前任便过滤整段；最后有明确指向Me的浪漫表达。",
  },
];
