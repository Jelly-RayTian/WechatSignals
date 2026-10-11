import React from "react";
import type { MediaObservation } from "../domain/types";
const labels: Record<string, string> = {
  food: "食物",
  drink: "饮品",
  dessert: "甜点",
  fruit: "水果",
  flower: "花",
  plant: "植物",
  cat: "猫",
  dog: "狗",
  animal: "动物",
  landscape: "风景",
  sky: "天空",
  beach: "海滩",
  mountain: "山",
  building: "建筑",
  vehicle: "车辆",
  car: "汽车",
  book: "书",
  document: "文档",
  text: "文字",
  screenshot: "屏幕截图",
};
export function ImageObservation({ media }: { media?: MediaObservation }) {
  return (
    <div className="image-observation">
      <small>
        {media?.status === "recognized"
          ? (media.reviewed ? "图片文字已人工核对" : "本机图片OCR · 请核对") +
            " · 图片内文字不是发送者陈述"
          : media?.status === "no_text"
            ? "未检出文字；不代表没有互动信息"
            : media?.status === "unavailable"
              ? "图片读取或识别失败；请先在微信打开原图，再重试"
              : "尚未本机识别"}
      </small>
      {media?.text && <p>{media.text}</p>}
      {media?.version === "vision-local-v2" && (
        <>
          <div className="image-tags">
            {media.labels?.map((l) => (
              <span key={l.name}>
                {labels[l.name] ?? "粗分类"} · {Math.round(l.confidence * 100)}%
              </span>
            ))}
            {!!media.barcodeCount && (
              <span>检测到条码 {media.barcodeCount} 个 · 内容不保存</span>
            )}
          </div>
          <small>
            {media.width && media.height
              ? `${media.width} × ${media.height} · `
              : ""}
            {(media.frameCount ?? 1) > 1
              ? `多帧图片（${media.frameCount}帧）仅观察首帧 · `
              : ""}
            {media.classificationAvailable
              ? "系统粗分类，不是场景描述或情感判断"
              : "系统粗分类不可用，已有OCR仍保留"}
          </small>
        </>
      )}
      <small>
        图片和分类标签不上传。未识别画面、人物身份、意图或表情情绪。
      </small>
    </div>
  );
}
