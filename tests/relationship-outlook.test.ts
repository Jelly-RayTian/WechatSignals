import { test } from "node:test";
import assert from "node:assert/strict";
import { relationshipOutlook } from "../src/application/relationship-outlook";
import {
  composeMetrics,
  behaviorDefinitions,
} from "../src/infrastructure/jev-behaviors";
import { aggregateSegments } from "../src/application/batches";
import type { Analysis, AnalysisSegment } from "../src/domain/types";
function segment(i: number, flags: string[] = []): AnalysisSegment {
  const behaviors = Object.fromEntries(
    Object.keys(behaviorDefinitions).map((id) => [
      id,
      {
        choice: flags.includes(id) ? "clear" : "absent",
        confidence: 0.9,
        probabilities: {
          absent: flags.includes(id) ? 0 : 1,
          weak: 0,
          clear: flags.includes(id) ? 1 : 0,
          strong: 0,
          unclear: 0,
        },
      },
    ]),
  );
  return {
    index: i,
    first: 100000 + i * 86400,
    last: 100060 + i * 86400,
    result: {
      id: String(i),
      conversationId: "synthetic",
      model: "jev-test",
      createdAt: 0,
      messageCount: 10,
      rubricVersion: "behavior-v7-event-signals",
      behaviors,
      metrics: composeMetrics(behaviors),
    },
  };
}
const analysis = (rows: AnalysisSegment[]) =>
  aggregateSegments(
    "a",
    "synthetic",
    rows,
    rows.length,
    { until: 999999, label: "合成范围" },
    "complete",
  );
test("high scores alone cannot create a future romance judgment", () => {
  const a = analysis([segment(0)]);
  a.metrics.romantic_interest.score = 100;
  const r = relationshipOutlook(a);
  assert.equal(r.scenarios.find((s) => s.id === "explore")!.basis, "unknown");
  assert.ok(r.scoreMeaning.includes("不能仅凭分数"));
});
test("a later boundary blocks romantic escalation even after clear expression", () => {
  const r = relationshipOutlook(
    analysis([
      segment(0, ["romantic_hint", "shared_plans"]),
      segment(1, ["boundary"]),
    ]),
  );
  assert.equal(r.scenarios.find((s) => s.id === "explore")!.basis, "blocked");
  assert.equal(r.scenarios.find((s) => s.id === "distance")!.basis, "observed");
  assert.ok(r.cautions.some((c) => c.includes("边界")));
});
test("repeated expressions yield a conditional scenario rather than a probability or outcome promise", () => {
  const r = relationshipOutlook(
    analysis([
      segment(0, ["romantic_hint", "shared_plans"]),
      segment(1, ["romantic_hint", "personal_care"]),
    ]),
  );
  const s = r.scenarios.find((s) => s.id === "explore")!;
  assert.equal(s.basis, "observed");
  assert.ok(s.conditions.length);
  assert.ok(s.counterpoints.length);
  assert.ok(s.evidence.length >= 2);
  assert.ok(!JSON.stringify(r).includes("probability"));
});
test("friendly care and trust never automatically establish romance", () => {
  const r = relationshipOutlook(
    analysis([
      segment(0, ["personal_care", "mutual_trust"]),
      segment(1, ["personal_sharing"]),
    ]),
  );
  assert.equal(
    r.scenarios.find((s) => s.id === "friendship")!.basis,
    "observed",
  );
  assert.equal(r.scenarios.find((s) => s.id === "explore")!.basis, "unknown");
});
test("incomplete coverage and unassessed boundaries remain visible limitations", () => {
  const a = analysis([segment(0, ["romantic_hint"])]);
  a.status = "partial";
  a.segments![0].result.behaviors!.boundary.choice = "unclear";
  const r = relationshipOutlook(a);
  assert.ok(r.cautions.some((c) => c.includes("未完成")));
  assert.ok(r.cautions.some((c) => c.includes("边界无法可靠评价")));
  assert.notEqual(
    r.scenarios.find((s) => s.id === "explore")!.basis,
    "observed",
  );
});
test("missing raw behaviors do not manufacture scenario evidence", () => {
  const a = analysis([segment(0)]);
  a.segments![0].result.behaviors = undefined;
  const r = relationshipOutlook(a);
  assert.equal(r.available, false);
  assert.equal(r.scenarios.length, 0);
});
test("scenario derivation is deterministic and leaves saved scores unchanged", () => {
  const a = analysis([segment(0, ["romantic_hint"])]);
  const before = JSON.stringify(a);
  assert.deepEqual(relationshipOutlook(a), relationshipOutlook(a));
  assert.equal(JSON.stringify(a), before);
});
test("report opens with all five dimensions and provides a relationship scenarios tab", async () => {
  const React = await import("react"),
    { renderToStaticMarkup } = await import("react-dom/server"),
    { MetricReport } = await import("../src/ui/report");
  const html = renderToStaticMarkup(
    React.createElement(MetricReport, {
      view: { analysis: analysis([segment(0, ["personal_sharing"])]) } as any,
    }),
  );
  assert.ok(html.includes("全部五项评价"));
  assert.ok(html.includes("关系走向"));
  assert.ok(html.includes("倾诉"));
  for (const label of [
    "好感信号",
    "主动程度",
    "情绪投入",
    "亲密程度",
    "暧昧信号",
  ])
    assert.ok(html.includes(`查看${label}依据`));
});
test("prompt distinguishes the addressee from a former partner and keeps payload within budget", async () => {
  const { buildRequest } = await import("../src/infrastructure/jev");
  const request = buildRequest(
    JSON.stringify({
      context: [],
      messages: Array.from({ length: 200 }, () => ({
        speaker: "Person A",
        text: "合成文字",
      })),
    }),
    "jev-latest",
    true,
  );
  assert.ok(request.questions.romantic_hint.instructions.includes("第三人"));
  assert.ok(request.questions.personal_sharing.instructions.includes("经历"));
  assert.ok(Buffer.byteLength(JSON.stringify(request)) < 64000);
});
test("third-party hostility is excluded without disabling genuine rejection", async () => {
  const { buildRequest } = await import("../src/infrastructure/jev");
  const q = buildRequest('{"context":[],"messages":[]}').questions;
  assert.ok(q.boundary.instructions.includes("骂第三人"));
  assert.ok(q.boundary.instructions.includes("明确向 Me"));
  const { attributionCases } = await import("../evaluation/attribution-corpus");
  assert.equal(attributionCases.length, 6);
  assert.ok(
    attributionCases.some((c) => c.expected.boundary?.includes("clear")),
  );
  assert.ok(
    attributionCases.some(
      (c) =>
        c.id === "target-both-directions" &&
        c.expected.romantic_hint.includes("clear"),
    ),
  );
});
test("target attribution revision leaves score composition unchanged", async () => {
  const { readFile } = await import("node:fs/promises");
  const old = await readFile(
    new URL(
      "../evaluation/profiles/v7-source/src/infrastructure/jev-behaviors.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const now = await readFile(
    new URL("../src/infrastructure/jev-behaviors.ts", import.meta.url),
    "utf8",
  );
  assert.equal(
    now.slice(now.indexOf("export function composeMetrics")),
    old.slice(old.indexOf("export function composeMetrics")),
  );
});
