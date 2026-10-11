import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateSegments,
  repairSavedAggregate,
} from "../src/application/batches";
import { buildRequest, JevAnalysisService } from "../src/infrastructure/jev";
import {
  behaviorDefinitions,
  composeMetrics,
} from "../src/infrastructure/jev-behaviors";
import { metricLabels } from "../src/domain/types";
const secret = {
  get: async () => "synthetic",
  set: async () => {},
  delete: async () => {},
};
const state = JSON.stringify({
  messages: [
    { speaker: "Person A", text: "你今天考试怎么样？我记得你很担心。" },
    { speaker: "Me", text: "顺利，谢谢你记得。" },
  ],
  context: [],
});
function observations(choice = "clear", confidence = 0.7) {
  return Object.fromEntries(
    Object.keys(behaviorDefinitions).map((id) => [
      id,
      {
        choice,
        confidence,
        probabilities: {
          absent: choice === "absent" ? 1 : 0,
          weak: 0,
          clear: choice === "clear" ? 1 : 0,
          strong: 0,
          unclear: choice === "unclear" ? 1 : 0,
        },
      },
    ]),
  );
}
function answers(): Record<string, any> {
  const obs = observations();
  obs.boundary = observations("absent").boundary;
  obs.transaction = observations("absent").transaction;
  return {
    ...Object.fromEntries(["invitation","support","affection"].map(id => ["interaction_"+id,{type:"choice",choice:"unclear",confidence:0.9,probabilities:{mutual:0,one_sided_me:0,one_sided_other:0,declined:0,not_observed:0,unclear:1}}])),
    ...Object.fromEntries(
      Object.entries(obs).map(([id, v]) => [id, { type: "choice", ...v }]),
    ),
    ...Object.fromEntries(
      Object.keys(metricLabels).flatMap((id) => [
        [
          id + "_support",
          {
            type: "choice",
            choice: "p0",
            confidence: 0.2,
            probabilities: { p0: 1, p1: 0, none: 0 },
          },
        ],
        [
          id + "_counter",
          {
            type: "choice",
            choice: "none",
            confidence: 0.8,
            probabilities: { p0: 0, p1: 0, none: 1 },
          },
        ],
      ]),
    ),
  };
}
test("31 reviewable segments do not become no evidence and old scores remain unchanged", () => {
  const segments = Array.from({ length: 31 }, (_, index) => ({
    index,
    first: index,
    last: index,
    result: {
      id: String(index),
      conversationId: "p",
      createdAt: 0,
      model: "jev-test",
      rubricVersion: "behavior-v3-evidence",
      messageCount: 100,
      metrics: Object.fromEntries(
        Object.keys(metricLabels).map((k) => [
          k,
          {
            score: 60,
            confidence: 0.5,
            quality: "limited",
            reviewReasons: ["评分或证据选择的 confidence 偏低或缺失"],
          },
        ]),
      ),
    },
  })) as any;
  const a = aggregateSegments(
    "a",
    "p",
    segments,
    31,
    { until: 100, label: "合成" },
    "complete",
  );
  assert.equal(a.metrics.initiative.score, 60);
  assert.equal(a.metrics.initiative.quality, "limited");
  assert.equal(a.metrics.initiative.summary?.eligibleSegments, 31);
  const original = {
    ...a,
    aggregationVersion: undefined,
    metrics: Object.fromEntries(
      Object.keys(metricLabels).map((k) => [
        k,
        { score: 0, confidence: null, quality: "insufficient" },
      ]),
    ),
  } as any;
  const repaired = repairSavedAggregate(original);
  assert.equal(repaired.metrics.initiative.score, 60);
  assert.equal(original.metrics.initiative.score, 0);
  assert.equal(repaired.createdAt, original.createdAt);
  assert.equal(repaired.segments, original.segments);
});
test("absence is evaluable, genuinely unclear input abstains and boundary constrains romantic interpretation", () => {
  const none = composeMetrics(observations("absent"));
  assert.equal(none.flirting.score, 0);
  assert.notEqual(none.flirting.quality, "insufficient");
  const unknown = composeMetrics(observations("unclear"));
  assert.equal(unknown.flirting.quality, "insufficient");
  const clear = observations("clear");
  clear.boundary = observations("absent").boundary;
  clear.transaction = observations("absent").transaction;
  const without = composeMetrics(clear);
  clear.boundary = observations("clear").boundary;
  const withBoundary = composeMetrics(clear);
  assert.ok(
    withBoundary.romantic_interest.score < without.romantic_interest.score,
  );
});
test("production Jev evaluates 12 literal behaviors plus evidence, does not gate scores on citation confidence", async () => {
  const req = buildRequest(state);
  assert.equal(
    Object.values(req.questions).filter((q) => q.type === "choice").length,
    25,
  );
  assert.ok(req.questions.personal_care.instructions.includes("Person A"));
  assert.ok(Object.keys(req.questions).includes("boundary"));
  const result = await new JevAnalysisService(
    secret,
    async () =>
      new Response(JSON.stringify({ model: "jev-1.13.0", answers: answers() })),
  ).analyze("p", state, 2);
  assert.ok(result.metrics.romantic_interest.score > 0);
  assert.notEqual(result.metrics.romantic_interest.quality, "insufficient");
  assert.equal(
    result.metrics.romantic_interest.support?.messages[0].speaker,
    "Person A",
  );
  assert.ok(result.behaviors);
});
test("optional same-request reversed choices record disagreement without overwriting first judgment", async () => {
  const req = buildRequest(state, "jev-latest", true);
  assert.equal(Object.keys(req.questions).length, 37);
  assert.notDeepEqual(
    Object.keys(req.questions.personal_care.criteria),
    Object.keys(req.questions.personal_care_check.criteria),
  );
  const a = answers();
  for (const id of Object.keys(behaviorDefinitions))
    a[id + "_check"] = { ...a[id] };
  a.personal_care_check = {
    ...a.personal_care,
    choice: "absent",
    probabilities: { absent: 1, weak: 0, clear: 0, strong: 0, unclear: 0 },
  };
  const result = await new JevAnalysisService(
    secret,
    async () =>
      new Response(JSON.stringify({ model: "jev-1.13.0", answers: a })),
    () => "jev-latest",
    () => true,
  ).analyze("p", state, 2);
  assert.equal(result.behaviors?.personal_care.choice, "clear");
  assert.equal(result.behaviors?.personal_care.stable, false);
  assert.equal(result.metrics.romantic_interest.quality, "limited");
});
test("missing behaviors, foreign options and malformed distributions fail closed", async () => {
  for (const kind of ["missing", "foreign", "distribution"]) {
    const a = answers();
    if (kind === "missing") delete a.personal_care;
    else if (kind === "foreign") a.personal_care.choice = "invented";
    else a.personal_care.probabilities = { absent: 0.1 };
    await assert.rejects(() =>
      new JevAnalysisService(
        secret,
        async () =>
          new Response(JSON.stringify({ model: "jev-1.13.0", answers: a })),
      ).analyze("p", state, 2),
    );
  }
});

