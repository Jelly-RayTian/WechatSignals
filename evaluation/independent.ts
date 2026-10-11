import { z } from "zod";
import {
  interactionDefinitions,
  interactionCriteria,
} from "../src/infrastructure/jev-interactions";
import { behaviorDefinitions } from "../src/infrastructure/jev-behaviors";
const label = z.string().min(1).max(40);
const entry = z.object({
  id: z.string().min(1).max(100),
  split: z.enum(["development", "holdout"]),
  category: z.string().min(1).max(100),
  reason: z.string().max(1000),
  messages: z
    .array(
      z.object({
        speaker: z.enum(["Me", "Person A"]),
        text: z.string().min(1).max(2000),
      }),
    )
    .min(1)
    .max(200),
  expected: z.record(z.string(), z.array(label).min(1)),
});
export function parseEvaluationDataset(raw: unknown) {
  const result = z
    .object({
      dataType: z.enum(["authored-synthetic", "independent-deidentified"]),
      reviewers: z.array(z.string().min(1).max(100)).max(20).default([]),
      blindToPredictions: z.boolean().default(false),
      adjudication: z.string().max(2000).default(""),
      cases: z.array(entry).min(1).max(1000),
    })
    .parse(raw);
  const independent = result.dataType === "independent-deidentified";
  if (
    independent &&
    (new Set(result.reviewers).size < 2 ||
      !result.blindToPredictions ||
      !result.adjudication ||
      !result.cases.some((c) => c.split === "holdout"))
  )
    throw Error("independent_annotation_provenance_required");
  if (new Set(result.cases.map((c) => c.id)).size !== result.cases.length)
    throw Error("duplicate_case_id");
  for (const c of result.cases) {
    if (!Object.keys(c.expected).length)
      throw Error("unknown_behavior_reference");
    for (const [id, values] of Object.entries(c.expected)) {
      const options =
        id.startsWith("interaction_") &&
        Object.hasOwn(interactionDefinitions, id.slice(12))
          ? Object.keys(interactionCriteria)
          : Object.hasOwn(behaviorDefinitions, id)
            ? ["absent", "weak", "clear", "strong", "unclear"]
            : [];
      if (values.some((v) => !options.includes(v)))
        throw Error("unknown_behavior_reference");
    }
    if (
      c.messages.some((m) =>
        /wxid_|\/Users\/|\/Volumes\/|https?:\/\/|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\b\d{7,}\b/i.test(
          m.text,
        ),
      )
    )
      throw Error("dataset_requires_anonymous_text");
  }
  return { ...result, independentAnnotation: independent };
}
export function compareEvaluationReports(current: any, previous: any) {
  const comparable =
    !!previous &&
    current.datasetHash === previous.datasetHash &&
    current.model === previous.model &&
    current.overall?.coverage === 1 &&
    previous.overall?.coverage === 1 &&
    current.overall?.agreement != null &&
    previous.overall?.agreement != null;
  return {
    comparable,
    agreementDelta: comparable
      ? current.overall.agreement - previous.overall.agreement
      : null,
    reason: comparable
      ? "same_dataset_model_full_coverage"
      : "数据集、模型或完整运行覆盖不一致，不能直接比较",
  };
}
