import React from "react";
import type { View } from "../domain/types";
export function LocalComparison({ view }: { view: View }) {
  return (
    <section className="chart local-comparison">
      {" "}
      <h2>本地对比</h2>
      {view && (
        <table>
          <thead>
            <tr>
              <th>指标</th>
              <th>我</th>
              <th>对方</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>消息数量</td>
              <td>{view.stats.me.count}</td>
              <td>{view.stats.other.count}</td>
            </tr>
            <tr>
              <td>开启次数</td>
              <td>{view.stats.me.starts}</td>
              <td>{view.stats.other.starts}</td>
            </tr>
            <tr>
              <td>平均回复</td>
              {(["me", "other"] as const).map((s) => (
                <td key={s}>
                  {view.stats[s].avgReplySeconds === null
                    ? "—"
                    : Math.round(view.stats[s].avgReplySeconds!) + "秒"}
                </td>
              ))}
            </tr>
            <tr>
              <td>回复中位数</td>
              {(["me", "other"] as const).map((side) => (
                <td key={side}>
                  {view.stats[side].medianReplySeconds === null ||
                  view.stats[side].medianReplySeconds === undefined
                    ? "—"
                    : Math.round(view.stats[side].medianReplySeconds!) + "秒"}
                </td>
              ))}
            </tr>
            <tr>
              <td>有效回复样本</td>
              <td>{view.stats.me.replySamples ?? 0}</td>
              <td>{view.stats.other.replySamples ?? 0}</td>
            </tr>
            <tr>
              <td>平均文本长度</td>
              <td>{view.stats.me.avgLength.toFixed(1)}</td>
              <td>{view.stats.other.avgLength.toFixed(1)}</td>
            </tr>
          </tbody>
        </table>
      )}
    </section>
  );
}
