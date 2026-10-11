// Container handling informed by wx-cli/wx-media (MIT, pandorafuture 2026).
// See vendor/licenses/wx-cli-MIT.txt and THIRD_PARTY_NOTICES.md.
export function unwrapWxgf(bytes: Buffer): {
  format: "image" | "hevc";
  bytes: Buffer;
} {
  if (bytes.subarray(0, 4).toString("ascii") !== "wxgf")
    throw new Error("不是WXGF图片");
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const jpg = Buffer.from([0xff, 0xd8, 0xff]);
  for (let i = 4; i < Math.min(bytes.length, 4096); i++) {
    if (
      bytes.subarray(i, i + png.length).equals(png) ||
      bytes.subarray(i, i + jpg.length).equals(jpg)
    )
      return { format: "image", bytes: bytes.subarray(i) };
  }
  // Require an HEVC parameter-set NAL rather than interpreting arbitrary zeros
  // in the container header as a video start code. FFmpeg still validates it.
  for (const start of [Buffer.from([0, 0, 0, 1]), Buffer.from([0, 0, 1])]) {
    let offset = bytes.indexOf(start, 4);
    while (offset >= 0) {
      const nal = bytes[offset + start.length];
      if (nal !== undefined && [32, 33, 34].includes((nal >> 1) & 63))
        return { format: "hevc", bytes: bytes.subarray(offset) };
      offset = bytes.indexOf(start, offset + 1);
    }
  }
  throw new Error("WXGF容器中没有支持的图片帧");
}
