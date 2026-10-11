import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import type {
  Contact,
  Conversation,
  Message,
  WechatReader,
  PageQuery,
  MessagePage,
} from "../domain/types";
const exec = promisify(execFile);
export type Runner = (args: string[], signal?: AbortSignal) => Promise<string>;
export function createGreenBubblesRunner(
  executable = process.env.GREENBUBBLES_BIN || "/opt/homebrew/bin/greenbubbles",
): Runner {
  return async (args, signal) => {
    try {
      return (
        await exec(executable, args, {
          signal,
          timeout: 60000,
          maxBuffer: 16 * 1024 * 1024,
        })
      ).stdout;
    } catch (error) {
      let code = "reader_unavailable";
      try {
        const out = JSON.parse(String((error as { stdout?: string }).stdout));
        code = z.object({ error: z.object({ code: z.string() }) }).parse(out)
          .error.code;
      } catch {}
      throw new ReaderError(code);
    }
  };
}
class ReaderError extends Error {
  constructor(public code: string) {
    super("GreenBubbles 无法读取：检查安装、数据库密钥与兼容性。");
  }
}
const contact = z.object({
  id: z.string(),
  displayName: z.string(),
  kind: z.string(),
  isAccountHolder: z.boolean(),
  remark: z.string().optional(),
  nickname: z.string().optional(),
  alias: z.string().optional(),
});
const conversation = z.object({
  id: z.string(),
  displayName: z.string().optional(),
  sortTimestamp: z.number(),
});
const message = z.object({
  id: z.string(),
  conversationId: z.string(),
  sender: z.string(),
  createdAtUnix: z.number(),
  messageType: z.number(),
  content: z.unknown(),
  contentDecodeState: z.string(),
  contentTruncated: z.boolean(),
});
const envelope = z.object({
  schema: z.literal("greenbubbles.query.v1"),
  formatVersion: z.literal(1),
  source: z.object({ identity: z.string() }),
  ok: z.literal(true),
  items: z.array(z.unknown()),
  page: z.object({ hasMore: z.boolean(), nextCursor: z.string().optional() }),
  warnings: z.array(z.object({ code: z.string() })),
  consistency: z.object({
    coverageComplete: z.boolean(),
    crossDatabaseAtomic: z.boolean().optional(),
  }),
});
export class GreenBubblesAdapter implements WechatReader {
  private contacts: Contact[] = [];
  private contactLoad?: Promise<Contact[]>;
  private sourceIdentity: string | null = null;
  private verifySource(identity: string) {
    if (this.sourceIdentity && this.sourceIdentity !== identity)
      throw new Error("微信账号或数据源已改变，请重启应用以避免混合记录");
    this.guardSource(identity);
    this.sourceIdentity = identity;
  }
  constructor(
    private run: Runner = createGreenBubblesRunner(),
    private guardSource: (identity: string) => void = () => {},
    private voiceReader?: (
      id: string,
      messageId: string,
      output: string,
      signal?: AbortSignal,
    ) => Promise<string>,
    private imageReader?: (
      id: string,
      messageId: string,
      output: string,
      signal?: AbortSignal,
    ) => Promise<string>,
  ) {}
  materializeImage(
    id: string,
    messageId: string,
    output: string,
    signal?: AbortSignal,
  ) {
    if (
      !this.imageReader ||
      !this.contacts.some((c) => c.id === id && c.kind === "person" && !c.isMe)
    )
      throw new Error("图片读取不可用");
    return this.imageReader(id, messageId, output, signal);
  }
  materializeVoice(
    id: string,
    messageId: string,
    output: string,
    signal?: AbortSignal,
  ) {
    if (!this.voiceReader) throw new Error("语音提取尚未配置");
    if (
      !this.contacts.some((c) => c.id === id && c.kind === "person" && !c.isMe)
    )
      throw new Error("仅支持已识别单聊");
    return this.voiceReader(id, messageId, output, signal);
  }
  async detect() {
    try {
      const v = z
        .object({
          source: z.object({ identity: z.string() }),
          ok: z.literal(true),
          databaseCount: z.number().positive(),
        })
        .parse(JSON.parse(await this.run(["source", "status"])));
      this.verifySource(v.source.identity);
      return {
        readable: v.ok,
        code: "ready",
        detail: "本机微信数据库可读；仅显示已识别的单聊。",
      };
    } catch (error) {
      return {
        readable: false,
        code: error instanceof ReaderError ? error.code : "reader_unavailable",
        detail:
          error instanceof ReaderError && error.code === "invalidProfile"
            ? "GreenBubbles 已安装；微信数据库配置或凭据未就绪（invalidProfile）。请按官方指南完成本机设置。"
            : "未能打开 GreenBubbles 数据源。请检查 CLI、配置和本机密钥设置。",
      };
    }
  }
  private async pages(args: string[]) {
    const items: unknown[] = [];
    let cursor: string | undefined;
    const seen = new Set<string>();
    for (let page = 0; page < 100; page++) {
      const data = envelope.parse(
        JSON.parse(
          await this.run([
            ...args,
            "--limit",
            "500",
            ...(cursor ? ["--cursor", cursor] : []),
          ]),
        ),
      );
      this.verifySource(data.source.identity);
      const onlyMissingNames =
        args[0] === "chats" &&
        data.warnings.length > 0 &&
        data.warnings.every((w) =>
          [
            "contactDisplayNameUnresolved",
            "contactEnrichmentUnavailable",
          ].includes(w.code),
        );
      if (
        (!data.consistency.coverageComplete && !onlyMissingNames) ||
        data.warnings.some(
          (w) =>
            ![
              "contactDisplayNameUnresolved",
              "contactEnrichmentUnavailable",
            ].includes(w.code),
        )
      )
        throw new Error(
          "读取结果不完整，暂不分析。请检查 GreenBubbles 兼容性。",
        );
      items.push(...data.items);
      if (!data.page.hasMore) return items;
      cursor = data.page.nextCursor;
      if (!cursor || seen.has(cursor)) throw new Error("无效分页游标");
      seen.add(cursor);
    }
    throw new Error("分页超限，未显示不完整联系人列表");
  }
  async listContacts() {
    if (this.contacts.length) return this.contacts;
    if (this.contactLoad) return this.contactLoad;
    this.contactLoad = this.loadContacts();
    try {
      return await this.contactLoad;
    } finally {
      this.contactLoad = undefined;
    }
  }
  private async loadContacts() {
    this.contacts = (await this.pages(["contacts", "list", "--details"])).map(
      (row) => {
        const c = contact.parse(row);
        return {
          id: c.id,
          displayName: c.displayName,
          aliases: [c.id, c.displayName, c.nickname, c.remark, c.alias].filter(
            (x): x is string => !!x,
          ),
          isMe: c.isAccountHolder,
          kind: c.kind,
        };
      },
    );
    return this.contacts;
  }
  async listConversations() {
    await this.listContacts();
    const people = new Map(
      this.contacts
        .filter(
          (c) => c.kind === "person" && !c.isMe && !c.id.endsWith("@chatroom"),
        )
        .map((c) => [c.id, c]),
    );
    return (await this.pages(["chats"]))
      .map((row) => conversation.parse(row))
      .filter((c) => people.has(c.id))
      .map((c) => ({
        id: c.id,
        displayName: people.get(c.id)!.displayName,
        updatedAt: c.sortTimestamp,
      }));
  }
  async getMessages(id: string, limit = 200) {
    return (await this.getMessagePage(id, { limit })).messages;
  }
  async getMessagePage(id: string, query: PageQuery): Promise<MessagePage> {
    if (!this.contacts.length) await this.listContacts();
    if (
      !this.contacts.some(
        (c) => c.id === id && c.kind === "person" && !c.isMe,
      ) ||
      id.endsWith("@chatroom")
    )
      throw new Error("仅支持已识别的单聊");
    const me = this.contacts.find((c) => c.isMe)?.id;
    if (!me) throw new Error("无法确认自己的身份，停止读取分析");
    const data = envelope.parse(
      JSON.parse(
        await this.run(
          [
            "messages",
            "list",
            "--conversation",
            id,
            "--limit",
            String(Math.min(500, Math.max(1, query.limit))),
            ...(query.since === undefined
              ? []
              : ["--since", String(query.since)]),
            ...(query.until === undefined
              ? []
              : ["--until", String(query.until)]),
            ...(query.cursor ? ["--cursor", query.cursor] : []),
            "--json",
          ],
          query.signal,
        ),
      ),
    );
    this.verifySource(data.source.identity);
    if (!data.consistency.coverageComplete || data.warnings.length)
      throw new Error("聊天读取不完整，暂不分析");
    const messages = data.items
      .map((row) => {
        const m = message.parse(row);
        if (m.conversationId !== id)
          throw new Error("读取返回了其他会话，已停止");
        const text = z.object({ Text: z.string() }).safeParse(m.content);
        return {
          id: m.id,
          conversationId: id,
          sender:
            m.sender === me ? "me" : m.sender === id ? "other" : "unknown",
          timestamp: m.createdAtUnix,
          text:
            m.messageType === 1 &&
            text.success &&
            m.contentDecodeState === "complete" &&
            !m.contentTruncated
              ? text.data.Text
              : m.contentDecodeState !== "complete" || m.contentTruncated
                ? "[消息正文解码不完整]"
                : m.messageType === 34
                  ? "[语音 · 尚未转写]"
                  : m.messageType === 47
                    ? "[表情贴图 · 尚未识别画面含义]"
                    : m.messageType === 3
                      ? "[图片]"
                      : m.messageType === 43
                        ? "[视频]"
                        : m.messageType === 49
                          ? "[引用或其他富文本消息]"
                          : "[暂不支持的消息类型]",
          kind:
            m.messageType === 1 &&
            text.success &&
            m.contentDecodeState === "complete" &&
            !m.contentTruncated
              ? "text"
              : m.contentDecodeState !== "complete" || m.contentTruncated
                ? "unsupported"
                : m.messageType === 34
                  ? "voice"
                  : m.messageType === 47
                    ? "emoji"
                    : m.messageType === 3
                      ? "image"
                      : m.messageType === 43
                        ? "video"
                        : m.messageType === 49
                          ? "rich"
                          : "unsupported",
        } as Message;
      })
      .sort((a, b) => a.timestamp - b.timestamp);
    return {
      messages,
      hasMore: data.page.hasMore,
      nextCursor: data.page.nextCursor,
      crossDatabaseAtomic: data.consistency.crossDatabaseAtomic === true,
    };
  }
}
