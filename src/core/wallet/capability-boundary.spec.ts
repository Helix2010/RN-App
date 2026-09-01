import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * 密钥边界的静态检查。Robinhood 把每链签名放进只暴露"消息总线 + 安全 RNG"的 WASM
 * 沙箱，读它的 Import 段就能证明签名器碰不到网络/文件（逆向 E-018 / EXP-D5）。
 * 我们没有 WASM 沙箱，用模块的 import 白名单守住同一条边界：Vault 与签名器不得
 * 依赖任何网络、遥测或持久化实现，只能依赖注入进来的端口。
 */

const BOUNDARY_DIRS = ["vault", "signer", "keygen"];
const FORBIDDEN_IMPORTS = [
  "../../network",
  "network/api-client",
  // 链层会说话（RPC）；签名器只能拿到已经构造好的交易
  "../chain/",
  "../../chain/",
  "core/chain/",
  "rpc-client",
  "expo-notifications",
  "@react-native-async-storage",
  "@tanstack/react-query",
  "axios",
];
const FORBIDDEN_GLOBALS = ["fetch(", "XMLHttpRequest", "WebSocket("];

function sourceFiles(): { path: string; source: string }[] {
  const root = __dirname;
  const files: { path: string; source: string }[] = [];
  for (const dir of BOUNDARY_DIRS) {
    for (const name of readdirSync(join(root, dir))) {
      if (!name.endsWith(".ts") || name.endsWith(".spec.ts")) continue;
      // expo-ports 是边界的适配层，允许 import expo 原生模块
      if (name === "expo-ports.ts") continue;
      files.push({
        path: `${dir}/${name}`,
        source: readFileSync(join(root, dir, name), "utf8"),
      });
    }
  }
  return files;
}

describe("wallet key boundary", () => {
  it("covers every module inside the boundary", () => {
    const paths = sourceFiles().map((file) => file.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        "keygen/mnemonic.ts",
        "vault/keystore-vault.ts",
        "vault/ports.ts",
        "signer/embedded-signer.ts",
        "signer/types.ts",
      ]),
    );
  });

  it("imports no network, storage or telemetry module", () => {
    for (const { path, source } of sourceFiles()) {
      for (const forbidden of FORBIDDEN_IMPORTS) {
        expect(source).not.toContain(`from "${forbidden}`);
        expect(source).not.toContain(`require("${forbidden}`);
      }
      for (const global of FORBIDDEN_GLOBALS) {
        expect(source.includes(global)).toBe(false);
      }
      expect(path).toBeTruthy();
    }
  });

  it("never logs, and never returns key material from the vault surface", () => {
    for (const { source } of sourceFiles()) {
      // 助记词 / 私钥绝不能进日志或埋点
      expect(source).not.toMatch(/console\.(log|warn|info|error)/);
    }
    const vault = readFileSync(
      join(__dirname, "vault/keystore-vault.ts"),
      "utf8",
    );
    // 私钥只经受控回调交出；不得有直接返回私钥的公开方法
    expect(vault).not.toMatch(/^\s+async getPrivateKey/m);
    expect(vault).toContain("withPrivateKey");
  });
});
