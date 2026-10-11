import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import { mkdir, writeFile, copyFile } from "node:fs/promises";
if (process.platform === "darwin")
  execFileSync(
    "swiftc",
    ["native/ImageOCR.swift", "-O", "-o", "native/image-ocr"],
    { stdio: "pipe" },
  );
await mkdir("dist", { recursive: true });
await build({
  entryPoints: ["src/desktop/main.ts"],
  outfile: "dist/main.cjs",
  platform: "node",
  format: "cjs",
  bundle: true,
  external: ["electron", "sql.js"],
});
await build({
  entryPoints: ["src/desktop/preload.ts"],
  outfile: "dist/preload.cjs",
  platform: "node",
  format: "cjs",
  bundle: true,
  external: ["electron"],
});
await build({
  entryPoints: ["src/ui/main.tsx"],
  outfile: "dist/ui.js",
  platform: "browser",
  format: "esm",
  bundle: true,
});
await copyFile("node_modules/sql.js/dist/sql-wasm.wasm", "dist/sql-wasm.wasm");
await writeFile(
  "dist/index.html",
  `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'self' data:"><title>微信聊天信号</title><link rel="stylesheet" href="ui.css"></head><body><div id="root"></div><script type="module" src="ui.js"></script></body></html>`,
);