test("current request remains below conservative HTTP size at full message capacity", () => {
  const large = JSON.stringify({
    context: [],
    messages: Array.from({ length: 200 }, () => ({
      speaker: "Person A",
      text: "合成文字",
    })),
  });
  assert.ok(
    Buffer.byteLength(JSON.stringify(buildRequest(large, "jev-latest", true))) <
      64000,
  );
});

test("production v4 application sends nothing until confirmed and persists zero-signal as evaluable", async () => {
  const { ApplicationService } = await import("../src/application/service");
  const contacts = [
    {
      id: "self",
      displayName: "合成本人",
      aliases: [],
      isMe: true,
      kind: "person",
    },
    {
      id: "other",
      displayName: "合成对方",
      aliases: [],
      isMe: false,
      kind: "person",
    },
  ];
  const rows = [
    {
      id: "s1",
      conversationId: "other",
      sender: "me" as const,
      timestamp: 1,
      text: "文件发你了",
      kind: "text" as const,
    },
    {
      id: "s2",
      conversationId: "other",
      sender: "other" as const,
      timestamp: 2,
      text: "收到，谢谢",
      kind: "text" as const,
    },
  ];
  let calls = 0;
  let saved: any = null;
  const reader = {
    detect: async () => ({
      readable: true,
      code: "ready",
      detail: "synthetic",
    }),
    listContacts: async () => contacts,
    listConversations: async () => [
      { id: "other", displayName: "合成对方", updatedAt: 2 },
    ],
    getMessages: async () => rows,
    getMessagePage: async () => ({
      messages: rows,
      hasMore: false,
      crossDatabaseAtomic: true,
    }),
  };
  const jev = new JevAnalysisService(secret, async (_u, init) => {
    calls++;
    const req = JSON.parse(String(init?.body));
    const result = Object.fromEntries(
      Object.entries(req.questions).map(([id, q]: [string, any]) => [
        id,
        {
          type: "choice",
          choice: id.startsWith("interaction_") ? "not_observed" : !(id in behaviorDefinitions) ? "none" : "absent",
          confidence: 0.9,
          probabilities: Object.fromEntries(
            Object.keys(q.criteria).map((k) => [
              k,
              k === (id.startsWith("interaction_") ? "not_observed" : !(id in behaviorDefinitions) ? "none" : "absent") ? 1 : 0,
            ]),
          ),
        },
      ]),
    );
    return new Response(
      JSON.stringify({ model: "jev-1.13.0", answers: result }),
    );
  });
  const repo = {
    save: (a: any) => {
      saved = a;
    },
    latest: () => saved,
    cacheContacts: () => {},
    cacheMessages: () => {},
  };
  const service = new ApplicationService(reader, jev, repo);
  await service.list();
  const read = service.startRead("other", { until: 3, label: "合成" });
  for (let i = 0; i < 20 && service.job(read.id).state === "running"; i++)
    await new Promise((resolve) => setImmediate(resolve));
  const plan = await service.previewPlan("other");
  assert.equal(calls, 0);
  const job = service.startAnalysis("other", plan.token);
  for (let i = 0; i < 20 && service.job(job.id).state === "running"; i++)
    await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.equal(
    service.job(job.id).state,
    "complete",
    service.job(job.id).detail,
  );
  assert.equal(saved.metrics.initiative.score, 0);
  assert.equal(saved.metrics.initiative.quality, "sufficient");
  assert.ok(saved.segments[0].result.behaviors);
});

test("rounded official distributions cannot push a behavioral index outside 0–100", () => {
  const o = observations("clear");
  for (const row of Object.values(o)) {
    row.choice = "strong";
    row.probabilities = {
      absent: 0,
      weak: 0,
      clear: 0,
      strong: 1.01,
      unclear: 0,
    };
  }
  o.boundary = observations("absent").boundary;
  o.transaction = observations("absent").transaction;
  assert.ok(composeMetrics(o).initiative.score <= 100);
});
