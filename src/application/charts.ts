import type { ChartData, Message, ReadRange } from "../domain/types";
export function chartData(messages: Message[], range?: ReadRange): ChartData {
  const daily = new Map<string, { date: string; me: number; other: number }>();
  const weekdayHourly = Array.from({ length: 168 }, (_, i) => ({
    weekday: Math.floor(i / 24),
    hour: i % 24,
    me: 0,
    other: 0,
  }));
  const hourly = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    me: 0,
    other: 0,
  }));
  const replies = [
    "< 1 分钟",
    "1–5 分钟",
    "5–30 分钟",
    "30–120 分钟",
    "2–6 小时",
  ].map((label) => ({ label, me: 0, other: 0 }));
  const sorted = [...messages].sort((a, b) => a.timestamp - b.timestamp);
  sorted.forEach((m, i) => {
    if (m.sender === "unknown") return;
    const date = new Date(m.timestamp * 1000);
    const day = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
    ].join("-");
    const row = daily.get(day) || { date: day, me: 0, other: 0 };
    row[m.sender]++;
    daily.set(day, row);
    hourly[date.getHours()][m.sender]++;
    weekdayHourly[((date.getDay() + 6) % 7) * 24 + date.getHours()][m.sender]++;
    const previous = sorted[i - 1],
      gap = previous ? m.timestamp - previous.timestamp : 0;
    if (
      previous &&
      previous.sender !== "unknown" &&
      previous.sender !== m.sender &&
      gap >= 0 &&
      gap < 21600
    ) {
      const bucket =
        gap < 60 ? 0 : gap < 300 ? 1 : gap < 1800 ? 2 : gap < 7200 ? 3 : 4;
      replies[bucket][m.sender]++;
    }
  });
  if (range) {
    const start = range.since ?? sorted[0]?.timestamp;
    if (start !== undefined) {
      const day = new Date(start * 1000),
        end = new Date(range.until * 1000);
      day.setHours(0, 0, 0, 0);
      end.setHours(0, 0, 0, 0);
      for (
        let count = 0;
        day <= end && count < 30000;
        count++, day.setDate(day.getDate() + 1)
      ) {
        const key = [
          day.getFullYear(),
          String(day.getMonth() + 1).padStart(2, "0"),
          String(day.getDate()).padStart(2, "0"),
        ].join("-");
        if (!daily.has(key)) daily.set(key, { date: key, me: 0, other: 0 });
      }
    }
  }
  return {
    weekdayHourly,
    daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
    hourly,
    replies,
  };
}
