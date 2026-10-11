import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MetricReport } from "../src/ui/report";
import { metricLabels } from "../src/domain/types";
const result: any = {
  id: "s",
  rubricVersion: "behavior-v5-interest",
  metrics: Object.fromEntries(
    Object.keys(metricLabels).map((k) => [
      k,
      {
        score: 75,
        quality: k === "flirting" ? "insufficient" : "limited",
        confidence: null,
      },
    ]),
  ),
  messageCount: 10,
};
const view: any = {
  analysis: { ...result, segments: [{ index: 0, first: 1, last: 2, result }] },
};
test("detailed report includes comparison and interactive quality matrix without scoring missing results", () => {
  const html = renderToStaticMarkup(
    React.createElement(MetricReport, { view }),
  );
  assert.ok(html.includes("五项信号对比"));
  assert.ok(html.includes("分段信号矩阵"));
  assert.ok(html.includes("查看暧昧信号第1段：无法评价"));
  assert.ok(!html.includes("查看暧昧信号第1段：75"));
});
test("report explains selected metric in concrete observable terms", () => {
  const html = renderToStaticMarkup(
    React.createElement(MetricReport, { view }),
  );
  assert.ok(html.includes("如何理解好感信号"));
  assert.ok(html.includes("普通朋友也会关心和约活动"));
  assert.ok(html.includes("需要核对的地方"));
});
