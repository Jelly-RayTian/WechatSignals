# Third-party notices

GreenBubbles 0.10.0 query and acquire binaries are bundled in vendor/greenbubbles. Copyright (c) 2026 Bojie Li, MIT. Upstream LICENSE, THIRD_PARTY_NOTICES.md and SBOM are preserved alongside it. Download was SHA-256 checked against the upstream formula. The acquire helper is used for read-only preflight and an explicitly user-operated initial setup. Sending programs are not included.

WechatVibe is a functional reference only; no source was copied into this project. Its repository is Apache-2.0 licensed.

npm dependencies and their license files are retained under node_modules and pinned in package-lock.json. A release build must include the relevant licenses in the distributable, plus code-sign and notarize all bundled native executables.

WXGF container handling in src/infrastructure/wxgf.ts was informed by wx-cli/wx-media wxgf.rs and image_transcode.rs, copyright (c) 2026 pandorafuture, MIT. The complete license is preserved at vendor/licenses/wx-cli-MIT.txt. No wx-cli executable or model is bundled by this change.
