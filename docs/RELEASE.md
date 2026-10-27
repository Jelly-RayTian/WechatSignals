# macOS Release 构建与验证

首版 v0.1.0-beta.1，Apple Silicon，部署目标 macOS 14.0。使用 Electron 官方支持的手工 Resources/app 布局，保留独立 native/vendor 文件，避免 ASAR 内可执行文件路径问题。参考：https://www.electronjs.org/docs/latest/tutorial/application-distribution。

1. `npm ci`，按源码运行文档安装并校验 GreenBubbles、语音模型。
2. 按 `packaging/MEDIA_BUILD.md` 编译 FFmpeg 7.1.5 + Opus 1.5.2、指定 whisper.cpp 提交。对应原始源码压缩包放 `work/release-deps/`；逐项校验 `packaging/media-sources.sha256`。构建结果为 `work/release-deps/ffmpeg-7.1.5/ffmpeg` 和 `work/release-deps/whisper-build/bin/whisper-cli`。可用 RELEASE_DEPS_DIR 指定另一个依赖目录。
3. `npm run typecheck && npm test`；`npm run package:mac` 自动构建 JS/Swift、检查白名单、导出 `.app`、ZIP、DMG、媒体对应源码和校验文件至 `release/`（全部忽略，不进入 Git）。
4. 脚本拒绝覆盖已有 stage，重新打包时先把本次 stage 移到另一个保留目录。发布前可重新生成归档；已公布的版本应保持不可变，修改时增加版本号。
5. `node scripts/verify-release.mjs /path/to/WechatSignals.app` 检查资源、链接、原生 arm64/部署版本/系统动态依赖及 FFmpeg 许可。`codesign --verify --deep --strict app` 验证本地签名。无 Developer ID 和 notarization 凭据，首版仅 ad-hoc 签名，不冒称已公证。
6. 在实际 ZIP 解压及只读挂载的 DMG 上再次检查，从解压 app 启动 UI。隔离验证可用 WECHAT_SIGNALS_TEST_DATA_DIR 指向空测试目录、GREENBUBBLES_BIN=/usr/bin/false 禁止读取真实微信；不要把隔离实例当正式用户实例。
7. GitHub Release 使用源码 tag；上传仅 DMG、ZIP、media-sources 和 SHA256SUMS。先草稿上传、对照远端 digest，再公开预发行。

已验证：完整 122 项测试、类型检查、打包签名/依赖/清单；ZIP 实际启动并打开设置页；本轮原生媒体只使用合成输入。构建机器 macOS 26.3.1；部署目标 14.0 不等于完成所有旧系统真机测试。没有实测下载后的 Gatekeeper 首次打开路径，也没有在线 Jev 评测。

用户数据仍在固定的 wechat-signals userData 目录；安装包不带数据库、Key、转写缓存、分析结果、日志、测试输出或开发目录链接。API Key 依旧通过 Keychain 管理。
