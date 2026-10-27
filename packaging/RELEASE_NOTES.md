首个可独立安装的 macOS 测试版，面向 Apple Silicon（M1 或更新），系统目标 macOS 14+。

### 下载与安装

- **DMG**：打开后将 WechatSignals.app 拖到 Applications。
- **ZIP**：包含相同的独立 app，可解压后移至 Applications。
- **SHA256SUMS**：下载文件校验值。
- **media-sources.tar.gz**：FFmpeg / Opus / whisper.cpp 对应源码与构建说明，普通用户无需下载。

已捆绑 Electron、GreenBubbles 查询/获取工具、原生 Keychain/OCR helper、Whisper base/small 离线模型。运行不需要安装 Node.js。微信首次密钥获取可能需要 Xcode Command Line Tools，并由用户主动授权。

### 功能

- 本机只读单聊、完整日期范围读取与本机缓存。
- 完整已读范围搜索，支持正文、语音转写和图片 OCR，发送者/类型筛选与分页。
- 本机语音转写、缓存复用和人工校正；系统 Vision 图片文字及有限观察。
- 官方 TypeSafe Jev 分段判断、五项信号、双向互动、证据回查和图表。
- Jev 仅在主动预览并确认后发送匿名文字；API Key 存 macOS Keychain。

### 已知限制

此版本为 **ad-hoc 签名，未经过 Apple Developer ID 签名或公证**。通过浏览器下载后，macOS 可能阻止首次启动；核对来源和校验值后，按系统“隐私与安全性”中的官方流程操作。不要关闭 Gatekeeper 等全局安全保护。

最低部署目标已检查为 macOS 14；当前只在开发机器的 macOS 实测，未完成跨系统版本兼容矩阵。微信数据库读取随微信版本与用户授权变化，不承诺任意版本开箱即读。缺失音频不能凭空转写；图片观察不等于照片或表情包语义理解。

关系分析仍为实验性行为指数，没有独立盲测准确率，不代表他人真实心理、喜欢你的概率或未来关系结局。旧报告不会自动更新，需手动确认新分析。

### 验证与第三方

完整 122 项离线测试、类型检查、构建；发布包另有原生架构/最低系统/运行依赖、符号链接、签名及敏感文件清单检查。未在发布过程中调用 Jev 或上传真实聊天。

本软件通过独立进程使用 [FFmpeg](https://ffmpeg.org/)（LGPL-2.1-or-later）及 Opus；其对应源码在本 Release 的 media-sources 压缩包中。FFmpeg 构建未启用 GPL 或 nonfree 组件。应用内保留所有捆绑软件及模型的第三方许可证。
