# 从源码仓库运行

本仓库提交应用源码、测试、依赖锁文件及第三方许可说明。不会提交微信数据库、聊天/转写缓存、分析结果、API Key、node_modules、构建产物或本机原生可执行程序及语音模型。

## 基础环境

macOS Apple Silicon、Node.js 22+、Xcode Command Line Tools（Swift 编译器）。

```sh
npm ci
npm run build:keychain
npm run typecheck
npm test
npm run build
```

## 本机读取和语音依赖

- 按 `vendor/greenbubbles/NOTICE.md` 及 `docs/RESEARCH_ARCHITECTURE.md` 安装匹配的 GreenBubbles 0.10.0 macOS arm64 查询程序与 acquire helper，放到 `vendor/greenbubbles/` 对应路径。查询程序也可通过 `GREENBUBBLES_BIN` 设置绝对路径。
- 按 `vendor/speech/NOTICE.md` 安装本地 `ffmpeg`、`whisper-cli` 与 `ggml-base-q5_1.bin` / `ggml-small-q5_1.bin`。模型校验见 `vendor/speech/SHA256SUMS`。不安装这些依赖时，语音转写功能不可用。
- 原生工具需可执行权限；安装来源、版本和许可证说明保留在各 vendor 目录。
- 本地已有的依赖没有被删除；这次只把它们排除在 Git 提交之外。

完成依赖安装后执行 `./Start.command`。微信连接需要本机授权；Jev Key 在应用设置中写入 Keychain，仅手动确认分析时发送匿名聊天文本。

`npm run evaluate:jev` 默认仅检查人工编写的合成测试集，不调用 API，也不生成预测报告。真实 Jev 评测需显式 `--live`，会调用 API；生成预测报告后才可运行 `npm run audit:scoring`。已有评测结果留在本机，不随源码上传。
