# 微信聊天信号 0.1.0-beta.1

适用：Apple Silicon（M1 或更新）、macOS 14 或更新。当前版本仅在开发机器的系统版本实测；未承诺覆盖所有系统/微信版本。

打开 DMG，将 WechatSignals.app 拖到 Applications（应用程序），然后从应用程序启动。ZIP 也包含同一个 app。无需安装 Node.js；离线语音模型与本机读取工具已随包附带。

此测试版使用本地 ad-hoc 签名，尚无 Apple Developer ID 签名和公证。互联网下载后 Gatekeeper 可能阻止首次打开。请自行核对仓库来源和 SHA256SUMS，再按 macOS 官方“隐私与安全性”中的“仍要打开”流程操作；不需要关闭系统保护。如果系统不提供该选项，请勿使用来源不明的绕过脚本。

微信首次直接读取需要用户授权，入口是“连接本机微信”；可能需要 Xcode Command Line Tools。首次密钥获取流程会明确解释微信重签风险并要求输入 CONNECT，不会自动执行。微信更新后可能需要重新检查兼容性。应用只读，不自动发送微信消息。

已有源码版数据目录仍为 ~/Library/Application Support/wechat-signals；安装包不会携带或覆盖任何聊天数据或 Key。API Key 仍由用户在设置中保存到 macOS Keychain。正式运行时，首次访问已有 Key 可能出现系统授权提示。

仅当点击“用 Jev 判断”、检查匿名预览并确认时才向官方 TypeSafe API 发出请求。报告是实验性聊天行为信号，不是对方心理或未来结局的概率。

媒体：Whisper 本机语音转写、Apple Vision OCR 与有限图片观察。缺失音频不能凭空转写；照片意图与表情包寓意不能保证理解。

第三方软件：本软件通过独立进程使用 FFmpeg（LGPL-2.1-or-later）及 Opus（BSD），不链接 FFmpeg 库到 Electron 主程序。许可证在 app 的 Contents/Resources/app/vendor 中；对应源码与构建说明随本 Release 的 media-sources 压缩包提供。GreenBubbles、whisper.cpp、Whisper 模型和 Electron 的原始许可一并保留。
