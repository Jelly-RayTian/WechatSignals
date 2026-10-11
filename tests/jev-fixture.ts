import { metricLabels } from "../src/domain/types";
// Transport fixture follows the official Score / Choice envelope; it makes no semantic accuracy claims.
export function fixtureAnswers(score = 2, confidence = 0.6) {
  return Object.fromEntries(
    Object.keys(metricLabels).flatMap((id) => [
      [
        id,
        {
          type: "score",
          score,
          confidence,
          legend: { "0": "none", "4": "strong" },
          probabilities: { "0": 1 - score / 4, "4": score / 4 },
        },
      ],
      [
        id + "_support",
        {
          type: "choice",
          choice: "none",
          confidence: 0.8,
          probabilities: { none: 1 },
        },
      ],
      [
        id + "_counter",
        {
          type: "choice",
          choice: "none",
          confidence: 0.8,
          probabilities: { none: 1 },
        },
      ],
      [
        id + "_quality",
        {
          type: "choice",
          choice: "sufficient",
          confidence: 0.8,
          probabilities: { sufficient: 1, limited: 0, insufficient: 0 },
        },
      ],
    ]),
  );
}
