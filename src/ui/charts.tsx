import React, { useState } from "react";
import { metricLabels, type View, type Metric } from "../domain/types";
function Bars({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; me: number; other: number }[];
}) {
  const max = Math.max(1, ...rows.map((r) => Math.max(r.me, r.other)));
  return (
    <section className="chart">
      <h3>{title}</h3>
      <div className="legend">
        <span>● 我</span>
        <span>● 对方</span>
      </div>
      <div className="bar-scroll">
        {rows.map((r) => (
          <div className="bar-row" key={r.label}>
            <small>{r.label}</small>
            <div className="bar-pair">
              <div
                className="bar me-bar"
                style={{ width: `${(r.me / max) * 100}%` }}
                title={`我：${r.me}`}
              >
                <span>{r.me}</span>
              </div>
              <div
                className="bar other-bar"
                style={{ width: `${(r.other / max) * 100}%` }}
                title={`对方：${r.other}`}
              >
                <span>{r.other}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
export function Dashboard({ view }: { view: View }) {
  const [granularity, setGranularity] = useState("week");
  const [heatSelection, setHeatSelection] = useState(0);
  const daily = view.charts?.daily || [];
  const grouped = new Map<
    string,
    { label: string; me: number; other: number }
  >();
  for (const d of daily) {
    const date = new Date(d.date + "T12:00:00");
    if (granularity === "week")
      date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
    const key =
      granularity === "month"
        ? d.date.slice(0, 7)
        : granularity === "day"
          ? d.date
          : [
              date.getFullYear(),
              String(date.getMonth() + 1).padStart(2, "0"),
              String(date.getDate()).padStart(2, "0"),
            ].join("-");
    const row = grouped.get(key) || { label: key, me: 0, other: 0 };
    row.me += d.me;
    row.other += d.other;
    grouped.set(key, row);
  }
  const count = view.stats.me.count + view.stats.other.count;
  return (
    <div className="dashboard">
      <div className="summary-cards">
        <div>
          <small>已读消息</small>
          <b>{view.coverage?.count ?? view.stats.sampleCount}</b>
        </div>
        <div>
          <small>双方占比</small>
          <b>
            {count ? Math.round((view.stats.me.count / count) * 100) : 0}% /{" "}
            {count ? Math.round((view.stats.other.count / count) * 100) : 0}%
          </b>
          <small>我 / 对方</small>
        </div>
        <div>
          <small>滚动 7 天已读消息</small>
          <b>{view.stats.recent7Days}</b>
          <small>{view.stats.activeDays7} 个活跃日</small>
        </div>
      </div>
      <div className="local-summary">
        <span>会话 {view.stats.sessions ?? "—"} 次</span>
        <span>活跃 {view.stats.activeDays ?? "—"} 天</span>
        <span>最长连续 {view.stats.longestActiveStreak ?? "—"} 天</span>
      </div>
      <section className="chart response-summary">
        <h3>回复时间 · 中位数与样本</h3>
        <div className="reply-comparison">
          {(["me", "other"] as const).map((side) => (
            <div key={side}>
              <small>{side === "me" ? "我" : "对方"}</small>
              <b>
                {view.stats[side].medianReplySeconds === null ||
                view.stats[side].medianReplySeconds === undefined
                  ? "—"
                  : `${Math.round(view.stats[side].medianReplySeconds!)} 秒`}
              </b>
              <span>
                有效样本 {view.stats[side].replySamples ?? 0} · P90{" "}
                {view.stats[side].p90ReplySeconds === null ||
                view.stats[side].p90ReplySeconds === undefined
                  ? "—"
                  : `${Math.round(view.stats[side].p90ReplySeconds!)} 秒`}
              </span>
              {(view.stats[side].replySamples ?? 0) < 10 && (
                <small>样本较少，仅作描述</small>
              )}
            </div>
          ))}
        </div>
      </section>
      <section className="chart heatmap-panel">
        <h3>活跃热力图 · 周 × 小时</h3>
        <small>点击格子查看数量；所有记录在本机统计。</small>
        <div className="heatmap">
          <span></span>
          {Array.from({ length: 24 }, (_, hour) => (
            <small key={hour}>{hour % 4 === 0 ? hour : ""}</small>
          ))}
          {["一", "二", "三", "四", "五", "六", "日"].map((day, weekday) => (
            <React.Fragment key={day}>
              <small>周{day}</small>
              {Array.from({ length: 24 }, (_, hour) => {
                const cell = view.charts?.weekdayHourly?.[weekday * 24 + hour];
                const count = (cell?.me ?? 0) + (cell?.other ?? 0);
                const max = Math.max(
                  1,
                  ...(view.charts?.weekdayHourly ?? []).map(
                    (c) => c.me + c.other,
                  ),
                );
                const ratio = count / max;
                return (
                  <button
                    key={hour}
                    className={
                      heatSelection === weekday * 24 + hour
                        ? "heat-selected"
                        : ""
                    }
                    style={{
                      backgroundColor:
                        count === 0
                          ? "#edf1f4"
                          : ratio < 0.25
                            ? "#c5dfd6"
                            : ratio < 0.6
                              ? "#69aa92"
                              : "#266f59",
                    }}
                    aria-label={`周${day} ${hour}时 ${count}条`}
                    title={`周${day} ${hour}时：我 ${cell?.me ?? 0} / 对方 ${cell?.other ?? 0}`}
                    onClick={() => setHeatSelection(weekday * 24 + hour)}
                  />
                );
              })}
            </React.Fragment>
          ))}
        </div>
        <p className="note">
          周
          {
            ["一", "二", "三", "四", "五", "六", "日"][
              Math.floor(heatSelection / 24)
            ]
          }{" "}
          {heatSelection % 24}:00 · 我{" "}
          {view.charts?.weekdayHourly?.[heatSelection]?.me ?? 0} 条 / 对方{" "}
          {view.charts?.weekdayHourly?.[heatSelection]?.other ?? 0} 条
        </p>
      </section>
      <div className="chart-controls">
        <label>
          聊天频率聚合{" "}
          <select
            value={granularity}
            onChange={(e) => setGranularity(e.target.value)}
          >
            <option value="day">按日</option>
            <option value="week">按周</option>
            <option value="month">按月</option>
          </select>
        </label>
      </div>
      <Bars title="聊天频率" rows={[...grouped.values()]} />
      <div className="chart-grid">
        <Bars
          title="谁更经常开启对话"
          rows={[
            {
              label: "静默 6 小时后开启",
              me: view.stats.me.starts,
              other: view.stats.other.starts,
            },
          ]}
        />
        <Bars
          title="回复时间分布"
          rows={(view.charts?.replies || []).map((r) => ({ ...r }))}
        />
        <Bars
          title="活跃时段（本机时区）"
          rows={(view.charts?.hourly || []).map((r) => ({
            label: String(r.hour).padStart(2, "0") + ":00",
            me: r.me,
            other: r.other,
          }))}
        />
        <Bars
          title="消息数量"
          rows={[
            {
              label: "全部消息",
              me: view.stats.me.count,
              other: view.stats.other.count,
            },
          ]}
        />
      </div>
      <p className="note">
        统计基于已读取范围，未知发送者不计双方统计。新对话按静默 6
        小时定义；范围内首条不计开启。回复时间为跨发送者的相邻消息间隔，不包含超过
        6
        小时的间隔。平均长度包含纯文本和已转写语音。中位数比均值更少受长间隔影响，P90
        表示九成有效回复间隔不超过该值；样本少于10仅提示样本较少。回复速度不能解释为好感。
      </p>
    </div>
  );
}
export function SignalTrend({ view }: { view: View }) {
  const [metric, setMetric] = useState<Metric>("romantic_interest");
  const segments = view.analysis?.segments || [];
  return (
    <section className="chart">
      <h3>分段信号走势</h3>
      <select
        value={metric}
        onChange={(e) => setMetric(e.target.value as Metric)}
      >
        {Object.entries(metricLabels).map(([id, label]) => (
          <option key={id} value={id}>
            {label}
          </option>
        ))}
      </select>
      {segments.length === 0 ? (
        <p className="note">
          尚无真实 Jev 分段结果。不会用本地统计填充 AI 分数。
        </p>
      ) : (
        <>
          <svg
            viewBox="0 0 620 160"
            role="img"
            aria-label={`${metricLabels[metric]}分段走势`}
          >
            <line x1="20" x2="600" y1="140" y2="140" stroke="#ddd" />
            {segments
              .slice(1)
              .map((s, i) =>
                s.result.metrics[metric].quality !== "insufficient" &&
                segments[i].result.metrics[metric].quality !==
                  "insufficient" ? (
                  <line
                    key={s.index}
                    x1={20 + (i * 580) / Math.max(1, segments.length - 1)}
                    y1={140 - segments[i].result.metrics[metric].score * 1.2}
                    x2={20 + ((i + 1) * 580) / Math.max(1, segments.length - 1)}
                    y2={140 - s.result.metrics[metric].score * 1.2}
                    stroke="#176b51"
                    strokeWidth="2"
                  />
                ) : null,
              )}
            {segments.map((s, i) =>
              s.result.metrics[metric].quality === "insufficient" ? null : (
                <circle
                  key={s.index}
                  cx={20 + (i * 580) / Math.max(1, segments.length - 1)}
                  cy={140 - s.result.metrics[metric].score * 1.2}
                  r="4"
                  fill="#176b51"
                >
                  <title>
                    {new Date(s.first * 1000).toLocaleDateString()}：
                    {s.result.metrics[metric].score}，confidence{" "}
                    {s.result.metrics[metric].confidence ?? "未知"}
                  </title>
                </circle>
              ),
            )}
          </svg>
          <div className="segment-table">
            <table>
              <thead>
                <tr>
                  <th>段</th>
                  <th>日期范围</th>
                  <th>消息数</th>
                  <th>分数</th>
                  <th>confidence</th>
                </tr>
              </thead>
              <tbody>
                {segments.map((s) => (
                  <tr key={s.index}>
                    <td>{s.index + 1}</td>
                    <td>
                      {new Date(s.first * 1000).toLocaleDateString()} –{" "}
                      {new Date(s.last * 1000).toLocaleDateString()}
                    </td>
                    <td>{s.result.messageCount}</td>
                    <td>
                      {s.result.metrics[metric].quality === "insufficient"
                        ? "证据不足"
                        : s.result.metrics[metric].score}
                      {s.result.metrics[metric].quality === "limited"
                        ? " · 需复核"
                        : ""}
                    </td>
                    <td>
                      {s.result.metrics[metric].confidence?.toFixed(2) ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
