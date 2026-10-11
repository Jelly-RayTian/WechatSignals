import { test } from "node:test";
import assert from "node:assert/strict";
import {
  composeMetrics,
  behaviorDefinitions,
} from "../src/infrastructure/jev-behaviors";
import {
  aggregateSegments,
  repairSavedAggregate,
} from "../src/application/batches";
import type { AnalysisSegment, Analysis } from "../src/domain/types";
function observations(id?: string, choice = "clear", confidence = 0.9) {
  return Object.fromEntries(
    Object.keys(behaviorDefinitions).map((key) => [
      key,
      {
        choice: key === id ? choice : "absent",
        confidence: key === id ? confidence : 0.9,
        probabilities: Object.fromEntries(
          ["absent", "weak", "clear", "strong", "unclear"].map((k) => [
            k,
            k === (key === id ? choice : "absent") ? 1 : 0,
          ]),
        ),
      },
    ]),
  );
}
function segment(
  index: number,
  day: number,
  id?: string,
  choice = "clear",
  confidence = 0.9,
): AnalysisSegment {
  const behaviors = observations(id, choice, confidence);
  return {
    index,
    first: 100000 + day * 86400,
    last: 100060 + day * 86400,
    result: {
      id: String(index),
      conversationId: "synthetic",
      createdAt: 0,
      model: "jev-test",
      rubricVersion: "behavior-v7-event-signals",
      messageCount: 100,
      behaviors,
      metrics: composeMetrics(behaviors),
    },
  };
}
const aggregate = (segments: AnalysisSegment[]) =>
  aggregateSegments(
    "a",
    "synthetic",
    segments,
    segments.length,
    { until: 99999999, label: "Synthetic" },
    "complete",
  );
