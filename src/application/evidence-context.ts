import type {
  AnalysisSegment,
  EvidenceExcerpt,
  EvidenceContext,
  Message,
} from "../domain/types";
export function locateEvidence(
  messages: Message[],
  segment: AnalysisSegment | undefined,
  excerpt: EvidenceExcerpt | null | undefined,
): EvidenceContext {
  const unavailable = (detail: string): EvidenceContext => ({
    available: false,
    detail,
    messages: [],
    targetIds: [],
  });
  if (!excerpt || !segment?.messageIds)
    return unavailable(
      "该旧报告没有本机定位映射；可查看已保存的匿名片段，重新分析后可定位原文。",
    );
  if (
    !Number.isInteger(excerpt.targetStart) ||
    !Number.isInteger(excerpt.targetEnd) ||
    excerpt.targetStart < 0 ||
    excerpt.targetEnd <= excerpt.targetStart ||
    excerpt.targetEnd > segment.messageIds.length
  )
    return unavailable("证据范围无效，未猜测位置。");
  const ids = segment.messageIds.slice(excerpt.targetStart, excerpt.targetEnd);
  const sorted = messages.slice().sort((a, b) => a.timestamp - b.timestamp);
  const byId = new Map(sorted.map((m, i) => [m.id, i]));
  if (ids.some((id) => !byId.has(id)))
    return unavailable("原文不在当前已读范围，请读取原分析日期范围后重试。");
  const positions = ids.map((id) => byId.get(id)!);
  const start = Math.max(0, Math.min(...positions) - 4),
    end = Math.min(sorted.length, Math.max(...positions) + 5);
  return {
    available: true,
    detail:
      "仅在本机定位；高亮为 Jev 所选片段范围，范围内每句话不一定都是证据。",
    messages: sorted.slice(start, end),
    targetIds: ids,
  };
}
