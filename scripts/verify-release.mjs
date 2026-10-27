import { readdir, lstat, readFile, realpath } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { execFileSync } from "node:child_process";
const app = resolve(process.argv[2]);
const root = join(app, "Contents/Resources/app");
const files = [];
async function walk(dir) {
  for (const name of await readdir(dir)) {
    const p = join(dir, name),
      s = await lstat(p);
    if (s.isSymbolicLink()) {
      const target = await realpath(p);
      if (!target.startsWith(app + "/"))
        throw Error("External runtime symlink: " + relative(app, p));
    } else if (s.isDirectory()) await walk(p);
    else files.push(relative(root, p));
  }
}
async function verifyLinks(dir) {
  for (const name of await readdir(dir)) {
    const p = join(dir, name),
      s = await lstat(p);
    if (s.isSymbolicLink()) {
      const target = await realpath(p);
      if (!target.startsWith(app + "/"))
        throw Error("External bundle symlink: " + relative(app, p));
    } else if (s.isDirectory()) await verifyLinks(p);
  }
}
await verifyLinks(app);
await walk(root);
for (const f of files) {
  if (
    /(^|\/)(\.env[^/]*|\.git|work|cache|transcripts|exports|store|evaluation)(\/|$)|\.(sqlite(?:-.*)?|db|log|pem|key|p12)$/i.test(
      f,
    )
  )
    throw Error("Forbidden payload: " + f);
  if (
    !/^(dist|assets|native|vendor|node_modules\/sql.js)\//.test(f) &&
    !["package.json", "ConnectWechat.command"].includes(f)
  )
    throw Error("Unexpected payload: " + f);
}
const required = [
  "dist/main.cjs",
  "dist/preload.cjs",
  "dist/ui.js",
  "dist/ui.css",
  "dist/sql-wasm.wasm",
  "native/keychain-helper",
  "native/image-ocr",
  "vendor/greenbubbles/greenbubbles",
  "vendor/greenbubbles/greenbubbles-acquire",
  "vendor/speech/ffmpeg",
  "vendor/speech/whisper-cli",
  "vendor/speech/ggml-base-q5_1.bin",
  "vendor/speech/ggml-small-q5_1.bin",
  "vendor/speech/FFMPEG_LGPLv2.1",
  "vendor/speech/OPUS_LICENSE",
];
for (const f of required)
  if (!files.includes(f)) throw Error("Missing payload: " + f);
for (const f of required.filter(
  (f) =>
    f.startsWith("native/") ||
    [
      "vendor/greenbubbles/greenbubbles",
      "vendor/greenbubbles/greenbubbles-acquire",
      "vendor/speech/ffmpeg",
      "vendor/speech/whisper-cli",
    ].includes(f),
)) {
  const p = join(root, f),
    info = execFileSync("file", ["-b", p], { encoding: "utf8" });
  if (!info.includes("arm64")) throw Error("Wrong architecture: " + f);
  const load = execFileSync("xcrun", ["vtool", "-show-build", p], {
    encoding: "utf8",
  });
  if (
    [...load.matchAll(/minos (\d+(?:\.\d+)*)/g)].some(
      (m) => Number(m[1].split(".")[0]) > 14,
    )
  )
    throw Error("Deployment target too new: " + f);
  const links = execFileSync("otool", ["-L", p], { encoding: "utf8" })
    .split("\n")
    .slice(1)
    .filter(Boolean);
  if (
    links.some((l) => !/^\s+(\/System\/|\/usr\/lib\/|@rpath\/libswift)/.test(l))
  )
    throw Error("Non-system runtime dependency: " + f);
}
const ffmpeg = execFileSync(join(root, "vendor/speech/ffmpeg"), ["-L"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
if (!ffmpeg.includes("Lesser General Public License"))
  throw Error("Unexpected FFmpeg license");
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
console.log(
  JSON.stringify({
    version: pkg.version,
    runtimeFiles: files.length,
    privateArtifacts: 0,
    arch: "arm64",
    declaredMinimum: "14.0",
    signing: "ad-hoc; not notarized",
  }),
);
