import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { z } from "zod";
import type {
  WechatReaderPlugin,
  WechatReader,
  ConnectionReport,
} from "../domain/types";
const exec = promisify(execFile);
// Accept only known preflight booleans. Opaque account IDs, paths, remediation and stderr never reach the UI.
const preflight = z.object({
  formatVersion: z.literal(1),
  clientInstalled: z.boolean(),
  clientReSigned: z.boolean(),
  wechatProcessRunning: z.boolean(),
  databaseCount: z.number().nonnegative(),
  lldbAvailable: z.boolean(),
});
export type PreflightProbe = () => Promise<unknown>;
export function createPreflightProbe(helper: string): PreflightProbe {
  return async () => {
    let output: string;
    try {
      output = (
        await exec(helper, ["preflight", "--json"], {
          timeout: 30000,
          maxBuffer: 1024 * 1024,
        })
      ).stdout;
    } catch (e) {
      output = String((e as { stdout?: string }).stdout || "");
    }
    try {
      return JSON.parse(output);
    } catch {
      throw new Error("无法完成本机微信授权检测");
    }
  };
}
export class GreenBubblesPlugin implements WechatReaderPlugin {
  readonly id = "greenbubbles.local";
  readonly readOnly = true as const;
  constructor(
    readonly reader: WechatReader,
    private probe: PreflightProbe,
    private keyPresent: () => Promise<boolean> = async () => {
      try {
        await access(join(homedir(), ".greenbubbles-acquire/passphrase.txt"));
        return true;
      } catch {
        return false;
      }
    },
  ) {}
  async inspectConnection(): Promise<ConnectionReport> {
    const status = await this.reader.detect();
    if (status.readable)
      return {
        plugin: this.id,
        readable: true,
        needsSetup: false,
        detail: "已直接连接本机微信，不需要导出或导入聊天。",
        checks: [{ label: "本机微信数据库可读", ok: true }],
      };
    const report = preflight.safeParse(await this.probe());
    if (!report.success) throw new Error("本机授权检测协议不兼容");
    const p = report.data,
      hasKey = await this.keyPresent();
    return {
      plugin: this.id,
      readable: false,
      needsSetup: true,
      detail:
        "已自动发现本机微信。首次连接需要本机读取授权，不需要导入聊天文件。",
      checks: [
        { label: "微信已安装", ok: p.clientInstalled },
        { label: "微信正在运行", ok: p.wechatProcessRunning },
        { label: "已自动找到本机数据库", ok: p.databaseCount > 0 },
        { label: "密钥获取所需开发工具可用", ok: p.lldbAvailable },
        { label: "微信已完成读取所需的本地重签", ok: p.clientReSigned },
        { label: "本机数据库密钥已就绪", ok: hasKey },
      ],
    };
  }
}