test("a clear romantic expression is not divided by absent compliments, care or plans", () => {
  const m = composeMetrics(observations("romantic_hint"));
  assert.ok(m.romantic_interest.score >= 70);
  assert.ok(m.flirting.score >= 70);
});
test("adding ordinary conversation leaves observed signal intensity intact while lowering frequency", () => {
  const clear = segment(0, 0, "romantic_hint");
  const single = aggregate([clear]);
  const mixed = aggregate([
    clear,
    ...Array.from({ length: 19 }, (_, i) => segment(i + 1, i + 1)),
  ]);
  assert.equal(
    mixed.metrics.romantic_interest.score,
    single.metrics.romantic_interest.score,
  );
  assert.equal(mixed.metrics.flirting.score, single.metrics.flirting.score);
  assert.equal(
    (mixed.metrics.romantic_interest.summary as any).signal.clearSegments,
    1,
  );
  assert.equal(
    (mixed.metrics.romantic_interest.summary as any).signal.ordinarySegments,
    19,
  );
  assert.equal(
    (mixed.metrics.romantic_interest.summary as any).signal.pattern,
    "isolated",
  );
});
test("adjacent fragments form one episode while separate sessions establish recurrence", () => {
  const first = segment(0, 0, "romantic_hint");
  const second = {
    ...segment(1, 0, "romantic_hint"),
    first: first.last + 100,
    last: first.last + 200,
  };
  const one = (aggregate([first, second]).metrics.flirting.summary as any)
    .signal;
  const repeated = (
    aggregate([first, second, segment(2, 2, "romantic_hint")]).metrics.flirting
      .summary as any
  ).signal;
  assert.equal(one.episodes, 1);
  assert.equal(one.pattern, "isolated");
  assert.equal(repeated.episodes, 2);
  assert.equal(repeated.pattern, "repeated");
});
test("ordinary friendly signals cannot become strong romantic or flirting evidence", () => {
  const a = aggregate([
    segment(0, 0, "personal_care", "strong"),
    segment(1, 1, "shared_plans", "strong"),
  ]);
  assert.ok(a.metrics.romantic_interest.score <= 40);
  assert.equal(a.metrics.flirting.score, 0);
});
test("uncertain or unstable romantic observations are not counted as clear episodes", () => {
  const uncertain = segment(0, 0, "romantic_hint", "clear", 0.3);
  const unstable = segment(1, 1, "romantic_hint");
  unstable.result.behaviors!.romantic_hint.stable = false;
  const m = aggregate([uncertain, unstable]).metrics.flirting;
  assert.equal((m.summary as any).signal.episodes, 0);
  assert.equal((m.summary as any).signal.pattern, "ambiguous");
  assert.ok(m.score <= 40);
});
test("a later explicit boundary is retained even when neutral and boundary segments are excluded from positive strength", () => {
  const m = aggregate([
    segment(0, 0, "romantic_hint", "strong"),
    segment(1, 1, "boundary"),
  ]).metrics.romantic_interest;
  assert.ok(m.score <= 25);
  assert.equal((m.summary as any).signal.boundarySegments, 1);
});
test("all ordinary input remains evaluable with zero signal and no fabricated recurrence", () => {
  const m = aggregate([segment(0, 0), segment(1, 1)]).metrics.flirting;
  assert.equal(m.score, 0);
  assert.notEqual(m.quality, "insufficient");
  assert.equal((m.summary as any).signal.pattern, "not_observed");
});
test("saved raw behavior observations can be re-summarized locally without mutating original records or analysis date", () => {
  const segments = [
    segment(0, 0, "romantic_hint"),
    ...Array.from({ length: 9 }, (_, i) => segment(i + 1, i + 1)),
  ];
  for (const s of segments) {
    s.result.rubricVersion = "behavior-v6-multimodal";
    s.result.metrics.romantic_interest.score = s.index === 0 ? 23 : 0;
  }
  const a: Analysis = {
    ...aggregate(segments),
    rubricVersion: "behavior-v6-multimodal",
    aggregationVersion: "reviewable-median-v2",
    createdAt: 123,
  };
  const before = JSON.stringify(a);
  const fixed = repairSavedAggregate(a);
  assert.ok(fixed.metrics.romantic_interest.score >= 70);
  assert.equal(fixed.createdAt, 123);
  assert.equal(JSON.stringify(a), before);
  assert.equal(fixed.aggregationVersion, "event-strength-v3");
});
test("a later ordinary period cannot manufacture a falling romantic trend", () => {
  const a = aggregate([
    segment(0, 0, "romantic_hint"),
    segment(1, 1, "romantic_hint"),
    ...Array.from({ length: 7 }, (_, i) => segment(i + 2, i + 2)),
  ]);
  assert.equal(a.metrics.romantic_interest.summary!.recentScore, null);
  assert.equal(a.metrics.romantic_interest.summary!.trend, "insufficient");
});
test("confirmed care cannot promote a low confidence romantic hint into a strong episode", () => {
  const s = segment(0, 0, "personal_care", "strong");
  s.result.behaviors!.romantic_hint = observations(
    "romantic_hint",
    "clear",
    0.3,
  ).romantic_hint;
  s.result.metrics = composeMetrics(s.result.behaviors!);
  assert.ok(aggregate([s]).metrics.romantic_interest.score <= 40);
});
test("event report distinguishes intensity, frequency, recurrence and local historical recalculation", async () => {
  const React = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { MetricReport } = await import("../src/ui/report");
  const a = aggregate([segment(0, 0, "romantic_hint"), segment(1, 1)]);
  a.rubricVersion = "behavior-v6-multimodal";
  const html = renderToStaticMarkup(
    React.createElement(MetricReport, { view: { analysis: a } as any }),
  );
  for (const label of [
    "观察到的信号强度",
    "片段出现频率",
    "孤立信号",
    "1 次独立浪漫交流",
    "没有重新请求 Jev",
  ])
    assert.ok(html.includes(label), label);
});
test("frequent ordinary care cannot dilute a clear romantic expression either", () => {
  const a = aggregate([
    segment(0, 0, "romantic_hint"),
    ...Array.from({ length: 19 }, (_, i) =>
      segment(i + 1, i + 1, "personal_care"),
    ),
  ]);
  assert.ok(a.metrics.romantic_interest.score >= 70);
  assert.equal(a.metrics.romantic_interest.summary!.signal!.episodes, 1);
});
test("ordinary chatter does not erase a weak signal, which remains explicitly ambiguous", () => {
  const weak = segment(0, 0, "romantic_hint", "weak");
  const one = aggregate([weak]).metrics.flirting;
  const many = aggregate([
    weak,
    ...Array.from({ length: 19 }, (_, i) => segment(i + 1, i + 1)),
  ]).metrics.flirting;
  assert.equal(many.score, one.score);
  assert.ok(many.score > 0 && many.score <= 40);
  assert.equal(many.summary!.signal!.pattern, "ambiguous");
  assert.equal(many.summary!.signal!.episodes, 0);
});
test("unreadable input is shown as unavailable, never as a zero-strength observation", async () => {
  const s = segment(0, 0);
  for (const o of Object.values(s.result.behaviors!)) {
    o.choice = "unclear";
    o.probabilities = { absent: 0, weak: 0, clear: 0, strong: 0, unclear: 1 };
  }
  s.result.metrics = composeMetrics(s.result.behaviors!);
  const React = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { MetricReport } = await import("../src/ui/report");
  const html = renderToStaticMarkup(
    React.createElement(MetricReport, {
      view: { analysis: aggregate([s]) } as any,
    }),
  );
  assert.ok(!html.includes("<b>0/100</b>"));
});
