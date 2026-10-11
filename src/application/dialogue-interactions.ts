import type { Message } from "../domain/types";
// Observable turn-taking only: replies do not imply agreement, romance or support.
export function dialogueInteractions(messages: Message[], until: number) {
  const side = () => ({
    started: 0,
    receivedReply: 0,
    unanswered: 0,
    pending: 0,
    turns: 0,
  });
  const result = {
    sessions: 0,
    bilateralSessions: 0,
    leftCensored: 0,
    me: side(),
    other: side(),
  };
  const sorted = messages
    .filter((m) => m.sender !== "unknown" && m.timestamp <= until)
    .slice()
    .sort((a, b) => a.timestamp - b.timestamp);
  const sessions: Message[][] = [];
  for (const m of sorted) {
    const last = sessions.at(-1);
    if (!last || m.timestamp - last.at(-1)!.timestamp >= 21600)
      sessions.push([m]);
    else last.push(m);
  }
  result.sessions = sessions.length;
  result.leftCensored = sessions.length ? 1 : 0;
  sessions.forEach((rows, i) => {
    const first = rows[0],
      sender = first.sender as "me" | "other";
    let previous: string | undefined;
    for (const m of rows) {
      if (m.sender !== previous) result[m.sender as "me" | "other"].turns++;
      previous = m.sender;
    }
    const bilateral = rows.some((m) => m.sender !== sender);
    if (bilateral) result.bilateralSessions++;
    if (!i) return; // beginning of selected range does not establish who initiated.
    result[sender].started++;
    if (bilateral) result[sender].receivedReply++;
    else if (until - rows.at(-1)!.timestamp < 21600) result[sender].pending++;
    else result[sender].unanswered++;
  });
  return result;
}
export type DialogueInteractions = ReturnType<typeof dialogueInteractions>;
