import { randomUUID } from "node:crypto";
import { hasBehaviorObservations, signalEpisodes } from "./signal-episodes";
import { composeMetrics } from "../infrastructure/jev-behaviors";
import { sanitize } from "./sanitizer";
import { buildRequest } from "../infrastructure/jev";
import {
  metricLabels,
  type Analysis,
  type AnalysisPlan,
  type AnalysisSegment,
  type Contact,
  type Message,
  type Metric,
  type ReadRange,
} from "../domain/types";
// Conservative UTF-8 budget. Official model docs: 32k state + longest question. Never assume characters == tokens.
export function prepareBatches(
  messages: Message[],
  contacts: Contact[],
  personId: string,
  maxBytes = 12000,
) {
  const clean = sanitize(messages, contacts, personId);
  const lines = JSON.parse(clean.state).messages as {
    speaker: string;
    text: string;
    modality?: string;
    contentStatus?: string;
  }[];
  const states: string[] = [];
  const summaries: AnalysisPlan["batches"] = [];
  let buffer: typeof lines = [], context: typeof lines = [];
  let indices: number[] = [];
  const serialize = (target: typeof lines, followingContext: typeof lines = []) =>
    JSON.stringify({ context, messages: target, followingContext });
  const flush = (next = -1, reason = "range_end") => {
    if (!buffer.length) return;
    let following = next < 0 ? [] : lines.slice(next, next + 2);
    while (following.length && (Buffer.byteLength(JSON.stringify(following)) > 800 ||
      Buffer.byteLength(serialize(buffer, following)) > maxBytes)) following.pop();
    const state = serialize(buffer, following);
    summaries.push({ index: states.length, messageCount: buffer.length,
      first: clean.timestamps[indices[0]], last: clean.timestamps[indices.at(-1)!],
      bytes: Buffer.byteLength(state), messageIds: indices.map(i => clean.messageIds[i]), splitReason: reason });
    states.push(state);
    context = [...context, ...buffer].slice(-6);
    while (context.length && Buffer.byteLength(JSON.stringify(context)) > Math.min(1200, maxBytes / 3)) context.shift();
    buffer = []; indices = [];
  };
  lines.forEach((line, i) => {
    const gap = i ? clean.timestamps[i] - clean.timestamps[i - 1] : 0;
    if (gap >= 1800) {
      flush(gap < 21600 ? i : -1, gap >= 21600 ? "session_gap" : "topic_pause");
      if (gap >= 21600) context = [];
    }
    const bytes = Buffer.byteLength(serialize([...buffer, line]));
    if (buffer.length && (buffer.length >= 200 || bytes > maxBytes)) flush(i, "capacity");
    else if (buffer.length >= 160 && bytes > maxBytes * .65 &&
      buffer.at(-1)?.speaker === "Person A" && line.speaker === "Me") flush(i, "turn_boundary");
    while (context.length && Buffer.byteLength(serialize([line])) > maxBytes) context.shift();
    if (Buffer.byteLength(serialize([line])) > maxBytes) throw new Error("单条匿名化文本超过分段容量");
    buffer.push(line); indices.push(i);
  });
  flush();
  // Include all question overhead (including optional consistency checks), not
  // just state bytes. Rebuild smaller chunks before presenting the send preview.
  if (
    states.some(
      (state) =>
        Buffer.byteLength(
          JSON.stringify(buildRequest(state, "jev-1.13.0", true)),
        ) > 64000,
    )
  ) {
    if (maxBytes <= 2000) throw new Error("匿名请求说明超过容量，无法安全分段");
    return prepareBatches(
      messages,
      contacts,
      personId,
      Math.floor(maxBytes * 0.75),
    );
  }
  return {
    plan: {
      segmentationVersion: "dialogue-units-v1",
      inputCoverage: {
        total: messages.length,
        modalities: clean.modalities,
        omitted: clean.omitted,
        truncated: clean.truncated,
        pendingVoice: messages.filter(
          (m) => m.kind === "voice" && !m.transcript,
        ).length,
      },
      token: randomUUID(),
      messageCount: clean.messageCount,
      omitted: clean.omitted,
      truncated: clean.truncated,
      batches: summaries,
    },
    states,
  };
}
export function aggregateSegments(
  id: string,
  conversationId: string,
  segments: AnalysisSegment[],
  totalBatches: number,
  range: ReadRange,
  status: "complete" | "partial",
): Analysis {
  const messageCount = segments.reduce((n, s) => n + s.result.messageCount, 0);
  const metrics = {} as Analysis["metrics"];
  const eventMode = hasBehaviorObservations(segments);
  for (const metric of Object.keys(metricLabels) as Metric[]) {
    const eligible = segments.filter(
      (s) => s.result.metrics[metric].quality !== "insufficient",
    );
    const values = eligible
      .map((s) => s.result.metrics[metric].score)
      .sort((a, b) => a - b);
    const middle = Math.floor(values.length / 2);
    const median = values.length
      ? values.length % 2
        ? values[middle]
        : (values[middle - 1] + values[middle]) / 2
      : 0;
    const event =
      eventMode && (metric === "romantic_interest" || metric === "flirting")
        ? signalEpisodes(segments, metric, median)
        : undefined;
    const width = Math.floor(segments.length / 3);
    const period = (rows: AnalysisSegment[]) => {
      const valid = rows.filter((s) => eligible.includes(s));
      if (event) {
        const periodEvent = signalEpisodes(valid, metric, 0);
        return valid.length >= 2 && periodEvent.signal.episodes > 0
          ? periodEvent.score
          : null;
      }
      return valid.length >= 2
        ? Math.round(
            valid.reduce((n, s) => n + s.result.metrics[metric].score, 0) /
              valid.length,
          )
        : null;
    };
    const previousScore =
      segments.length >= 6 ? period(segments.slice(0, width)) : null;
    const recentScore =
      segments.length >= 6 ? period(segments.slice(-width)) : null;
    const diff =
      recentScore === null || previousScore === null
        ? null
        : recentScore - previousScore;
    metrics[metric] = {
      score: event?.score ?? Math.round(median),
      reviewReasons: event?.reasons,
      confidence: null,
      quality:
        event?.reasons.length && eligible.length
          ? "limited"
          : eligible.length
            ? eligible.length === segments.length &&
              eligible.every(
                (s) => s.result.metrics[metric].quality !== "limited",
              )
              ? "sufficient"
              : "limited"
            : "insufficient",
      summary: {
        signal: event?.signal,
        eligibleSegments: eligible.length,
        totalSegments: segments.length,
        reviewSegments: eligible.filter(
          (s) => s.result.metrics[metric].quality === "limited",
        ).length,
        insufficientSegments: segments.length - eligible.length,
        recentScore,
        previousScore,
        trend:
          diff === null
            ? "insufficient"
            : diff >= 15
              ? "rising"
              : diff <= -15
                ? "falling"
                : "stable",
        minimum: values.length ? values[0] : null,
        maximum: values.length ? values.at(-1)! : null,
      },
    };
  }
  return {
    id,
    aggregationVersion: eventMode
      ? "event-strength-v3"
      : "reviewable-median-v2",
    conversationId,
    createdAt: Date.now(),
    rubricVersion: segments[0]?.result.rubricVersion,
    model: [...new Set(segments.map((s) => s.result.model))].join(", "),
    messageCount,
    metrics,
    segments,
    status,
    totalBatches,
    range,
  };
}

