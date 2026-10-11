import { interactionCriteria } from "../src/infrastructure/jev-interactions";
import type { EvaluationCase } from "./corpus";
export type Prediction = {
  id: string;
  behaviors: Record<
    string,
    {
      choice: string;
      checkChoice?: string;
      probabilities?: Record<string, number>;
    }
  >;
  error?: string;
};
export function evaluatePredictions(
  cases: EvaluationCase[],
  predictions: Prediction[],
) {
  const byId = new Map(predictions.map((p) => [p.id, p]));
  let correct = 0,
    total = 0,
    failedCases = 0,
    stable = 0,
    checked = 0,
    falsePositive = 0,
    negativeLabels = 0,
    missed = 0,
    positiveLabels = 0;
  const confusion: Record<string, Record<string, number>> = {};
  const rows = [];
  for (const c of cases) {
    const p = byId.get(c.id);
    if (!p || p.error) {
      failedCases++;
      rows.push({
        id: c.id,
        category: c.category,
        error: p?.error ?? "not_run",
      });
      continue;
    }
    const mismatches = [];
    for (const [id, expected] of Object.entries(c.expected)) {
      const actual = p.behaviors[id]?.choice ?? "missing";
      total++;
      const ok = expected.includes(actual);
      if (ok) correct++;
      else mismatches.push({ behavior: id, expected, actual });
      const group = expected.join("|");
      confusion[group] ??= {};
      confusion[group][actual] = (confusion[group][actual] ?? 0) + 1;
      if (expected.includes("absent") || expected.includes("not_observed")) {
        negativeLabels++;
        if (
          [
            "weak",
            "clear",
            "strong",
            "mutual",
            "one_sided_me",
            "one_sided_other",
            "declined",
          ].includes(actual)
        )
          falsePositive++;
      }
      if (
        expected.every((v) =>
          [
            "weak",
            "clear",
            "strong",
            "mutual",
            "one_sided_me",
            "one_sided_other",
            "declined",
          ].includes(v),
        )
      ) {
        positiveLabels++;
        if (actual === "absent" || actual === "not_observed") missed++;
      }
    }
    for (const o of Object.values(p.behaviors)) {
      if (o.checkChoice !== undefined) {
        checked++;
        if (o.choice === o.checkChoice) stable++;
      }
    }
    rows.push({ id: c.id, category: c.category, mismatches });
  }
  return {
    ...errorBreakdown(cases, predictions),
    calibration: evaluateCalibration(cases, predictions),
    cases: cases.length,
    failedCases,
    labels: total,
    correct,
    agreement: total ? correct / total : null,
    falsePositive,
    negativeLabels,
    falsePositiveRate: negativeLabels ? falsePositive / negativeLabels : null,
    missed,
    positiveLabels,
    missRate: positiveLabels ? missed / positiveLabels : null,
    checked,
    stable,
    orderStability: checked ? stable / checked : null,
    confusion,
    rows,
  };
}

