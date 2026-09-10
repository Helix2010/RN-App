import { defineConfig } from "eslint/config";
import expoConfig from "eslint-config-expo/flat.js";

const typescriptPlugin = expoConfig.find(
  (config) => config.plugins?.["@typescript-eslint"],
)?.plugins?.["@typescript-eslint"];

export default defineConfig([
  ...expoConfig,
  {
    files: ["**/*.{ts,tsx}"],
    ignores: ["node_modules/**", ".expo/**", "coverage/**", "dist/**"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: typescriptPlugin
      ? { "@typescript-eslint": typescriptPlugin }
      : undefined,
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.name='fetch']:not([callee.object.name='apiClient'])",
          message: "HTTP must go through src/core/network.",
        },
        // 密钥材料不能进日志：console 在 release 包里照样输出到 logcat，
        // 崩溃上报和埋点 SDK 也会带走它（安全评审 12.2）
        {
          selector:
            "CallExpression[callee.object.name='console'] Identifier[name=/^(phrase|mnemonic|privateKey|secret|seedPhrase|wrapKey|entryKey)$/]",
          message:
            "Never log key material (phrase / mnemonic / privateKey / secret / wrapKey).",
        },
        {
          selector:
            "CallExpression[callee.object.name='console'] MemberExpression[property.name=/^(phrase|mnemonic|privateKey|params)$/]",
          message:
            "Never log route params or key material; log an identifier instead.",
        },
      ],
    },
  },
  {
    files: ["src/features/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "tamagui",
              message:
                "Feature code must use src/design-system instead of vendor UI APIs.",
            },
          ],
        },
      ],
    },
  },
  {
    // 预测市场接真实平台：生产代码不得引用 Mock 网关、夹具或 Mock 运行时（DEX 尚未接入，不在此列）
    files: [
      "src/features/predict/**/*.{ts,tsx}",
      "src/features/foundation/foundation-home-screen.tsx",
    ],
    ignores: [
      "src/features/predict/**/*.spec.{ts,tsx}",
      "src/features/predict/api/mock-predict-gateway.ts",
      "src/features/predict/fixtures/**",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "tamagui",
              message:
                "Feature code must use src/design-system instead of vendor UI APIs.",
            },
          ],
          patterns: [
            {
              group: ["**/core/mock/**", "**/fixtures/**", "**/mock-*-gateway"],
              message:
                "Predict production code must not depend on mock gateways, fixtures or the mock clock.",
            },
          ],
        },
      ],
    },
  },
]);
