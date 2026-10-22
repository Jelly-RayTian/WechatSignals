import { z } from "zod";
import type {
  Message,
  MessageSearchQuery,
  MessageSearchResult,
} from "../domain/types";

// This query operates only on an already loaded local range. No I/O or analysis.
const querySchema = z
  .object({
    text: z.string().max(200).default(""),
    sender: z.enum(["all", "me", "other", "unknown"]).default("all"),
    kind: z
      .enum([
        "all",
        "text",
        "voice",
        "image",
        "emoji",
        "video",
        "rich",
        "unsupported",
      ])
      .default("all"),
    offset: z.number().int().min(0).max(1_000_000).default(0),
  })
  .strict();
const normalize = (text: string) => text.normalize("NFKC").toLocaleLowerCase();
export function searchableText(message: Message) {
  if (message.kind === "voice") return message.transcript ?? "";
  if (message.kind === "image")
    return message.media?.status === "recognized" ? message.media.text : "";
  return message.text;
}
export function searchLoadedMessages(
  messages: Message[],
  input: MessageSearchQuery,
): MessageSearchResult {
  const query = querySchema.parse(input);
  const terms = normalize(query.text).trim().split(/\s+/).filter(Boolean);
  const matches = messages
    .filter((message) => {
      if (query.sender !== "all" && message.sender !== query.sender)
        return false;
      if (query.kind !== "all" && message.kind !== query.kind) return false;
      const text = normalize(searchableText(message));
      return terms.every((term) => text.includes(term));
    })
    .sort((a, b) => b.timestamp - a.timestamp || a.id.localeCompare(b.id));
  const limit = 50;
  const offset = Math.min(
    Math.floor(query.offset / limit) * limit,
    Math.max(0, Math.ceil(matches.length / limit) - 1) * limit,
  );
  return {
    messages: matches.slice(offset, offset + limit),
    total: matches.length,
    scanned: messages.length,
    offset,
    limit,
  };
}