// Proper multiclass scores require one exact reference label. Set-valued author
// labels remain valid for agreement, but are not invented into point targets.
function evaluateCalibration(
  cases: EvaluationCase[],
  predictions: Prediction[],
) {
  const behaviorOptions = ["absent", "weak", "clear", "strong", "unclear"];
  const byId = new Map(predictions.map((p) => [p.id, p]));
  let expectedExactLabels = 0,
    excludedSetValued = 0,
    labels = 0,
    brierSum = 0,
    lossSum = 0;
  const bins = Array.from({ length: 5 }, (_, i) => ({
    lower: i / 5,
    upper: (i + 1) / 5,
    count: 0,
    confidenceSum: 0,
    correct: 0,
  }));
  for (const c of cases) {
    const p = byId.get(c.id);
    for (const [id, expected] of Object.entries(c.expected)) {
      const options = id.startsWith("interaction_")
        ? Object.keys(interactionCriteria)
        : behaviorOptions;
      if (expected.length !== 1) {
        excludedSetValued++;
        continue;
      }
      expectedExactLabels++;
      const o = p?.error ? undefined : p?.behaviors[id];
      const probabilities = o?.probabilities;
      if (
        !o ||
        !options.includes(o.choice) ||
        !options.includes(expected[0]) ||
        !probabilities ||
        Object.keys(probabilities).length !== options.length ||
        options.some(
          (k) =>
            !Number.isFinite(probabilities[k]) ||
            probabilities[k] < 0 ||
            probabilities[k] > 1,
        )
      )
        continue;
      const sum = options.reduce((n, k) => n + probabilities[k], 0);
      if (Math.abs(sum - 1) > 0.03) continue;
      const normalized = Object.fromEntries(
        options.map((k) => [k, probabilities[k] / sum]),
      );
      labels++;
      brierSum += options.reduce(
        (n, k) => n + (normalized[k] - Number(k === expected[0])) ** 2,
        0,
      );
      lossSum -= Math.log(Math.max(1e-15, normalized[expected[0]]));
      const confidence = normalized[o.choice];
      const bin = bins[Math.min(4, Math.floor(confidence * 5))];
      bin.count++;
      bin.confidenceSum += confidence;
      bin.correct += Number(o.choice === expected[0]);
    }
  }
  const reliability = bins.map((b) => ({
    lower: b.lower,
    upper: b.upper,
    count: b.count,
    confidence: b.count ? b.confidenceSum / b.count : null,
    accuracy: b.count ? b.correct / b.count : null,
  }));
  return {
    target: "exact-observable-behavior-labels" as const,
    convention: "multiclass-sum-of-squares-0-to-2" as const,
    expectedExactLabels,
    excludedSetValued,
    labels,
    invalidOrMissing: expectedExactLabels - labels,
    coverage: expectedExactLabels ? labels / expectedExactLabels : null,
    brier: labels ? brierSum / labels : null,
    logLoss: labels ? lossSum / labels : null,
    ece: labels
      ? reliability.reduce(
          (n, b) =>
            n +
            (b.count / labels) *
              Math.abs((b.confidence ?? 0) - (b.accuracy ?? 0)),
          0,
        )
      : null,
    bins: reliability,
  };
}

export function errorBreakdown(
  cases: EvaluationCase[],
  predictions: Prediction[],
) {
  const byId = new Map(predictions.map((p) => [p.id, p]));
  const make = () => ({
    labels: 0,
    correct: 0,
    falsePositive: 0,
    negativeLabels: 0,
    missed: 0,
    positiveLabels: 0,
    abstained: 0,
    missing: 0,
  });
  const perBehavior: Record<string, ReturnType<typeof make>> = {};
  const perCategory: Record<
    string,
    ReturnType<typeof make> & { cases: number; failedCases: number }
  > = {};
  let expectedLabels = 0,
    successful = 0;
  for (const c of cases) {
    const p = byId.get(c.id),
      failed = !p || !!p.error;
    const category = (perCategory[c.category] ??= {
      ...make(),
      cases: 0,
      failedCases: 0,
    });
    category.cases++;
    if (failed) category.failedCases++;
    else successful++;
    for (const [id, expected] of Object.entries(c.expected)) {
      expectedLabels++;
      const group = (perBehavior[id] ??= make()),
        actual = failed ? undefined : p.behaviors[id]?.choice;
      for (const r of [group, category]) {
        if (!actual) {
          r.missing++;
          continue;
        }
        r.labels++;
        r.correct += Number(expected.includes(actual));
        r.abstained += Number(actual === "unclear");
        if (expected.includes("absent") || expected.includes("not_observed")) {
          r.negativeLabels++;
          r.falsePositive += Number(
            [
              "weak",
              "clear",
              "strong",
              "mutual",
              "one_sided_me",
              "one_sided_other",
              "declined",
            ].includes(actual),
          );
        }
        if (
          expected.every((x) =>
            [
              "weak",
              "clear",
              "strong",
              "mutual",
              "one_sided_me",
              "one_sided_other",
              "declined",
            ].includes(x),
          )
        ) {
          r.positiveLabels++;
          r.missed += Number(actual === "absent" || actual === "not_observed");
        }
      }
    }
  }
  return {
    expectedLabels,
    coverage: cases.length ? successful / cases.length : null,
    perBehavior,
    perCategory,
  };
}