// Repair only local summaries. Original observations, timestamps and saved records remain intact.
export function repairSavedAggregate(a: Analysis): Analysis {
  if (a.segments?.length && hasBehaviorObservations(a.segments)) {
    // Derived view only: retain official observations, evidence and original rubric/date.
    const segments = a.segments.map((s) => {
      const derived = composeMetrics(s.result.behaviors!);
      for (const metric of Object.keys(metricLabels) as Metric[]) {
        const old = s.result.metrics[metric];
        derived[metric] = {
          ...old,
          ...derived[metric],
          quality:
            old.quality === "limited" &&
            derived[metric].quality === "sufficient"
              ? "limited"
              : derived[metric].quality,
          reviewReasons: [
            ...new Set([
              ...(derived[metric].reviewReasons ?? []),
              ...(old.reviewReasons ?? []),
            ]),
          ],
        };
      }
      return { ...s, result: { ...s.result, metrics: derived } };
    });
    const summary = aggregateSegments(
      a.id,
      a.conversationId,
      segments,
      a.totalBatches ?? segments.length,
      a.range ?? { until: Math.floor(a.createdAt / 1000), label: "已保存范围" },
      a.status ?? "complete",
    );
    return {
      ...a,
      metrics: summary.metrics,
      segments,
      aggregationVersion: summary.aggregationVersion,
    };
  }
  if (
    !a.rubricVersion?.startsWith("behavior-v3") ||
    !a.segments?.length ||
    a.aggregationVersion === "reviewable-median-v2"
  )
    return a;
  const summary = aggregateSegments(
    a.id,
    a.conversationId,
    a.segments,
    a.totalBatches ?? a.segments.length,
    a.range ?? { until: Math.floor(a.createdAt / 1000), label: "已保存范围" },
    a.status ?? "complete",
  );
  return {
    ...a,
    metrics: summary.metrics,
    aggregationVersion: summary.aggregationVersion,
  };
}
