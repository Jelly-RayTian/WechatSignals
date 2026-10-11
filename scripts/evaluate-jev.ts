import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  parseEvaluationDataset,
  compareEvaluationReports,
} from "../evaluation/independent";
import { dialogueCases } from "../evaluation/dialogue-corpus";
import { evaluationCases } from "../evaluation/corpus";
import { attributionCases } from "../evaluation/attribution-corpus";
import { evaluatePredictions, type Prediction } from "../evaluation/scoring";
import { JevAnalysisService } from "../src/infrastructure/jev";
import { behaviorVersion } from "../src/infrastructure/jev-behaviors";
import { KeychainStore } from "../src/infrastructure/keychain";
const args = process.argv.slice(2);
const datasetArg = args.indexOf("--dataset");
const dataset =
  datasetArg < 0
    ? null
    : parseEvaluationDataset(
        JSON.parse(readFileSync(args[datasetArg + 1], "utf8")),
      );
const selectedCases = dataset?.cases ?? [
  ...evaluationCases,
  ...(args.includes("--with-attribution") ? attributionCases : []),
  ...(args.includes("--with-dialogue") ? dialogueCases : []),
];
const dir = join(process.cwd(), "evaluation/results");
mkdirSync(dir, { recursive: true });
const hash = createHash("sha256")
  .update(JSON.stringify(selectedCases))
  .digest("hex");
if (!args.includes("--live")) {
  console.log(
    JSON.stringify({
      mode: "offline-inventory",
      cases: selectedCases.length,
      development: selectedCases.filter((c) => c.split === "development")
        .length,
      holdout: selectedCases.filter((c) => c.split === "holdout").length,
      attributionCases: args.includes("--with-attribution")
        ? attributionCases.length
        : 0,
      datasetHash: hash,
      semanticAccuracy: "not_run",
      independentAnnotation: dataset?.independentAnnotation ?? false,
      note: "Use --live to send only authored synthetic cases to official Jev; never loads WeChat databases.",
    }),
  );
  process.exit(0);
}
const limitArg = args.indexOf("--limit");
const limit = limitArg < 0 ? selectedCases.length : Number(args[limitArg + 1]);
if (!Number.isInteger(limit) || limit < 1 || limit > selectedCases.length)
  throw new Error("invalid_limit");
const cases = selectedCases.slice(0, limit);
const predictions: Prediction[] = [];
const service = new JevAnalysisService(
  new KeychainStore(join(process.cwd(), "native/keychain-helper")),
  fetch,
  () => "jev-1.13.0",
  () => true,
);
for (const c of cases) {
  try {
    const result = await service.analyze(
      "synthetic-evaluation",
      JSON.stringify({ context: [], messages: c.messages }),
      c.messages.length,
    );
    predictions.push({
      id: c.id,
      behaviors: {
        ...result.behaviors,
        ...Object.fromEntries(
          Object.entries(result.interactions ?? {}).map(([id, o]) => [
            "interaction_" + id,
            o,
          ]),
        ),
      },
    });
    console.log(
      JSON.stringify({
        processed: predictions.length,
        total: cases.length,
        status: "ok",
      }),
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "evaluation_failed";
    predictions.push({ id: c.id, behaviors: {}, error: message });
    console.log(
      JSON.stringify({
        processed: predictions.length,
        total: cases.length,
        status: "failed",
        reason: message,
      }),
    );
    if (predictions.length === 1 || /HTTP (401|402|403|429)/.test(message))
      break;
  }
}
const report = {
  createdAt: new Date().toISOString(),
  rubricVersion: behaviorVersion,
  model: "jev-1.13.0",
  datasetHash: hash,
  dataType: dataset?.dataType ?? "authored-synthetic",
  independentAnnotation: dataset?.independentAnnotation ?? false,
  annotationProvenance: dataset
    ? {
        reviewers: dataset.reviewers,
        blindToPredictions: dataset.blindToPredictions,
        adjudication: dataset.adjudication,
      }
    : null,
  frozenProfileId: JSON.parse(
    readFileSync("evaluation/frozen-profile.json", "utf8"),
  ).id,
  requests: predictions.length,
  overall: evaluatePredictions(cases, predictions),
  development: evaluatePredictions(
    cases.filter((c) => c.split === "development"),
    predictions,
  ),
  holdout: evaluatePredictions(
    cases.filter((c) => c.split === "holdout"),
    predictions,
  ),
  predictions,
};
const stamp = report.createdAt.replace(/[:.]/g, "-");
writeFileSync(join(dir, stamp + ".json"), JSON.stringify(report, null, 2), {
  mode: 0o600,
});
const previous = join(dir, "baseline.json");
if (
  !existsSync(previous) &&
  report.overall.failedCases === 0 &&
  limit === selectedCases.length
)
  writeFileSync(previous, JSON.stringify(report, null, 2), { mode: 0o600 });
writeFileSync(join(dir, "latest.json"), JSON.stringify(report, null, 2), {
  mode: 0o600,
});
const baseline = existsSync(previous)
  ? JSON.parse(readFileSync(previous, "utf8"))
  : null;
console.log(
  JSON.stringify({
    summary: {
      overall: report.overall.agreement,
      development: report.development.agreement,
      holdout: report.holdout.agreement,
      failed: report.overall.failedCases,
      falsePositiveRate: report.overall.falsePositiveRate,
      missRate: report.overall.missRate,
      orderStability: report.overall.orderStability,
    },
    comparison: compareEvaluationReports(report, baseline),
    report: join(dir, "latest.json"),
  }),
);
if (report.overall.failedCases) process.exitCode = 1;
