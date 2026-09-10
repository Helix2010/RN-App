import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * 预测市场"禁止 Mock"边界的静态检查。
 *
 * 预测行情、账户、结算、争议都接真实平台；生产代码不得引用 Mock 网关、夹具或
 * Mock 运行时（含 `mockNow` 这类 Mock 时钟）。`MockPredictGateway` 与 `fixtures/`
 * 只允许测试引用。DEX 尚未接入，仍可用 Mock，所以只扫预测市场目录和渲染预测数据的首页。
 */

const PREDICT_ROOT = __dirname;
/** 预测市场之外、但渲染预测数据或装配预测网关的生产文件 */
const HOME_SCREEN = join(__dirname, "../foundation/foundation-home-screen.tsx");
const GATEWAY_WIRING = join(
  __dirname,
  "../../core/gateways/gateway-context.tsx",
);
const TEST_ONLY_FILES = new Set(["api/mock-predict-gateway.ts"]);
const FORBIDDEN_IMPORTS = [
  "core/mock/",
  "/fixtures/",
  "mock-predict-gateway",
  "mock-wallet-gateway",
  "mock-dex-gateway",
  "mock-session-gateway",
];
const FORBIDDEN_CALLS = ["mockNow(", "mockNowIso(", "mockRandom(", "simulate("];

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === "fixtures") continue;
      files.push(...walk(path));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(name) || /\.spec\.(ts|tsx)$/.test(name)) continue;
    files.push(path);
  }
  return files;
}

/** 所有 import/export 的模块说明符（含 prettier 折成多行的 import） */
function importLines(source: string): string[] {
  return [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]!);
}

function productionFiles(): { path: string; source: string }[] {
  return [...walk(PREDICT_ROOT), HOME_SCREEN, GATEWAY_WIRING]
    .map((path) => relative(PREDICT_ROOT, path))
    .filter((path) => !TEST_ONLY_FILES.has(path))
    .map((path) => ({
      path,
      source: readFileSync(join(PREDICT_ROOT, path), "utf8"),
    }));
}

describe("predict mock boundary", () => {
  it("covers the predict feature, the home screen and the gateway wiring", () => {
    const paths = productionFiles().map((file) => file.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        "api/http-predict-gateway.ts",
        "api/http-predict-account-gateway.ts",
        "ui/market-list-screen.tsx",
        "ui/series-card.tsx",
        "ui/settlement-screen.tsx",
        "ui/dispute-sheet.tsx",
        "ui/shared.tsx",
        "../foundation/foundation-home-screen.tsx",
        "../../core/gateways/gateway-context.tsx",
      ]),
    );
  });

  it("never imports mock gateways, fixtures or the mock runtime", () => {
    for (const { path, source } of productionFiles()) {
      const offending = importLines(source).filter((line) =>
        FORBIDDEN_IMPORTS.some((forbidden) => line.includes(forbidden)),
      );
      // gateway-context 装配 DEX 与钱包演示账本的 Mock，是唯一允许的例外；预测网关必须是 Http 实现
      const allowed =
        path === "../../core/gateways/gateway-context.tsx"
          ? offending.filter(
              (line) =>
                !line.includes("mock-dex-gateway") &&
                !line.includes("mock-wallet-gateway"),
            )
          : offending;
      expect({ path, offending: allowed }).toEqual({ path, offending: [] });
      for (const call of FORBIDDEN_CALLS) {
        expect({ path, call, found: source.includes(call) }).toEqual({
          path,
          call,
          found: false,
        });
      }
    }
  });

  it("wires the real platform gateways in production", () => {
    const wiring = readFileSync(GATEWAY_WIRING, "utf8");
    expect(wiring).toContain("new HttpPredictGateway(");
    expect(wiring).toContain("new HttpPredictAccountGateway(");
    expect(wiring).not.toContain("MockPredictGateway");
  });
});
