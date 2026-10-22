import React from "react";
import { metricLabels, type View } from "../domain/types";
export function reportSnapshot(view: View) {
  const a = view.analysis;
  const reviewCount = a
    ? Object.keys(metricLabels).filter(
        (id) =>
          a.metrics[id as keyof typeof metricLabels]?.quality !== "sufficient",
      ).length
    : 0;
  if (!a)
    return {
      tone: "empty",
      title: "尚未生成 Jev 报告",
      detail:
        "本机统计可以直接查看。准备好后，点击顶部「用 Jev 判断」预览并确认。",
      reviewCount,
    };
  if (a.status === "partial")
    return {
      tone: "partial",
      title: "报告尚未完整完成",
      detail: "当前只保存了部分分段；不能代表所选范围的完整分析。",
      reviewCount,
    };
  const current = view.coverage?.range,
    saved = a.range;
  if (
    current &&
    saved &&
    (current.since !== saved.since || current.until !== saved.until)
  )
    return {
      tone: "different-range",
      title: "报告与当前读取范围不同",
      detail:
        "下方分数属于已保存范围，当前统计属于本次读取。需要新范围报告时，请手动预览并确认分析。",
      reviewCount,
    };
  const count = a.inputCoverage?.total;
  if (count !== undefined && view.coverage && count !== view.coverage.count)
    return {
      tone: "different-content",
      title: "已读消息数量与报告快照不同",
      detail: "新增读取内容尚未反映在旧分数中。需要更新时，请手动确认新分析。",
      reviewCount,
    };
  return {
    tone: "saved",
    title: "正在查看已保存报告",
    detail:
      "报告是确认分析时的文字快照；后续转写和人工修改不会自动更新旧分数。",
    reviewCount,
  };
}
export function ReportStatus({ view }: { view: View }) {
  const status = reportSnapshot(view),
    a = view.analysis;
  return (
    <section
      className={"report-status report-status-" + status.tone}
      aria-label="报告状态"
    >
      <div>
        <strong>{status.title}</strong>
        <p>{status.detail}</p>
      </div>
      <dl>
        <div>
          <dt>报告范围</dt>
          <dd>{a?.range?.label ?? (a ? "旧版未记录" : "尚无报告")}</dd>
        </div>
        <div>
          <dt>分析时间</dt>
          <dd>{a ? new Date(a.createdAt).toLocaleString() : "—"}</dd>
        </div>
        <div>
          <dt>需要复核</dt>
          <dd>{a ? `${status.reviewCount} / 5 项` : "—"}</dd>
        </div>
      </dl>
    </section>
  );
}
