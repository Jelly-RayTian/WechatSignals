import { test } from "node:test";
import assert from "node:assert/strict";
import { statistics } from "../src/application/stats";
import { chartData } from "../src/application/charts";
import { prepareBatches, aggregateSegments } from "../src/application/batches";
import type { Message, AnalysisSegment } from "../src/domain/types";
const messages: Message[] = Array.from({ length: 12 }, (_, i) => ({
  id: String(i),
  conversationId: "p",
  sender: i % 2 ? "other" : "me",
  timestamp: 1000 + i * 10,
  text: String(i) + "合成消息".repeat(40),
  kind: "text",
}));
test("response summary includes median, tail and qualifying sample count", () => {
  const rows = [0, 10, 20, 30, 130].map((timestamp, i) => ({
    ...messages[0],
    sender: i % 2 ? ("other" as const) : ("me" as const),
    timestamp,
  }));
  const s = statistics(rows, 200);
  assert.equal(s.me.replySamples, 2);
  assert.equal(s.me.medianReplySeconds, 55);
  assert.equal(s.me.p90ReplySeconds, 100);
});
test("activity heatmap conserves known-sender count across 168 cells", () => {
  const chart = chartData(messages);
  assert.equal(chart.weekdayHourly?.length, 168);
  assert.equal(
    chart.weekdayHourly?.reduce((n, c) => n + c.me + c.other, 0),
    12,
  );
});
test("analysis batches carry bounded previous context without duplicating targets or crossing silence", () => {
  const data = messages.map((m) => ({ ...m }));
  data[8].timestamp += 30000;
  for (let i = 9; i < data.length; i++) data[i].timestamp += 30000;
  const prepared = prepareBatches(data, [], "p", 2200);
  assert.equal(prepared.plan.messageCount, 12);
  assert.equal(
    prepared.states.reduce((n, s) => n + JSON.parse(s).messages.length, 0),
    12,
  );
  assert.ok(prepared.states.some((s) => JSON.parse(s).context?.length));
  const newSession = prepared.states
    .map((s) => JSON.parse(s))
    .find(
      (s) => s.messages[0].text === data[8].text && s.context?.length === 0,
    );
  assert.ok(newSession);
  assert.ok(prepared.states.every((s) => Buffer.byteLength(s) <= 2200));
});
test("evidence-aware aggregation abstains on missing evidence and shows changes rather than volume-weighting", () => {
  const labels = [
    "romantic_interest",
    "initiative",
    "emotional_investment",
    "closeness",
    "flirting",
  ];
  const segments: AnalysisSegment[] = Array.from({ length: 9 }, (_, i) => ({
    index: i,
    first: i,
    last: i,
    result: {
      id: String(i),
      conversationId: "p",
      createdAt: 0,
      model: "jev-test",
      messageCount: i === 0 ? 10000 : 10,
      metrics: Object.fromEntries(
        labels.map((m) => [
          m,
          {
            score: i < 3 ? 25 : i < 6 ? 50 : 75,
            confidence: 0.8,
            quality: m === "flirting" ? "insufficient" : "sufficient",
          },
        ]),
      ) as any,
    },
  }));
  const result = aggregateSegments(
    "id",
    "p",
    segments,
    9,
    { until: 9, label: "test" },
    "complete",
  );
  assert.equal(result.metrics.romantic_interest.score, 50);
  assert.equal(result.metrics.romantic_interest.summary?.recentScore, 75);
  assert.equal(result.metrics.romantic_interest.summary?.trend, "rising");
  assert.equal(result.metrics.flirting.quality, "insufficient");
});

import { buildRequest, JevAnalysisService } from "../src/infrastructure/jev-legacy";
const secret = {
  get: async () => "synthetic",
  set: async () => {},
  delete: async () => {},
};
const requestState = JSON.stringify({
  context: [{ speaker: "Me", text: "之前的合成背景" }],
  messages: [
    { speaker: "Person A", text: "周末一起去看展吧" },
    { speaker: "Me", text: "好呀" },
  ],
});
function responseAnswers() {
  const ids = [
    "romantic_interest",
    "initiative",
    "emotional_investment",
    "closeness",
    "flirting",
  ];
  return Object.fromEntries(
    ids.flatMap((id) => [
      [
        id,
        {
          type: "score",
          score: 3,
          confidence: 0.8,
          legend: { "0": "none", "4": "strong" },
          probabilities: { "3": 1 },
        },
      ],
      [
        id + "_support",
        {
          type: "choice",
          choice: "p0",
          confidence: 0.8,
          probabilities: { p0: 1, none: 0 },
        },
      ],
      [
        id + "_counter",
        {
          type: "choice",
          choice: "none",
          confidence: 0.8,
          probabilities: { none: 1, p0: 0 },
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
test("Jev returns evidence by source selection rather than generated quotations", async () => {
  const req = buildRequest(requestState);
  assert.equal(req.questions.romantic_interest_support.type, "choice");
  const result = await new JevAnalysisService(
    secret,
    async () =>
      new Response(
        JSON.stringify({ model: "jev-1.13.0", answers: responseAnswers() }),
      ),
  ).analyze("local-only", requestState, 2);
  assert.equal(
    result.metrics.romantic_interest.support?.messages[0].text,
    "周末一起去看展吧",
  );
  assert.equal(result.metrics.romantic_interest.counter, null);
  assert.equal(result.metrics.romantic_interest.quality, "sufficient");
});
test("Jev refuses foreign or missing evidence selectors and marks unsupported strong score for review", async () => {
  for (const bad of ["foreign", "missing"]) {
    const answers = responseAnswers();
    if (bad === "foreign")
      answers.romantic_interest_support.choice = "invented";
    else delete answers.romantic_interest_quality;
    await assert.rejects(() =>
      new JevAnalysisService(
        secret,
        async () =>
          new Response(JSON.stringify({ model: "jev-1.13.0", answers })),
      ).analyze("p", requestState, 2),
    );
  }
  const answers = responseAnswers();
  answers.romantic_interest_support.choice = "none";
  const result = await new JevAnalysisService(
    secret,
    async () => new Response(JSON.stringify({ model: "jev-1.13.0", answers })),
  ).analyze("p", requestState, 2);
  assert.equal(result.metrics.romantic_interest.quality, "limited");
});

test("uncertain Jev decisions remain reviewable instead of entering confident aggregate", async () => {
  const answers = responseAnswers();
  answers.romantic_interest.confidence = 0.2;
  const result = await new JevAnalysisService(
    secret,
    async () => new Response(JSON.stringify({ model: "jev-1.13.0", answers })),
  ).analyze("p", requestState, 2);
  assert.equal(result.metrics.romantic_interest.quality, "limited");
});

test("sparse period evidence cannot manufacture a confident rising or falling trend", () => {
  const metricNames = [
    "romantic_interest",
    "initiative",
    "emotional_investment",
    "closeness",
    "flirting",
  ];
  const segments = Array.from({ length: 6 }, (_, i) => ({
    index: i,
    first: i,
    last: i,
    result: {
      id: String(i),
      conversationId: "p",
      model: "jev-test",
      createdAt: 0,
      messageCount: 10,
      metrics: Object.fromEntries(
        metricNames.map((name) => [
          name,
          {
            score: i < 3 ? 0 : 100,
            confidence: 0.8,
            quality: i === 0 || i === 5 ? "sufficient" : "insufficient",
          },
        ]),
      ) as any,
    },
  }));
  const result = aggregateSegments(
    "a",
    "p",
    segments,
    6,
    { until: 6, label: "test" },
    "complete",
  );
  assert.equal(result.metrics.flirting.summary?.trend, "insufficient");
});
