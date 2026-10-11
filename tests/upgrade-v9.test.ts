import { test } from "node:test";
import assert from "node:assert/strict";
import { prepareBatches } from "../src/application/batches";
import { sanitize } from "../src/application/sanitizer";
import type { Message } from "../src/domain/types";
const msg = (
  i: number,
  t = i * 10,
  s: Message["sender"] = i % 2 ? "other" : "me",
): Message => ({
  id: "local-" + i,
  conversationId: "private",
  timestamp: t,
  sender: s,
  kind: "text",
  text: "合成内容" + i,
});
test("topic pauses end a target unit; local ids never enter state and every target is counted once", () => {
  const source = [msg(0, 0), msg(1, 20), msg(2, 1900), msg(3, 1920)];
  const b = prepareBatches(source, [], "private");
  assert.equal(b.states.length, 2);
  assert.deepEqual(
    b.plan.batches.map((x) => (x as any).messageIds),
    [
      ["local-0", "local-1"],
      ["local-2", "local-3"],
    ],
  );
  assert.equal(
    b.plan.batches.reduce((n, x) => n + x.messageCount, 0),
    4,
  );
  assert.ok(
    b.states.every((s) => !s.includes("local-") && !s.includes("private")),
  );
  const first = JSON.parse(b.states[0]);
  assert.ok(first.followingContext.length > 0);
});
test("speech provenance and picture correction remain text-only; local classifications never cross boundary", () => {
  const source = [
    {
      ...msg(0),
      kind: "voice" as const,
      transcript: "你好",
      transcriptReviewed: true,
    },
    {
      ...msg(1),
      kind: "image" as const,
      media: {
        version: "vision-local-v2",
        status: "recognized",
        text: "想见你",
        confidence: 0.9,
        reviewed: true,
        labels: [{ name: "private-label", confidence: 0.95 }],
        barcodeCount: 1,
      },
    },
  ] as Message[];
  const s = sanitize(source, []).state;
  assert.ok(s.includes("人工核对"));
  assert.ok(!s.includes("private-label"));
  assert.ok(!s.includes("barcodeCount"));
});
test("local dialogue statistics distinguish bidirectional sessions, censored edges and unknown speakers", async () => {
  const { dialogueInteractions } =
    await import("../src/application/dialogue-interactions");
  const r = dialogueInteractions(
    [
      msg(0, 0),
      msg(1, 10),
      msg(2, 22000, "other"),
      msg(3, 22010, "other"),
      msg(4, 45000, "me"),
    ],
    46000,
  );
  assert.equal(r.sessions, 3);
  assert.equal(r.bilateralSessions, 1);
  assert.equal(r.other.started, 1);
  assert.equal(r.other.unanswered, 1);
  assert.equal(r.me.pending, 1);
  assert.equal(r.leftCensored, 1);
  assert.equal(r.other.turns, 2);
  const unknown = dialogueInteractions([msg(0, 0, "unknown")], 100);
  assert.equal(unknown.sessions, 0);
});
test("evidence context uses local ids and never guesses an old missing mapping", async () => {
  const { locateEvidence } =
    await import("../src/application/evidence-context");
  const messages = Array.from({ length: 12 }, (_, i) => msg(i));
  const result = locateEvidence(
    messages,
    { messageIds: messages.slice(4, 9).map((m) => m.id) } as any,
    { targetStart: 1, targetEnd: 3, messages: [] } as any,
  );
  assert.equal(result.available, true);
  assert.deepEqual(result.targetIds, ["local-5", "local-6"]);
  assert.ok(result.messages.length > 2);
  assert.equal(
    locateEvidence(
      messages,
      {} as any,
      { targetStart: 0, targetEnd: 1, messages: [] } as any,
    ).available,
    false,
  );
  assert.equal(
    locateEvidence(
      messages,
      { messageIds: ["missing"] } as any,
      { targetStart: 0, targetEnd: 1, messages: [] } as any,
    ).available,
    false,
  );
});
test("official Jev request includes independent mutual judgments without altering metric score composition", async () => {
  const { buildRequest, JevAnalysisService } =
    await import("../src/infrastructure/jev");
  const state = JSON.stringify({
    messages: [
      { speaker: "Me", text: "合成邀请" },
      { speaker: "Person A", text: "合成回应" },
    ],
  });
  const req = buildRequest(state);
  assert.ok(req.questions.interaction_invitation);
  assert.ok(req.questions.interaction_support);
  assert.ok(req.questions.interaction_affection);
  assert.ok(req.questions.interaction_affection.criteria.one_sided_me);
  let requests = 0;
  const svc = new JevAnalysisService(
    { get: async () => "synthetic-key" } as any,
    async (_url: any, init: any) => {
      requests++;
      const q = JSON.parse(init.body).questions;
      return new Response(
        JSON.stringify({
          model: "jev-test",
          answers: Object.fromEntries(
            Object.entries(q).map(([id, x]: any) => {
              const choice = id.startsWith("interaction_")
                ? "unclear"
                : Object.hasOwn(x.criteria, "none")
                  ? "none"
                  : "absent";
              return [
                id,
                {
                  type: "choice",
                  choice,
                  confidence: 0.9,
                  probabilities: Object.fromEntries(
                    Object.keys(x.criteria).map((k) => [k, +(k === choice)]),
                  ),
                },
              ];
            }),
          ),
        }),
      );
    },
  );
  const a = await svc.analyze("synthetic", state, 2);
  assert.equal(requests, 1);
  assert.equal((a as any).interactions.invitation.choice, "unclear");
});
test("local image metadata is bounded and retains only coarse labels; reviewed transcript persists across reopen", async () => {
  const { parseVisionObservation } =
    await import("../src/infrastructure/image-ocr");
  const r = parseVisionObservation({
    text: "合成",
    confidence: 0.9,
    width: 600,
    height: 400,
    frameCount: 3,
    barcodeCount: 2,
    labels: [
      { name: "food", confidence: 0.91 },
      { name: "emotion_happy", confidence: 0.99 },
    ],
    classificationAvailable: true,
    payload: "secret",
  });
  assert.equal(r.frameCount, 3);
  assert.equal(r.barcodeCount, 2);
  assert.equal((r as any).payload, undefined);
  assert.ok(!r.labels?.some((x) => x.name === "emotion_happy"));
  assert.throws(() => parseVisionObservation({ text: "", confidence: 1.2 }));
  const { SqliteRepository } = await import("../src/infrastructure/sqlite");
  const { mkdtemp, rm } = await import("node:fs/promises"),
    { tmpdir } = await import("node:os"),
    { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "v9-cache-"));
  let repo;
  try {
    const path = join(dir, "data.sqlite");
    repo = await SqliteRepository.open(path);
    repo.saveMedia("m", r);
    repo.saveTranscript("v", "合成");
    repo.saveTranscriptReview("v");
    repo.close();
    repo = await SqliteRepository.open(path);
    assert.equal(repo.getTranscriptReview("v"), true);
    assert.deepEqual(repo.getMedia("m"), r);
    repo.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("evaluation reports per-behavior errors, abstentions and failed-case coverage", async () => {
  const { evaluatePredictions } = await import("../evaluation/scoring");
  const cases = [
    { id: "a", category: "普通朋友", expected: { romantic_hint: ["absent"] } },
    { id: "b", category: "暧昧", expected: { romantic_hint: ["clear"] } },
    { id: "c", category: "暧昧", expected: { romantic_hint: ["clear"] } },
  ] as any;
  const r = evaluatePredictions(cases, [
    { id: "a", behaviors: { romantic_hint: { choice: "strong" } } },
    { id: "b", behaviors: { romantic_hint: { choice: "unclear" } } },
  ]);
  assert.equal(r.perBehavior.romantic_hint.falsePositive, 1);
  assert.equal(r.perBehavior.romantic_hint.abstained, 1);
  assert.equal(r.coverage, 2 / 3);
  assert.equal(r.perCategory["暧昧"].failedCases, 1);
  assert.equal(r.expectedLabels, 3);
});
test("independent dataset claims require two reviewers, held-out provenance and bounded anonymous cases", async () => {
  const { parseEvaluationDataset, compareEvaluationReports } =
    await import("../evaluation/independent");
  const base = {
    dataType: "independent-deidentified",
    reviewers: ["reviewer-a", "reviewer-b"],
    blindToPredictions: true,
    adjudication: "disagreements resolved before inference",
    cases: [
      {
        id: "new-case",
        split: "holdout",
        category: "普通朋友",
        reason: "reference",
        messages: [{ speaker: "Me", text: "匿名合成内容" }],
        expected: { romantic_hint: ["absent"] },
      },
    ],
  };
  const result = parseEvaluationDataset(base);
  assert.equal(result.independentAnnotation, true);
  assert.throws(() => parseEvaluationDataset({ ...base, reviewers: ["one"] }));
  assert.throws(() =>
    parseEvaluationDataset({
      ...base,
      cases: [
        {
          ...base.cases[0],
          messages: [{ speaker: "Me", text: "/Users/private/file.png" }],
        },
      ],
    }),
  );
  assert.equal(
    compareEvaluationReports(
      {
        datasetHash: "a",
        model: "jev",
        overall: { coverage: 1, agreement: 1 },
      },
      {
        datasetHash: "b",
        model: "jev",
        overall: { coverage: 1, agreement: 0 },
      },
    ).comparable,
    false,
  );
  assert.equal(
    compareEvaluationReports(
      {
        datasetHash: "a",
        model: "jev",
        overall: { coverage: 1, agreement: 1 },
      },
      {
        datasetHash: "a",
        model: "jev",
        overall: { coverage: 0.5, agreement: 1 },
      },
    ).comparable,
    false,
  );
});
test("report quality view renders coverage, dual directions and event evidence links without invented model results", async () => {
  const React = await import("react"),
    { renderToStaticMarkup } = await import("react-dom/server");
  const { CoveragePanel, InteractionPanel, SignalTimeline } =
    await import("../src/ui/insights");
  const view = {
    messages: [],
    stats: {},
    analysis: null,
    contentCoverage: {
      total: 10,
      text: 3,
      voice: 4,
      transcribed: 1,
      images: 2,
      imageOcr: 0,
      emoji: 1,
      other: 0,
    },
    interactions: {
      sessions: 3,
      bilateralSessions: 1,
      leftCensored: 1,
      me: { started: 1, receivedReply: 1, unanswered: 0, pending: 0, turns: 2 },
      other: {
        started: 1,
        receivedReply: 0,
        unanswered: 0,
        pending: 1,
        turns: 2,
      },
    },
  } as any;
  const coverage = renderToStaticMarkup(
    React.createElement(CoveragePanel, { view }),
  );
  assert.ok(coverage.includes("数据覆盖"));
  assert.ok(coverage.includes("3"));
  assert.ok(coverage.includes("当前读取"));
  const interaction = renderToStaticMarkup(
    React.createElement(InteractionPanel, { view }),
  );
  assert.ok(interaction.includes("双方互动"));
  assert.ok(interaction.includes("未记录双向语义判断"));
  assert.ok(interaction.includes("不是拒绝"));
  const timeline = renderToStaticMarkup(
    React.createElement(SignalTimeline, { analysis: null, onSelect: () => {} }),
  );
  assert.ok(timeline.includes("手动分析"));
});
test("service preserves evidence mapping, image edits invalidate confirmation and never call Jev implicitly", async () => {
  const { ApplicationService } = await import("../src/application/service");
  const { composeMetrics, behaviorDefinitions } =
    await import("../src/infrastructure/jev-behaviors");
  const rows = [
    msg(0, 10),
    msg(1, 20),
    {
      ...msg(2, 30),
      kind: "image" as const,
      media: {
        version: "vision-local-v2" as const,
        status: "recognized" as const,
        text: "合成图片",
        confidence: 0.9,
      },
    },
  ];
  const media = new Map();
  let saved: any = null,
    calls = 0;
  const reader: any = {
    listContacts: async () => [],
    listConversations: async () => [
      { id: "private", displayName: "synthetic", updatedAt: 30 },
    ],
    getMessagePage: async () => ({
      messages: rows,
      hasMore: false,
      crossDatabaseAtomic: true,
    }),
  };
  const repo: any = {
    save: (a: any) => (saved = a),
    latest: () => saved,
    cacheContacts: () => {},
    cacheMessages: () => {},
    getMedia: (id: string) => media.get(id),
    saveMedia: (id: string, v: any) => media.set(id, v),
  };
  const jev: any = {
    analyze: async (_id: string, state: string, messageCount: number) => {
      calls++;
      const behaviors = Object.fromEntries(
        Object.keys(behaviorDefinitions).map((id) => [
          id,
          {
            choice: "absent",
            confidence: 1,
            probabilities: {
              absent: 1,
              weak: 0,
              clear: 0,
              strong: 0,
              unclear: 0,
            },
          },
        ]),
      );
      const metrics = composeMetrics(behaviors);
      metrics.romantic_interest.support = {
        targetStart: 0,
        targetEnd: 1,
        messages: JSON.parse(state).messages.slice(0, 1),
      };
      return {
        id: "s",
        conversationId: "private",
        model: "jev-test",
        createdAt: 1,
        messageCount,
        behaviors,
        rubricVersion: "behavior-v9-dialogue-context",
        metrics,
      };
    },
  };
  const service = new ApplicationService(reader, jev, repo);
  await service.list();
  const wait = async (id: string) => {
    for (let n = 0; n < 100; n++) {
      const j = service.job(id);
      if (j.state !== "running") return j;
      await new Promise((r) => setImmediate(r));
    }
    throw Error("timeout");
  };
  await wait(
    service.startRead("private", { until: 100, label: "synthetic" }).id,
  );
  const old = await service.previewPlan("private");
  service.editImageText("private", "local-2", "校正内容");
  assert.throws(() => service.previewBatch(old.token, 0));
  assert.equal(calls, 0);
  const prepared = await service.previewPlan("private");
  const done = await wait(service.startAnalysis("private", prepared.token).id);
  assert.equal(done.state, "complete");
  assert.equal(calls, 1);
  const context = service.evidenceContext(
    "private",
    saved.id,
    0,
    "romantic_interest",
    "support",
  );
  assert.equal(context.available, true);
  assert.deepEqual(context.targetIds, ["local-0"]);
  assert.equal(media.get("local-2").reviewed, true);
  assert.equal(calls, 1);
});
test("chronological evidence digest exposes both supporting and counter segments instead of only the latest row", async () => {
  const React = await import("react"),
    { renderToStaticMarkup } = await import("react-dom/server");
  const { MetricEvidenceDigest } = await import("../src/ui/insights");
  const segment = (i: number, support: boolean, counter: boolean) => ({
    index: i,
    first: 100 + i,
    last: 100 + i,
    result: {
      metrics: {
        romantic_interest: {
          score: 20,
          quality: "limited",
          support: support ? { messages: [] } : null,
          counter: counter ? { messages: [] } : null,
        },
      },
    },
  });
  const a = {
    messageCount: 4,
    segments: [segment(0, true, false), segment(1, false, true)],
  } as any;
  const html = renderToStaticMarkup(
    React.createElement(MetricEvidenceDigest, {
      analysis: a,
      metric: "romantic_interest",
      onSelect: () => {},
    }),
  );
  assert.ok(html.includes("支持"));
  assert.ok(html.includes("反证"));
  assert.ok(html.includes("第 1 段"));
  assert.ok(html.includes("第 2 段"));
});
test("mutual interaction evaluation supports its own option space and absent interaction false positives", async () => {
  const { parseEvaluationDataset } = await import("../evaluation/independent");
  const { evaluatePredictions } = await import("../evaluation/scoring");
  const c = {
    id: "mutual",
    split: "holdout",
    category: "普通礼貌",
    reason: "authored",
    messages: [{ speaker: "Me", text: "谢谢" }],
    expected: { interaction_affection: ["not_observed"] },
  } as any;
  assert.equal(
    parseEvaluationDataset({ dataType: "authored-synthetic", cases: [c] }).cases
      .length,
    1,
  );
  const r = evaluatePredictions(
    [c],
    [
      {
        id: "mutual",
        behaviors: {
          interaction_affection: {
            choice: "mutual",
            probabilities: {
              mutual: 1,
              one_sided_me: 0,
              one_sided_other: 0,
              declined: 0,
              not_observed: 0,
              unclear: 0,
            },
          },
        },
      },
    ],
  );
  assert.equal(r.falsePositive, 1);
  assert.equal(r.calibration.labels, 1);
  assert.ok(r.calibration.brier! > 1.9);
});
