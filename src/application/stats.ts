import type { Message, Stats, SideStats } from "../domain/types";
export function statistics(
  messages: Message[],
  now = Date.now() / 1000,
): Stats {
  const side = (): SideStats => ({
    count: 0,
    starts: 0,
    avgReplySeconds: null,
    medianReplySeconds: null,
    p90ReplySeconds: null,
    replySamples: 0,
    avgLength: 0,
  });
  const result: Stats = {
    me: side(),
    other: side(),
    recent7Days: 0,
    activeDays7: 0,
    sampleCount: messages.length,
  };
  const lengths = { me: 0, other: 0 },
    textCount = { me: 0, other: 0 },
    replies = { me: [] as number[], other: [] as number[] },
    days = new Set<string>();
  const activeDates = new Set<string>();
  const sorted = [...messages].sort((a, b) => a.timestamp - b.timestamp);
  sorted.forEach((m, i) => {
    if (m.sender === "unknown") return;
    const s = m.sender,
      previous = sorted[i - 1];
    result[s].count++;
    const date = new Date(m.timestamp * 1000);
    activeDates.add(
      [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0"),
      ].join("-"),
    );
    if (m.kind === "text" || (m.kind === "voice" && m.transcript)) {
      lengths[s] += [...(m.kind === "voice" ? m.transcript! : m.text)].length;
      textCount[s]++;
    }
    // A new session starts after 6h silence; first message is left-censored and not counted.
    if (previous && m.timestamp - previous.timestamp >= 21600)
      result[s].starts++;
    if (
      previous &&
      previous.sender !== "unknown" &&
      previous.sender !== s &&
      m.timestamp >= previous.timestamp &&
      m.timestamp - previous.timestamp < 21600
    )
      replies[s].push(m.timestamp - previous.timestamp);
    if (m.timestamp >= now - 7 * 86400 && m.timestamp <= now) {
      result.recent7Days++;
      days.add(new Date(m.timestamp * 1000).toLocaleDateString("en-CA"));
    }
  });
  for (const s of ["me", "other"] as const) {
    const samples = replies[s].sort((a, b) => a - b);
    result[s].replySamples = samples.length;
    const middle = Math.floor(samples.length / 2);
    result[s].medianReplySeconds = samples.length
      ? samples.length % 2
        ? samples[middle]
        : (samples[middle - 1] + samples[middle]) / 2
      : null;
    result[s].p90ReplySeconds = samples.length
      ? samples[Math.ceil(samples.length * 0.9) - 1]
      : null;
    result[s].avgLength = textCount[s] ? lengths[s] / textCount[s] : 0;
    result[s].avgReplySeconds = replies[s].length
      ? replies[s].reduce((a, b) => a + b, 0) / replies[s].length
      : null;
  }
  result.activeDays7 = days.size;
  result.sessions =
    result.me.count + result.other.count
      ? 1 + result.me.starts + result.other.starts
      : 0;
  result.activeDays = activeDates.size;
  let run = 0,
    longest = 0,
    previousDay: number | undefined;
  for (const key of [...activeDates].sort()) {
    const day = Date.parse(key + "T00:00:00Z") / 86400000;
    run = previousDay !== undefined && day - previousDay === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    previousDay = day;
  }
  result.longestActiveStreak = longest;
  return result;
}
