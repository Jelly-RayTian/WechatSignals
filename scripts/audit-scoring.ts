// Offline only: reads the shipped authored-synthetic evaluation, never WeChat or Keychain.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { evaluationCases } from "../evaluation/corpus";
import { evaluatePredictions } from "../evaluation/scoring";
import { behaviorVersion } from "../src/infrastructure/jev-behaviors";
const manifest = JSON.parse(
  readFileSync("evaluation/frozen-profile.json", "utf8"),
);
for (const [file, expected] of Object.entries(manifest.sha256)) {
  if (
    createHash("sha256").update(readFileSync(file)).digest("hex") !== expected
  )
    throw Error(`frozen_profile_drift: ${file}`);
}
const original = JSON.parse(
  readFileSync("evaluation/results/latest.json", "utf8"),
);
const datasetHash = createHash("sha256")
  .update(JSON.stringify(evaluationCases))
  .digest("hex");
if (
  original.dataType !== "authored-synthetic" ||
  original.datasetHash !== datasetHash ||
  !Array.isArray(original.predictions)
)
  throw Error("not_a_matching_authored_synthetic_report");
const output = {
  auditVersion: "behavior-calibration-audit-v1",
  createdAt: new Date().toISOString(),
  currentRubricVersion: behaviorVersion,
  sourceRubricVersion: original.rubricVersion,
  sourceReportDate: original.createdAt,
  sourceModel: original.model,
  sourceMatchesCurrentRubric: original.rubricVersion === behaviorVersion,
  sourceMatchesFrozenProfile: original.frozenProfileId === manifest.id,
  datasetHash,
  independentAnnotation: original.independentAnnotation === true,
  validationStatus: "experimental-unvalidated",
  networkRequests: 0,
  note: "Existing authored synthetic behavior outputs only; no relationship ground truth or evidence of current aggregate accuracy. Previously inspected holdout is not a fresh blind test.",
  overall: evaluatePredictions(evaluationCases, original.predictions),
  holdout: evaluatePredictions(
    evaluationCases.filter((c) => c.split === "holdout"),
    original.predictions,
  ),
};
writeFileSync(
  "evaluation/results/calibration-audit.json",
  JSON.stringify(output, null, 2),
  { mode: 0o600 },
);
console.log(
  JSON.stringify({
    status: output.validationStatus,
    sourceRubric: output.sourceRubricVersion,
    matchesCurrentRubric: output.sourceMatchesCurrentRubric,
    matchesFrozenProfile: output.sourceMatchesFrozenProfile,
    exactLabels: output.overall.calibration.labels,
    brier: output.overall.calibration.brier,
    logLoss: output.overall.calibration.logLoss,
    probabilityCoverage: output.overall.calibration.coverage,
    networkRequests: 0,
    report: "evaluation/results/calibration-audit.json",
  }),
);
