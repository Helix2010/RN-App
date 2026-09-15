import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { appRuntime } from "../network/api-client";
import { builtinMessages } from "./builtin-messages";
import { createFallbackConfig } from "./fallback-config";

/**
 * 共用基座里随包发出去的默认值不能带任何租户的品牌名。白标下每个包的名字都不一样，
 * 写死一个就等于让其它租户看到别人的品牌——而且内置文案还会被导出成种子、进服务端
 * 的**平台全局**文案目录，所有没自己配的租户都继承它。
 *
 * 包自己的名字只有一个来源：`tenants/<slug>/tenant.json` 的 appName，经
 * app.config.ts 写进原生应用标签，运行时由 `appRuntime.appName` 读回来。
 */
function tenantAppNames(): string[] {
  const root = join(__dirname, "..", "..", "..", "tenants");
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map(
      (entry) =>
        (
          JSON.parse(
            readFileSync(join(root, entry.name, "tenant.json"), "utf8"),
          ) as { appName?: unknown }
        ).appName,
    )
    .filter((name): name is string => typeof name === "string" && name !== "");
}

describe("随包发布的默认值不带租户品牌", () => {
  it("内置文案里没有一条的值是某个租户的应用名", () => {
    const names = tenantAppNames();
    expect(names.length).toBeGreaterThan(0);
    // 用相等而不是包含：将来可能有租户叫「钱包」这类通用词，包含判定会满屏误报
    const offenders: string[] = [];
    for (const locale of ["zh-CN", "en-US"] as const) {
      for (const [key, value] of Object.entries(builtinMessages(locale))) {
        if (names.includes(value)) offenders.push(`${locale}/${key}=${value}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("离线兜底配置的启动页标题取这个包自己的名字", () => {
    expect(createFallbackConfig("zh-CN").branding?.launch.title).toBe(
      appRuntime.appName,
    );
    expect(tenantAppNames()).not.toContain("");
  });
});
