// Explicit allowlist: never copy the checkout, userData or development caches.
import {
  cp,
  mkdir,
  readFile,
  writeFile,
  rename,
  rm,
  stat,
  readdir,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
if (process.platform !== "darwin" || process.arch !== "arm64")
  throw Error("Build requires macOS arm64");
const pkg = JSON.parse(await readFile("package.json", "utf8"));
const version = pkg.version;
if (!/^\d+\.\d+\.\d+(?:-[a-z0-9.]+)?$/.test(version))
  throw Error("Unsafe version");
const out = resolve("release"),
  stage = join(out, `stage-${version}`),
  app = join(stage, "WechatSignals.app");
try {
  await stat(stage);
  throw Error(
    "Stage exists; preserve previous build and choose a new version or move it aside",
  );
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
const run = (cmd, args, options = {}) =>
  execFileSync(cmd, args, { stdio: "inherit", ...options });
const deps = resolve(process.env.RELEASE_DEPS_DIR || "work/release-deps");
const mediaFiles = {
  ffmpeg: join(deps, "ffmpeg-7.1.5/ffmpeg"),
  whisper: join(deps, "whisper-build/bin/whisper-cli"),
};
for (const p of Object.values(mediaFiles)) await stat(p);
// Verify corresponding source archives and the pre-existing model pins before copying.
for (const [manifest, base, modelOnly] of [
  ["packaging/media-sources.sha256", deps, false],
  ["vendor/speech/SHA256SUMS", root, true],
]) {
  for (const line of (await readFile(manifest, "utf8")).trim().split("\n")) {
    const match = /^([a-f0-9]{64})\s+(.+)$/.exec(line);
    if (!match || (modelOnly && !match[2].includes("ggml-"))) continue;
    const actual = createHash("sha256")
      .update(await readFile(join(base, match[2])))
      .digest("hex");
    if (actual !== match[1])
      throw Error("Release dependency checksum mismatch: " + match[2]);
  }
}

run(process.execPath, ["scripts/build.mjs"]);
await mkdir(stage, { recursive: true });
await cp("node_modules/electron/dist/Electron.app", app, {
  recursive: true,
  dereference: false,
  verbatimSymlinks: true,
});
const resources = join(app, "Contents/Resources"),
  dest = join(resources, "app");
await rm(join(resources, "default_app.asar"), { force: true });
await mkdir(dest, { recursive: true });
const files = [
  "dist/main.cjs",
  "dist/preload.cjs",
  "dist/ui.js",
  "dist/ui.css",
  "dist/index.html",
  "dist/sql-wasm.wasm",
  "assets/app-icon.png",
  "assets/app-icon.icns",
  "ConnectWechat.command",
  "vendor/greenbubbles/greenbubbles",
  "vendor/greenbubbles/greenbubbles-acquire",
  "vendor/greenbubbles/LICENSE",
  "vendor/greenbubbles/NOTICE.md",
  "vendor/greenbubbles/THIRD_PARTY_NOTICES.md",
  "vendor/greenbubbles/sbom.json",
  "vendor/speech/ggml-base-q5_1.bin",
  "vendor/speech/ggml-small-q5_1.bin",
  "vendor/speech/WHISPER_LICENSE",
];
for (const f of files) {
  await mkdir(dirname(join(dest, f)), { recursive: true });
  await cp(f, join(dest, f));
}
await writeFile(
  join(dest, "package.json"),
  JSON.stringify({
    name: "wechat-signals",
    version,
    main: "dist/main.cjs",
    private: true,
  }),
);
// sql.js is the only external JS runtime dependency; the other dependencies are bundled.
await mkdir(join(dest, "node_modules"), { recursive: true });
await cp("node_modules/sql.js", join(dest, "node_modules/sql.js"), {
  recursive: true,
});
await mkdir(join(dest, "native"), { recursive: true });
for (const [source, output] of [
  ["native/Keychain.swift", "keychain-helper"],
  ["native/ImageOCR.swift", "image-ocr"],
])
  run("swiftc", [
    source,
    "-O",
    "-target",
    "arm64-apple-macos14.0",
    "-o",
    join(dest, "native", output),
  ]);
await cp(mediaFiles.ffmpeg, join(dest, "vendor/speech/ffmpeg"));
await cp(mediaFiles.whisper, join(dest, "vendor/speech/whisper-cli"));
await cp(
  join(deps, "ffmpeg-7.1.5/COPYING.LGPLv2.1"),
  join(dest, "vendor/speech/FFMPEG_LGPLv2.1"),
);
await cp(
  join(deps, "opus-1.5.2/COPYING"),
  join(dest, "vendor/speech/OPUS_LICENSE"),
);
await cp(
  "packaging/WHISPER_MODEL_LICENSE",
  join(dest, "vendor/speech/WHISPER_MODEL_LICENSE"),
);
await cp("packaging/MEDIA_BUILD.md", join(dest, "vendor/speech/NOTICE.md"));
const licenses = join(dest, "vendor/licenses");
await mkdir(licenses, { recursive: true });
for (const p of ["react", "react-dom", "scheduler", "zod", "sql.js"]) {
  const dir = join("node_modules", p);
  const items = await readdir(dir);
  for (const name of items.filter((n) => /^licen[cs]e/i.test(n)))
    await cp(join(dir, name), join(licenses, `${p.replace("/", "-")}-${name}`));
}
await cp(
  "node_modules/electron/dist/LICENSE",
  join(licenses, "Electron-LICENSE"),
);
await cp(
  "node_modules/electron/dist/LICENSES.chromium.html",
  join(licenses, "Electron-LICENSES.chromium.html"),
);
await cp("packaging/INSTALL-zh.md", join(resources, "安装说明.md"));
await cp("assets/app-icon.icns", join(resources, "app-icon.icns"));
await rename(
  join(app, "Contents/MacOS/Electron"),
  join(app, "Contents/MacOS/WechatSignals"),
);
run("python3", [
  "-c",
  `import plistlib,pathlib,sys
app=pathlib.Path(sys.argv[1]); version=sys.argv[2]
p=app/'Contents/Info.plist'; d=plistlib.loads(p.read_bytes()); d.update(CFBundleName='WechatSignals',CFBundleDisplayName='微信聊天信号',CFBundleIdentifier='local.wechat-signals.desktop',CFBundleExecutable='WechatSignals',CFBundleIconFile='app-icon.icns',CFBundleShortVersionString=version,CFBundleVersion='1',LSMinimumSystemVersion='14.0',LSApplicationCategoryType='public.app-category.utilities'); p.write_bytes(plistlib.dumps(d))
for p in (app/'Contents/Frameworks').glob('Electron Helper*.app/Contents/Info.plist'):
 d=plistlib.loads(p.read_bytes());d['CFBundleIdentifier']=d['CFBundleIdentifier'].replace('com.github.Electron','local.wechat-signals.desktop');p.write_bytes(plistlib.dumps(d))`,
  app,
  version,
]);
run("codesign", [
  "--force",
  "--deep",
  "--sign",
  "-",
  "--entitlements",
  "packaging/entitlements.plist",
  app,
]);
run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app]);
// The inventory is independently inspected before archives are produced.
run(process.execPath, ["scripts/verify-release.mjs", app]);
const prefix = `WechatSignals-${version}-macos-arm64`;
run("ditto", [
  "-c",
  "-k",
  "--sequesterRsrc",
  "--keepParent",
  app,
  join(out, prefix + ".zip"),
]);
const imageRoot = join(stage, "dmg");
await mkdir(imageRoot);
await cp(app, join(imageRoot, "WechatSignals.app"), {
  recursive: true,
  verbatimSymlinks: true,
});
run("ln", ["-s", "/Applications", join(imageRoot, "Applications")]);
await cp("packaging/INSTALL-zh.md", join(imageRoot, "安装说明.md"));
run("hdiutil", [
  "create",
  "-volname",
  `WechatSignals ${version}`,
  "-srcfolder",
  imageRoot,
  "-ov",
  "-format",
  "UDZO",
  join(out, prefix + ".dmg"),
]);
const sources = join(stage, "media-sources");
await mkdir(sources);
for (const f of [
  "ffmpeg-7.1.5.tar.xz",
  "opus-1.5.2.tar.gz",
  "whisper-source.tar.gz",
])
  await cp(join(deps, f), join(sources, f));
await cp("packaging/MEDIA_BUILD.md", join(sources, "BUILD.md"));
await cp("packaging/media-sources.sha256", join(sources, "SHA256SUMS"));
run("tar", [
  "-czf",
  join(out, prefix + "-media-sources.tar.gz"),
  "-C",
  stage,
  "media-sources",
]);
const assets = [
  prefix + ".zip",
  prefix + ".dmg",
  prefix + "-media-sources.tar.gz",
];
const hashes = [];
for (const f of assets)
  hashes.push(
    createHash("sha256")
      .update(await readFile(join(out, f)))
      .digest("hex") +
      "  " +
      f,
  );
await writeFile(join(out, "SHA256SUMS"), hashes.join("\n") + "\n");
console.log(`Built ${prefix}; ad-hoc signed, not notarized.`);
