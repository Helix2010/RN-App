import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderHook } from "@testing-library/react-native";
import { usePreferencesStore } from "../../core/preferences/preferences-store";
import { forgetVerification, noteVerified } from "../../core/security/app-lock";
import { useRequireVerification } from "./use-require-verification";

const mockAuthenticate = jest.fn();
jest.mock("../../core/security/app-lock", () => {
  const actual = jest.requireActual("../../core/security/app-lock");
  return {
    ...actual,
    authenticate: (reason: string) => mockAuthenticate(reason),
  };
});
jest.mock("../../app/runtime-context", () => ({
  useFoundationRuntime: () => ({ t: (key: string) => key }),
}));
const mockLockKeys = jest.fn();
jest.mock("../../core/gateways/gateway-context", () => ({
  useGateways: () => ({ lockKeys: mockLockKeys }),
}));
const mockToast = jest.fn();
jest.mock("../../design-system", () => ({
  toast: (message: string, tone: string) => mockToast(message, tone),
}));

/** RNTL 14 + React 19：renderHook 返回 Promise */
async function setup(): Promise<
  (request?: { usdValue?: number | null }) => Promise<boolean>
> {
  const { result } = await renderHook(() => useRequireVerification());
  return result.current;
}

beforeEach(() => {
  mockAuthenticate.mockReset();
  mockToast.mockReset();
  mockLockKeys.mockReset();
  forgetVerification();
  usePreferencesStore.setState({
    txVerification: "smart",
    largeAmountThresholdUsd: 1000,
  });
});

describe("useRequireVerification", () => {
  it("smart: asks for authentication when nothing was verified recently", async () => {
    mockAuthenticate.mockResolvedValue("success");
    await expect((await setup())({ usdValue: 10 })).resolves.toBe(true);
    expect(mockAuthenticate).toHaveBeenCalledWith("security.verify.reason");
    expect(mockLockKeys).not.toHaveBeenCalled();
  });

  it("smart: skips the prompt when the identity was verified within the window", async () => {
    noteVerified(Date.now() - 60_000);
    await expect((await setup())({ usdValue: 10 })).resolves.toBe(true);
    expect(mockAuthenticate).not.toHaveBeenCalled();
  });

  it("smart: prompts again once the window has passed", async () => {
    noteVerified(Date.now() - 6 * 60_000);
    mockAuthenticate.mockResolvedValue("success");
    await expect((await setup())({ usdValue: 10 })).resolves.toBe(true);
    expect(mockAuthenticate).toHaveBeenCalledTimes(1);
  });

  it("always: prompts every time and relocks the keys so the signature verifies again", async () => {
    usePreferencesStore.setState({ txVerification: "always" });
    noteVerified();
    mockAuthenticate.mockResolvedValue("success");
    await expect((await setup())({ usdValue: 10 })).resolves.toBe(true);
    expect(mockAuthenticate).toHaveBeenCalledTimes(1);
    expect(mockLockKeys).toHaveBeenCalledTimes(1);
  });

  it("off: skips authentication for small amounts", async () => {
    usePreferencesStore.setState({ txVerification: "off" });
    await expect((await setup())({ usdValue: 10 })).resolves.toBe(true);
    expect(mockAuthenticate).not.toHaveBeenCalled();
  });

  it("always verifies when the amount's value is unknown, even when off", async () => {
    // 没有参考价的币：无从判断是不是大额，不能按 0 放行
    usePreferencesStore.setState({ txVerification: "off" });
    mockAuthenticate.mockResolvedValue("success");
    await expect((await setup())({ usdValue: null })).resolves.toBe(true);
    expect(mockAuthenticate).toHaveBeenCalledTimes(1);
  });

  it("still verifies a large amount when off, and even when recently verified", async () => {
    usePreferencesStore.setState({ txVerification: "off" });
    mockAuthenticate.mockResolvedValue("success");
    await expect((await setup())({ usdValue: 5000 })).resolves.toBe(true);
    expect(mockAuthenticate).toHaveBeenCalledTimes(1);
    usePreferencesStore.setState({ txVerification: "smart" });
    noteVerified();
    await expect((await setup())({ usdValue: 5000 })).resolves.toBe(true);
    expect(mockAuthenticate).toHaveBeenCalledTimes(2);
  });

  it("blocks the action when the user cancels, without a toast", async () => {
    mockAuthenticate.mockResolvedValue("cancelled");
    await expect((await setup())()).resolves.toBe(false);
    expect(mockToast).not.toHaveBeenCalled();
  });

  it("blocks and warns when authentication fails", async () => {
    mockAuthenticate.mockResolvedValue("failed");
    await expect((await setup())()).resolves.toBe(false);
    expect(mockToast).toHaveBeenCalledWith("security.verify.failed", "error");
  });

  it("lets the action through on a device with nothing enrolled", async () => {
    mockAuthenticate.mockResolvedValue("unavailable");
    await expect((await setup())()).resolves.toBe(true);
  });
});

/**
 * 静态扫描（安全评审 N11）：`smart` 策略下不传 `usdValue` 的调用永远判成"非大额"，
 * 大额门槛就形同虚设。规模未知的场景要显式传 `null`，不能省略这个参数。
 */
describe("requireVerification call sites", () => {
  const roots = ["src/features", "src/core"];

  function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...sourceFiles(path));
      else if (/\.tsx?$/.test(entry.name) && !/\.spec\.tsx?$/.test(entry.name))
        out.push(path);
    }
    return out;
  }

  /** 取 `name(` 后面那个对象字面量的原文；第一个实参不是对象字面量时返回 null。 */
  function firstArgument(source: string, from: number): string | null {
    let index = from;
    while (index < source.length && /\s/.test(source[index] as string)) index++;
    if (source[index] !== "{") return null;
    let depth = 0;
    for (let cursor = index; cursor < source.length; cursor++) {
      const char = source[cursor];
      if (char === "{") depth++;
      else if (char === "}") {
        depth--;
        if (depth === 0) return source.slice(index, cursor + 1);
      }
    }
    return null;
  }

  it("every call passes usdValue, explicitly null when the scale is unknown", () => {
    const offenders: string[] = [];
    let scanned = 0;
    for (const root of roots) {
      for (const file of sourceFiles(root)) {
        const source = readFileSync(file, "utf8");
        if (!source.includes("useRequireVerification")) continue;
        const binding =
          /const\s+([A-Za-z_$][\w$]*)\s*=\s*useRequireVerification\(\)/.exec(
            source,
          );
        if (!binding) continue;
        const name = binding[1] as string;
        const call = new RegExp(`\\b${name}\\(`, "g");
        for (
          let match = call.exec(source);
          match !== null;
          match = call.exec(source)
        ) {
          scanned++;
          const argument = firstArgument(source, match.index + match[0].length);
          if (argument === null || !argument.includes("usdValue"))
            offenders.push(`${file}: ${name}(${argument ?? ""})`);
        }
      }
    }
    expect(scanned).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });
});
