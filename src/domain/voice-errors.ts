export const voiceErrorLabels = {
  missing: "音频未在本机保存",
  source: "音频读取或来源校验失败",
  convert: "音频转码失败",
  recognition: "语音识别失败或超时",
  empty: "未识别出文字",
  storage: "转写保存失败",
  unknown: "其他转写失败",
} as const;
export type VoiceErrorCode = keyof typeof voiceErrorLabels;
export class VoiceError extends Error {
  constructor(public readonly code: VoiceErrorCode) {
    super(voiceErrorLabels[code]);
  }
}
