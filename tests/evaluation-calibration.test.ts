import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluatePredictions } from "../evaluation/scoring";
import type { EvaluationCase } from "../evaluation/corpus";
const item = (id: string, expected = ["absent"]): EvaluationCase => ({
  id,
  split: "holdout",
  category: "synthetic",
  reason: "authored label",
  messages: [],
  expected: { romantic_hint: expected },
});
const prediction = (id: string, choice: string, p: number) => ({
  id,
  behaviors: {
    romantic_hint: {
      choice,
      probabilities: {
        absent: 1 - p,
        weak: 0,
        clear: p,
        strong: 0,
        unclear: 0,
      },
    },
  },
});
test("proper scoring penalizes confident wrong behavior judgments", () => {
  const good = evaluatePredictions(
    [item("x")],
    [prediction("x", "absent", 0.1)],
  ).calibration;
  const bad = evaluatePredictions(
    [item("x")],
    [prediction("x", "clear", 0.99)],
  ).calibration;
  assert.ok(Math.abs(good.brier! - 0.02) < 1e-10);
  assert.ok(bad.brier! > 1.9);
  assert.ok(bad.logLoss! > good.logLoss!);
  assert.equal(bad.bins.at(-1)!.accuracy, 0);
});
test("ambiguous labels are not fabricated into exact probability targets", () => {
  const score = evaluatePredictions(
    [item("x", ["clear", "strong"])],
    [prediction("x", "clear", 0.9)],
  );
  assert.equal(score.correct, 1);
  assert.equal(score.calibration.labels, 0);
  assert.equal(score.calibration.excludedSetValued, 1);
  assert.equal(score.calibration.brier, null);
});
test("missing and malformed distributions reduce reported coverage instead of becoming perfect scores", () => {
  const score = evaluatePredictions(
    [item("x"), item("y"), item("z")],
    [
      prediction("x", "absent", 0.1),
      {
        id: "y",
        behaviors: {
          romantic_hint: { choice: "absent", probabilities: { absent: 9 } },
        },
      },
    ],
  );
  assert.equal(score.calibration.labels, 1);
  assert.equal(score.calibration.expectedExactLabels, 3);
  assert.equal(score.calibration.coverage, 1 / 3);
  assert.equal(score.calibration.invalidOrMissing, 2);
});
test("algorithm sources and dataset match the frozen experimental audit manifest", async () => {
  const { readFile } = await import("node:fs/promises");
  const { createHash } = await import("node:crypto");
  const manifest = JSON.parse(
    await readFile(
      new URL("../evaluation/frozen-profile.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(manifest.validationStatus, "experimental-unvalidated");
  for (const [file, expected] of Object.entries(manifest.sha256)) {
    const bytes = await readFile(new URL("../" + file, import.meta.url));
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      expected,
      `scoring profile drift: ${file}`,
    );
  }
});
