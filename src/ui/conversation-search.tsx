import React, { useState } from "react";
import type { Conversation } from "../domain/types";
export function ConversationSearch({
  chats,
  selected,
  disabled,
  onSelect,
}: {
  chats: Conversation[];
  selected: string;
  disabled: boolean;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const terms = query
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const matches = chats.filter((c) =>
    terms.every((t) =>
      c.displayName.normalize("NFKC").toLocaleLowerCase().includes(t),
    ),
  );
  return (
    <>
      <div className="conversation-search-header">
        <h2>
          单聊会话 <small>{chats.length}</small>
        </h2>
        <label
          className="conversation-search-label"
          htmlFor="conversation-search"
        >
          搜索单聊会话
        </label>
        <div className="conversation-search-control">
          <input
            id="conversation-search"
            type="search"
            className="contact-search"
            aria-label="搜索单聊会话"
            placeholder="输入会话名称"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === "Escape") {
                setQuery("");
                e.preventDefault();
              }
              if (e.key === "Enter" && !disabled && matches.length === 1) {
                onSelect(matches[0].id);
                e.preventDefault();
              }
            }}
          />
          {query && (
            <button
              className="search-clear"
              aria-label="清空会话搜索"
              onClick={() => setQuery("")}
            >
              清空
            </button>
          )}
        </div>
        <small role="status">
          {terms.length
            ? `匹配 ${matches.length} / ${chats.length} 个会话`
            : `共 ${chats.length} 个单聊 · 本机搜索`}
        </small>
      </div>
      {!chats.length && <p>微信连接成功后才显示真实单聊会话。</p>}
      {chats.length > 0 && matches.length === 0 && (
        <p className="note" role="status">
          没有匹配的单聊会话，请更换关键词或清空搜索。
        </p>
      )}
      {matches.map((c) => (
        <button
          key={c.id}
          className={selected === c.id ? "selected" : ""}
          disabled={disabled}
          onClick={() => onSelect(c.id)}
          title={c.displayName}
        >
          {c.displayName}
        </button>
      ))}
    </>
  );
}
