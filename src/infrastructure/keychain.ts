import { spawn } from "node:child_process";
import type { SecretStore } from "../domain/types";
export class KeychainStore implements SecretStore {
  constructor(private helper: string) {}
  private run(command: string, input?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.helper, [command], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      let value = "";
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("钥匙串操作超时"));
      }, 30000);
      child.stdout.on("data", (d) => (value += d));
      child.stderr.resume();
      child.on("error", () => {
        clearTimeout(timer);
        reject(new Error("钥匙串组件不可用，请先运行 npm run build:keychain"));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        code === 0 ? resolve(value) : reject(new Error("钥匙串操作未成功"));
      });
      child.stdin.on("error", () => {});
      child.stdin.end(input);
    });
  }
  async get() {
    return (await this.run("get")) || null;
  }
  async set(key: string) {
    if (!key.trim() || key.length > 8000 || /[\r\n]/.test(key))
      throw new Error("API Key 格式不正确");
    await this.run("set", key.trim());
  }
  async delete() {
    await this.run("delete");
  }
}
