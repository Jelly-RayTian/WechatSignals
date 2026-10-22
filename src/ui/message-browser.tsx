import React, { useEffect, useRef, useState } from "react";
import type {
  Message,
  MessageSearchQuery,
  MessageSearchResult,
  ReadCoverage,
} from "../domain/types";
export function MessageBrowser({
  conversationId,
  revision,
  coverage,
  search,
  renderMessage,
}: {
  conversationId: string;
  revision: string;
  coverage?: ReadCoverage;
  search: (
    id: string,
    query: MessageSearchQuery,
  ) => Promise<MessageSearchResult>;
  renderMessage: (message: Message) => React.ReactNode;
}) {
  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "f" &&
        !document.querySelector(".overlay")
      ) {
        event.preventDefault();
        searchInput.current?.focus();
        searchInput.current?.select();
      }
    };
    document.addEventListener("keydown", focusSearch);
    return () => document.removeEventListener("keydown", focusSearch);
  }, []);
  const [text, setText] = useState(""),
    [sender, setSender] = useState<MessageSearchQuery["sender"]>("all"),
    [kind, setKind] = useState<MessageSearchQuery["kind"]>("all"),
    [offset, setOffset] = useState(0);
  const [result, setResult] = useState<MessageSearchResult | null>(null),
    [loading, setLoading] = useState(true),
    [failed, setFailed] = useState(false),
    [retry, setRetry] = useState(0),
    [composing, setComposing] = useState(false);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setFailed(false);
    if (composing)
      return () => {
        active = false;
      };
    const timer = setTimeout(
      () => {
        search(conversationId, { text, sender, kind, offset })
          .then((next) => {
            if (active) {
              setResult(next);
              setLoading(false);
            }
          })
          .catch(() => {
            if (active) {
              setFailed(true);
              setLoading(false);
              setResult(null);
            }
          });
      },
      text ? 250 : 0,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [
    conversationId,
    revision,
    text,
    sender,
    kind,
    offset,
    search,
    retry,
    composing,
  ]);
  const reset = () => {
    setText("");
    setSender("all");
    setKind("all");
    setOffset(0);
  };
  const filtered = !!text || sender !== "all" || kind !== "all";
  const goToPage = (nextOffset: number) => {
    setOffset(nextOffset);
    searchInput.current?.scrollIntoView({
      block: "center",
      behavior: "instant",
    });
  };
  return (
    <section className="message-browser" aria-label="本机聊天检索">
      <div className="message-search-toolbar">
        <label className="message-query">
          搜索聊天文字
          <input
            ref={searchInput}
            type="search"
            maxLength={200}
            placeholder="搜索正文、语音转写、图片文字"
            value={text}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={() => setComposing(false)}
            onChange={(e) => {
              setText(e.target.value);
              setOffset(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape" && !e.nativeEvent.isComposing) {
                reset();
                e.preventDefault();
                e.stopPropagation();
              }
            }}
          />
        </label>
        <label>
          发送者
          <select
            value={sender}
            onChange={(e) => {
              setSender(e.target.value as MessageSearchQuery["sender"]);
              setOffset(0);
            }}
          >
            <option value="all">双方全部</option>
            <option value="me">我</option>
            <option value="other">对方</option>
            <option value="unknown">未知发送者</option>
          </select>
        </label>
        <label>
          消息类型
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as MessageSearchQuery["kind"]);
              setOffset(0);
            }}
          >
            {Object.entries({
              all: "全部类型",
              text: "文字",
              voice: "语音",
              image: "图片",
              emoji: "表情贴图",
              video: "视频",
              rich: "分享内容",
              unsupported: "其他",
            }).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {filtered && <button onClick={reset}>清空筛选</button>}
      </div>
      <div className="message-scope">
        <p>
          仅搜索「{coverage?.range.label ?? "当前"}」已读范围 · 最新消息在前 ·
          每页 50 条。关键词不上传，不调用 Jev。
        </p>
        {!coverage?.complete && (
          <p className="message-incomplete">
            仍有未读取或未确认的历史，搜索结果不代表全部聊天记录。
          </p>
        )}
      </div>
      <div className="message-result-bar" role="status" aria-live="polite">
        {loading
          ? "正在本机检索…"
          : failed
            ? "检索未完成"
            : result
              ? `匹配 ${result.total.toLocaleString()} / 已读 ${result.scanned.toLocaleString()} 条`
              : ""}
      </div>
      {failed ? (
        <div className="empty">
          <p>无法读取本机搜索结果；请确认已读取会话。</p>
          <button onClick={() => setRetry((n) => n + 1)}>重试检索</button>
        </div>
      ) : loading ? (
        <div className="message-search-loading" aria-busy="true">
          <div className="skeleton-line" />
          <div className="skeleton-line short" />
        </div>
      ) : result?.total === 0 ? (
        <div className="empty">
          <h3>没有匹配的聊天</h3>
          <p>
            可以更换关键词或清空筛选。未转写语音和无文字图片无法按内容匹配。
          </p>
          {filtered && <button onClick={reset}>显示全部已读消息</button>}
        </div>
      ) : (
        <div className="messages">{result?.messages.map(renderMessage)}</div>
      )}
      {result && result.total > 0 && !loading && (
        <nav className="message-pagination" aria-label="聊天结果分页">
          <button
            disabled={result.offset === 0}
            onClick={() => goToPage(Math.max(0, result.offset - result.limit))}
          >
            上一页
          </button>
          <span>
            第 {Math.floor(result.offset / result.limit) + 1} /{" "}
            {Math.ceil(result.total / result.limit)} 页 · {result.offset + 1}–
            {Math.min(result.total, result.offset + result.limit)} 条
          </span>
          <button
            disabled={result.offset + result.limit >= result.total}
            onClick={() => goToPage(result.offset + result.limit)}
          >
            下一页
          </button>
        </nav>
      )}
    </section>
  );
}
