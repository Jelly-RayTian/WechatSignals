import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluationCases } from "../evaluation/corpus";
import { evaluatePredictions } from "../evaluation/scoring";
import {
  behaviorDefinitions,
  behaviorCriteria,
} from "../src/infrastructure/jev-behaviors";
test("evaluation corpus keeps holdout separate with explicit behavioral labels and no private identities", () => {
  assert.equal(evaluationCases.length, 30);
  assert.equal(evaluationCases.filter((c) => c.split === "holdout").length, 12);
  assert.equal(new Set(evaluationCases.map((c) => c.id)).size, 30);
  for (const c of evaluationCases) {
    assert.ok(c.reason);
    for (const [id, labels] of Object.entries(c.expected)) {
      assert.ok(id in behaviorDefinitions);
      for (const l of labels) assert.ok(l in behaviorCriteria);
    }
    assert.ok(c.messages.every((m) => ["Me", "Person A"].includes(m.speaker)));
  }
});
test("scorer reports semantic mistakes, omitted calls and option instability rather than mock accuracy", () => {
  const cases = evaluationCases.slice(0, 3);
  const preds = cases.slice(0, 2).map((c) => ({
    id: c.id,
    behaviors: Object.fromEntries(
      Object.keys(c.expected).map((id) => [
        id,
        { choice: "absent", checkChoice: "clear" },
      ]),
    ),
  }));
  const score = evaluatePredictions(cases, preds);
  assert.equal(score.failedCases, 1);
  assert.equal(score.correct, 0);
  assert.ok(score.missed > 0);
  assert.equal(score.orderStability, 0);
});

test("human behavior correction persists locally without changing original analysis", async () => {
  const { SqliteRepository } = await import("../src/infrastructure/sqlite");
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { metricLabels } = await import("../src/domain/types");
  const dir = await mkdtemp(join(tmpdir(), "jev-label-"));
  const path = join(dir, "test.sqlite");
  let repo = await SqliteRepository.open(path);
  const analysis: any = {
    id: "test-a",
    conversationId: "p",
    createdAt: 1,
    model: "jev-test",
    messageCount: 2,
    rubricVersion: "behavior-v4-observations",
    metrics: Object.fromEntries(
      Object.keys(metricLabels).map((k) => [
        k,
        { score: 75, confidence: null },
      ]),
    ),
    behaviors: {
      personal_care: {
        choice: "clear",
        confidence: 0.8,
        probabilities: { clear: 1 },
      },
    },
  };
  try {
    repo.save(analysis);
    repo.labelBehavior("test-a", 0, "personal_care", "absent");
    assert.equal(repo.behaviorLabelCount(), 1);
    assert.equal(repo.latest("p")?.behaviors?.personal_care.choice, "clear");
    assert.throws(() => repo.labelBehavior("test-a", 0, "invented", "absent"));
    repo.close();
    repo = await SqliteRepository.open(path);
    assert.equal(repo.behaviorLabelCount(), 1);
  } finally {
    repo.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("behavior report renders actual behavior confidence and local corrections without a fabricated aggregate confidence", async () => {
  const React = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { MetricReport } = await import("../src/ui/report");
  const { composeMetrics } =
    await import("../src/infrastructure/jev-behaviors");
  const observations = Object.fromEntries(
    Object.keys(behaviorDefinitions).map((id) => [
      id,
      {
        choice: "absent",
        confidence: 0.82,
        probabilities: { absent: 1, weak: 0, clear: 0, strong: 0, unclear: 0 },
        stable: false,
        checkChoice: "weak",
      },
    ]),
  );
  const analysis: any = {
    id: "synthetic",
    conversationId: "synthetic",
    createdAt: 0,
    model: "jev-test",
    rubricVersion: "behavior-v4-observations",
    metrics: composeMetrics(observations),
    behaviors: observations,
    messageCount: 2,
  };
  const html = renderToStaticMarkup(
    React.createElement(MetricReport, {
      view: {
        conversation: {
          id: "synthetic",
          displayName: "合成案例",
          updatedAt: 0,
        },
        messages: [],
        stats: {} as any,
        analysis,
      },
    }),
  );
  assert.ok(html.includes("具体行为版 v4"));
  assert.ok(html.includes("0.82"));
  assert.ok(html.includes("校对具体关心"));
  assert.ok(html.includes("不同"));
  assert.ok(!html.includes("官方 confidence 0.82"));
  assert.ok(html.includes("不代表对方真实心理状态"));
});
