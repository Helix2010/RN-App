import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import * as LocalAuthentication from "expo-local-authentication";
import { builtinMessages } from "../config/builtin-messages";
import { normalizeMessageKey } from "../config/localization";
import { usePreferencesStore } from "../preferences/preferences-store";
import { authenticate } from "./app-lock";
import { builtinPromptText, promptLocale } from "./prompt-text";

const authenticateAsync = jest.mocked(LocalAuthentication.authenticateAsync);
const enrolledLevel = jest.mocked(LocalAuthentication.getEnrolledLevelAsync);

describe("biometric prompt text", () => {
  afterEach(() => {
    usePreferencesStore.getState().setLocale("system");
  });

  it("resolves prompt keys from the built-in dictionary for the selected locale", () => {
    expect(builtinPromptText("predict.sign.reason", "zh-CN")).toBe(
      "验证身份以签署预测平台请求",
    );
    expect(builtinPromptText("predict.sign.reason", "en-US")).toBe(
      "Verify your identity to sign the prediction platform request",
    );
    expect(builtinPromptText("wallet.sign.transfer", "en-US")).toBe(
      "Verify your identity to confirm the transfer",
    );
  });

  it("fails loudly on an unknown key instead of showing a raw key or a substitute", () => {
    expect(() => builtinPromptText("no.such.key", "en-US")).toThrow(
      /unknown biometric prompt key "no.such.key"/,
    );
  });

  it("every prompt key used in src is a built-in dictionary key, and no caller passes translated text", () => {
    const root = join(__dirname, "..", "..");
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "test") walk(full);
        } else if (
          /\.tsx?$/.test(entry.name) &&
          !/\.(spec|test)\.tsx?$/.test(entry.name)
        )
          files.push(full);
      }
    };
    walk(root);
    // 调用方只能传 key：任何把 t(...) 的结果或整句文案传给认证的写法都会让弹窗显示错误内容
    const forbidden = [
      /\bauthenticate\(\s*t\(/,
      /\breason:\s*t\(/,
      /\brevealMnemonic\([^)]*\bt\(/,
      /\brecoverStorage\(\s*t\(/,
      /\buseWalletLogin\([^)]*\bt\(/,
      /_REASON\s*=\s*t\(/,
    ];
    const keyPatterns = [
      /\bauthenticate\(\s*"([^"]+)"\s*\)/g,
      /\breason:\s*"([^"]+)"/g,
      /_REASON\s*=\s*"([^"]+)"/g,
      /\brevealMnemonic\([^,()]+,\s*"([^"]+)"\)/g,
      /\brecoverStorage\(\s*"([^"]+)"\s*\)/g,
      /\buseWalletLogin\([^,()]+,\s*"([^"]+)"\)/g,
    ];
    const zh = builtinMessages("zh-CN");
    const en = builtinMessages("en-US");
    const violations: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const rel = relative(root, file);
      for (const pattern of forbidden)
        if (pattern.test(source))
          violations.push(`${rel}: passes translated text (${pattern})`);
      for (const pattern of keyPatterns)
        for (const match of source.matchAll(pattern)) {
          const key = match[1];
          // 没有点号的是状态枚举（"network"、"scan"），不是文案 key
          if (key === undefined || !key.includes(".")) continue;
          if (
            zh[normalizeMessageKey(key)] === undefined ||
            en[normalizeMessageKey(key)] === undefined
          )
            violations.push(
              `${rel}: prompt key "${key}" is not in the built-in dictionary`,
            );
        }
    }
    expect(violations).toEqual([]);
  });

  it("follows the in-app language preference, then the device language", () => {
    expect(promptLocale(() => "zh-CN")).toBe("zh-CN");
    expect(promptLocale(() => "en-US")).toBe("en-US");
    usePreferencesStore.getState().setLocale("zh-CN");
    expect(promptLocale(() => "en-US")).toBe("zh-CN");
  });

  it("authenticate() hands the OS the built-in text, not the key and not a remote string", async () => {
    enrolledLevel.mockResolvedValue(
      LocalAuthentication.SecurityLevel.BIOMETRIC_STRONG,
    );
    authenticateAsync.mockResolvedValue({ success: true });
    usePreferencesStore.getState().setLocale("en-US");
    await authenticate("backup.revealReason");
    expect(authenticateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        promptMessage: "Verify your identity to view the recovery phrase",
      }),
    );
  });
});
