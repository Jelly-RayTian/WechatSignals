# WechatSignals 应用图标

- `app-icon.png`：1024×1024，透明外缘，运行时 Dock 与窗口图标。
- `app-icon.icns`：macOS 标准多尺寸图标（16–1024px），供未来应用打包使用。
- 原创生成方式：Codex 内置 imagegen，2026-10-11；未发送任何聊天、联系人或项目私密数据。

## 最终生成提示词

Use case: logo-brand. Asset type: production macOS app icon for WechatSignals, a private local chat behavior analysis application. Make ONE centered square app icon, front view, 1024x1024 composition, transparent outside a large macOS rounded-square tile with generous standard icon safe margin. Tile deep forest green with subtly luminous jade shading, sophisticated restrained native macOS material, soft beveled edge. Central symbol: two elegantly overlapping ivory and pale mint speech bubbles, with a simple smooth rising-and-falling signal curve integrated in the front bubble, three points maximum, no sharp ECG heart-rate spikes. Strong bold silhouette, readable at 32px, polished dimensional relief with very subtle soft lighting, minimal and calm. No text, no letters, no numbers, no watermark, no hearts, no padlock, no magnifying glass, no background scene, no mockup, no multiple variants, no WeChat official logo, no neon glow. The whole tile and both bubbles must be fully visible, clean true alpha outside.

通过 macOS sips 缩放，iconutil 导出 ICNS。下次启动应用生效；源码启动脚本自身仍是 .command 文件，并非已打包的 .app。
