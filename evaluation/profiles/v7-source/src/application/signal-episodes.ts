import type { AnalysisSegment, Metric, MetricResult } from "../domain/types";
import {
  behaviorDefinitions,
  type BehaviorObservation,
} from "../infrastructure/jev-behaviors";

export function hasBehaviorObservations(rows: AnalysisSegment[]) {
  return (
    rows.length > 0 &&
    rows.every(
      (s) =>
        /^behavior-v[4567](?:-|$)/.test(s.result.rubricVersion ?? "") &&
        Object.keys(behaviorDefinitions).every(
          (id) => s.result.behaviors?.[id],
        ),
    )
  );
}
const confirmed = (o?: BehaviorObservation) =>
  !!o &&
  (o.choice === "clear" || o.choice === "strong") &&
  o.confidence >= 0.6 &&
  o.stable !== false &&
  (o.probabilities.unclear ?? 0) < 0.5 &&
  (o.probabilities.clear ?? 0) + (o.probabilities.strong ?? 0) >= 0.5;

export function signalEpisodes(
  rows: AnalysisSegment[],
  metric: Metric,
  baselineMedian: number,
) {
  // Friendly care is retained separately, so it neither proves nor dilutes romance.
  const ids = ["personal_compliment", "romantic_hint"];
  const ordered = [...rows].sort(
    (a, b) => a.first - b.first || a.index - b.index,
  );
  const usable = ordered.filter(
    (s) => s.result.metrics[metric].quality !== "insufficient",
  );
  const positives = usable.filter((s) =>
    ids.some((id) => confirmed(s.result.behaviors?.[id])),
  );
  const friendly =
    metric === "romantic_interest"
      ? usable.filter(
          (s) =>
            !positives.includes(s) &&
            ["personal_care", "shared_plans"].some((id) =>
              confirmed(s.result.behaviors?.[id]),
            ),
        )
      : [];
  const ambiguous = usable.filter(
    (s) =>
      !positives.includes(s) &&
      ids.some((id) => {
        const o = s.result.behaviors?.[id];
        return o && ["weak", "clear", "strong"].includes(o.choice);
      }),
  );
  const boundaries = ordered.filter((s) =>
    confirmed(s.result.behaviors?.boundary),
  );
  const episodes: { last: number; score: number }[] = [];
  for (const s of positives) {
    const strength = s.result.metrics[metric].score;
    const previous = episodes.at(-1);
    if (previous && s.first - previous.last < 21600) {
      previous.score = Math.max(previous.score, strength);
      previous.last = Math.max(previous.last, s.last);
    } else episodes.push({ last: s.last, score: strength });
  }
  const peaks = episodes.map((e) => e.score).sort((a, b) => a - b);
  const middle = Math.floor(peaks.length / 2);
  const fallback = (ambiguous.length ? ambiguous : friendly)
    .map((s) => s.result.metrics[metric].score)
    .sort((a, b) => a - b);
  const fallbackMiddle = Math.floor(fallback.length / 2);
  const fallbackMedian = fallback.length
    ? fallback.length % 2
      ? fallback[fallbackMiddle]
      : (fallback[fallbackMiddle - 1] + fallback[fallbackMiddle]) / 2
    : baselineMedian;
  let score = peaks.length
    ? peaks.length % 2
      ? peaks[middle]
      : (peaks[middle - 1] + peaks[middle]) / 2
    : Math.min(40, fallbackMedian);
  const reasons: string[] = [];
  if (episodes.length === 1)
    reasons.push("只在一次交流中观察到明确信号，不能推断持续关系趋势");
  if (ambiguous.length)
    reasons.push("部分亲近表达存在歧义或需复核，未计为明确信号事件");
  if (boundaries.length) {
    reasons.push("存在明确关系边界，请结合时间顺序查看反证");
    if (boundaries.at(-1)!.last >= (positives.at(-1)?.last ?? 0))
      score = Math.min(score, 25);
  }
  const signal: NonNullable<NonNullable<MetricResult["summary"]>["signal"]> = {
    clearSegments: positives.length,
    friendlySegments: friendly.length,
    ambiguousSegments: ambiguous.length,
    ordinarySegments: usable.length - positives.length - ambiguous.length,
    boundarySegments: boundaries.length,
    episodes: episodes.length,
    pattern:
      episodes.length > 1
        ? "repeated"
        : episodes.length
          ? "isolated"
          : ambiguous.length
            ? "ambiguous"
            : friendly.length
              ? "friendly_only"
              : "not_observed",
    baselineMedian,
  };
  return { score: Math.round(score), signal, reasons };
}
