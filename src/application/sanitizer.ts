import type { Contact, Message, Preview } from "../domain/types";
// Only whitelisted text observations cross the boundary; never raw media, XML, IDs or paths.
export function sanitize(
  messages: Message[],
  contacts: Contact[],
  personId?: string,
): Preview & {
  truncated: number;
  timestamps: number[];
  messageIds: string[];
  modalities: Record<string, number>;
} {
  const aliases = contacts
    .flatMap((c) =>
      c.aliases.map((alias) => ({
        alias,
        replacement: c.isMe
          ? "Me"
          : !personId || c.id === personId
            ? "Person A"
            : "[联系人]",
      })),
    )
    .filter((x) => x.alias.length > 0)
    .sort((a, b) => b.alias.length - a.alias.length);
  let omitted = 0;
  let truncated = 0;
  const timestamps: number[] = [];
  const messageIds: string[] = [];
  let semanticCount = 0;
  const modalities: Record<string, number> = {};
  const replacements = new Map(
    aliases.map((x) => [x.alias.normalize("NFKC"), x.replacement]),
  );
  const escapedAliases = [...replacements.keys()].map((value) =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  const aliasPattern = escapedAliases.length
    ? new RegExp(escapedAliases.join("|"), "g")
    : null;
  const lines = messages
    .filter((m) => {
      const ok =
        ["text", "voice", "emoji", "image", "video", "rich"].includes(m.kind) &&
        m.sender !== "unknown";
      if (!ok) omitted++;
      return ok;
    })
    .map((m) => {
      const hasContent =
        m.kind === "text" ||
        (m.kind === "voice" && !!m.transcript) ||
        (m.kind === "image" &&
          m.media?.status === "recognized" &&
          !!m.media.text);
      const source =
        m.kind === "text"
          ? m.text
          : m.kind === "voice"
            ? m.transcript
              ? `[语音${m.transcriptReviewed ? "人工核对" : "自动转写，可能有误"}；不含语气] ${m.transcript}`
              : "[语音缺失或未转写；内容未知]"
            : m.kind === "image"
              ? m.media?.status === "recognized"
                ? `[图片OCR；${m.media.reviewed ? "人工核对" : "可能有误"}；属于图片内文字，不是发送者陈述] ${m.media.text}`
                : "[图片内容未知；未获得可用文字，不能推断画面]"
              : m.kind === "emoji"
                ? "[表情贴图；画面含义未知，不能推断情绪或暧昧]"
                : m.kind === "video"
                  ? "[视频内容未知]"
                  : "[富文本内容未完整识别]";
      let text = source.normalize("NFKC");
      if (aliasPattern)
        text = text.replace(aliasPattern, (match) => replacements.get(match)!);
      text = text
        .replace(/https?:\/\/\S+|www\.\S+/gi, "[链接]")
        .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[邮箱]")
        .replace(/wxid_[A-Za-z0-9_-]+/gi, "[微信ID]")
        .replace(
          /(?:微信|wechat|手机号|电话|昵称|姓名|真实姓名|身份证|账号|帐号)\s*[:：=]\s*[^\s，。；,;]+/gi,
          "[个人信息]",
        );
      text = text
        .replace(/(?:\+?\d[\d ()-]{5,}\d|\b\d{6,}[Xx]?\b)/g, "[号码]")
        .replace(
          /(?:file:\/\/|\/Users\/|\/Volumes\/|\/private\/|\/tmp\/|\/home\/|[A-Za-z]:[\\/])[^\s，。；]+/g,
          "[路径]",
        )
        .replace(/(?:^|\s)\/(?:[^\s/]+\/)+[^\s]*/g, " [路径]");
      if (text.includes("<") || text.includes(">")) {
        omitted++;
        return null;
      }
      if (text.length > 2000) truncated++;
      if (hasContent) semanticCount++;
      modalities[m.kind] = (modalities[m.kind] ?? 0) + 1;
      if (m.kind === "image" && hasContent)
        modalities.image_ocr = (modalities.image_ocr ?? 0) + 1;
      if (m.kind === "voice" && hasContent)
        modalities.voice_transcript = (modalities.voice_transcript ?? 0) + 1;
      if (!hasContent)
        modalities.unknown_content = (modalities.unknown_content ?? 0) + 1;
      timestamps.push(m.timestamp);
      messageIds.push(m.id);
      return {
        speaker: m.sender === "me" ? "Me" : "Person A",
        text: text.slice(0, 2000),
        ...(m.kind !== "text"
          ? {
              modality: m.kind,
              contentStatus: hasContent ? "derived_text" : "unknown",
            }
          : {}),
      };
    })
    .filter(Boolean);
  if (!semanticCount)
    throw new Error(
      "没有可分析的文字、语音转写或图片OCR；附件占位不能用于判断",
    );
  return {
    state: JSON.stringify({ messages: lines }),
    messageCount: lines.length,
    omitted,
    truncated,
    modalities,
    timestamps,
    messageIds,
  };
}
