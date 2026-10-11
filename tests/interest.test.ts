import { test } from "node:test";
import assert from "node:assert/strict";
import {
  composeMetrics,
  behaviorDefinitions,
} from "../src/infrastructure/jev-behaviors";
const row = (choice: string) => ({
  choice,
  confidence: 0.9,
  probabilities: Object.fromEntries(
    ["absent", "weak", "clear", "strong", "unclear"].map((k) => [
      k,
      k === choice ? 1 : 0,
    ]),
  ),
});
function sample() {
  return Object.fromEntries(
    Object.keys(behaviorDefinitions).map((k) => [k, row("absent")]),
  );
}
test("warm friendship alone stays below strong romantic signal", () => {
  const o = sample();
  o.personal_care = row("strong");
  o.shared_plans = row("strong");
  assert.ok(composeMetrics(o).romantic_interest.score <= 40);
});
test("direct romantic expression contributes even without care or plans", () => {
  const o = sample();
  o.romantic_hint = row("strong");
  o.personal_compliment = row("clear");
  assert.ok(composeMetrics(o).romantic_interest.score >= 50);
});
test("unclear romantic meaning preserves friendly observations but marks review", () => {
  const o = sample();
  o.personal_care = row("strong");
  o.shared_plans = row("strong");
  o.romantic_hint = row("unclear");
  o.personal_compliment = row("unclear");
  const r = composeMetrics(o).romantic_interest;
  assert.ok(r.score <= 40);
  assert.equal(r.quality, "limited");
});
test("transaction explanation constrains romantic reading more than ordinary friendship", () => {
  const o = sample();
  for (const k of [
    "personal_care",
    "shared_plans",
    "romantic_hint",
    "personal_compliment",
  ])
    o[k] = row("strong");
  o.transaction = row("clear");
  assert.ok(composeMetrics(o).romantic_interest.score <= 35);
});

test("report leads with interest overview and shows historical limits", async () => {
  const React = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { MetricReport } = await import("../src/ui/report");
  const metrics = Object.fromEntries(
    [
      "romantic_interest",
      "initiative",
      "emotional_investment",
      "closeness",
      "flirting",
    ].map((k) => [k, { score: 42, confidence: null, quality: "limited" }]),
  );
  const html = renderToStaticMarkup(
    React.createElement(MetricReport, {
      view: {
        analysis: {
          id: "test",
          rubricVersion: "behavior-v3-evidence",
          metrics,
          messageCount: 20,
        },
      } as any,
    }),
  );
  assert.ok(html.includes("好感信号概览"));
  assert.ok(html.includes("旧版结果，请手动分析获得分层评价"));
  assert.ok(!html.includes("喜欢你的概率"));
});
