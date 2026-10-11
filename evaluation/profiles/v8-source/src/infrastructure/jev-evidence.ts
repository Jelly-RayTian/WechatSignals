import { z } from "zod";
import type { EvidenceExcerpt } from "../domain/types";
const line = z.object({
  speaker: z.enum(["Me", "Person A"]),
  text: z.string().max(2000),
});
export function evidenceCandidates(
  state: string,
  maximum = 60,
  includeExcerpt = false,
) {
  let messages: z.infer<typeof line>[] = [];
  try {
    messages = z
      .object({ messages: z.array(line).max(200) })
      .parse(JSON.parse(state)).messages;
  } catch {
    /* Legacy non-JSON states have no addressable evidence. */
  }
  const size = Math.max(1, Math.ceil(messages.length / maximum));
  const candidates: Record<string, { start: number; end: number }> = {};
  for (let i = 0; i < messages.length; i += size)
    candidates[`p${Math.floor(i / size)}`] = {
      start: i,
      end: Math.min(messages.length, i + size),
    };
  const criteria = Object.fromEntries(
    Object.entries(candidates).map(([id, c]) => [
      id,
      `messages 中第 ${c.start + 1} 至 ${c.end} 条；结合紧邻上下文判断。${
        includeExcerpt
          ? "片段开头：" +
            messages
              .slice(c.start, c.end)
              .map((m) => m.speaker + ": " + m.text)
              .join(" / ")
              .slice(0, 60)
          : ""
      }`,
    ]),
  );
  const resolve = (id: string): EvidenceExcerpt | null => {
    if (id === "none") return null;
    const c = candidates[id];
    if (!c) throw new Error("Jev 证据选择不属于已发送文本");
    return {
      messages: messages.slice(
        Math.max(0, c.start - 1),
        Math.min(messages.length, c.end + 1),
      ),
      targetStart: c.start,
      targetEnd: c.end,
    };
  };
  return { criteria, resolve };
}
