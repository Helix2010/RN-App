import { defineConfig } from "eslint/config";
import expoConfig from "eslint-config-expo/flat.js";

const typescriptPlugin = expoConfig.find(
  (config) => config.plugins?.["@typescript-eslint"],
)?.plugins?.["@typescript-eslint"];

/**
 * 全局生效的语法禁令。**必须**被每一个另设 `no-restricted-syntax` 的配置块展开进去：
 * flat config 里同名规则是整体覆盖而不是合并，漏掉就等于在那个目录里把这些禁令关掉了
 * （而那些目录恰恰是最需要它们的地方）。
 */
const restrictedSyntax = [
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
  // 诊断日志会被上传给服务端（设计 diagnostic-report-2026-09-14 §3.3），
  // 所以同一条禁令对 logEvent 成立，而且还要多挡两种形状：
  // 把整个对象序列化进去、或者把 Error 直接 String() 进去——密钥材料
  // 正是这样"顺手"进入外泄通道的，没有人写过 logEvent(phrase)
  {
    selector:
      "CallExpression[callee.name='logEvent'] Identifier[name=/^(phrase|mnemonic|privateKey|secret|seedPhrase|wrapKey|entryKey)$/]",
    message:
      "Never log key material (phrase / mnemonic / privateKey / secret / wrapKey).",
  },
  {
    selector:
      "CallExpression[callee.name='logEvent'] CallExpression[callee.object.name='JSON'][callee.property.name='stringify']",
    message:
      "logEvent takes scalars only; serialising an object drags tokens, addresses and balances into the upload.",
  },
  {
    selector:
      "CallExpression[callee.name='logEvent'] CallExpression[callee.name='String']",
    message:
      "Log an error code, not String(error): an error message can carry the value that caused it.",
  },
];

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
      "no-restricted-syntax": ["error", ...restrictedSyntax],
    },
  },
  {
    // 密钥材料所在的两个目录：抛出点不许把**运行时值**拼进错误消息。
    // 这是最现实的泄漏路径——`throw new Error("invalid mnemonic: " + input)`
    // 会让助记词进 error.message，再被崩溃快照带走（设计 §3.2）。
    //
    // 放行全大写标识符：这个代码库里编译期常量一律这样命名，
    // 例如 `${MIN_PASSPHRASE_LENGTH}`（passphrase.ts）插的是下限而不是口令。
    // 小写变量、成员访问、函数调用一律拦——它们都可能是用户输入。
    files: ["src/core/wallet/keygen/**/*.ts", "src/core/wallet/vault/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...restrictedSyntax,
        ...[
          "ThrowStatement NewExpression TemplateLiteral > Identifier:not([name=/^[A-Z][A-Z0-9_]*$/])",
          "ThrowStatement NewExpression TemplateLiteral > :matches(MemberExpression, CallExpression)",
          "ThrowStatement NewExpression BinaryExpression[operator='+'] > Identifier:not([name=/^[A-Z][A-Z0-9_]*$/])",
          "ThrowStatement NewExpression BinaryExpression[operator='+'] > :matches(MemberExpression, CallExpression)",
        ].map((selector) => ({
          selector,
          message:
            "Throw a constant message or an error code here; putting a runtime value into the message can leak key material into error.message.",
        })),
      ],
    },
  },
  {
    // 日志设施在结构上就够不到密钥材料——这一层不依赖任何人记得住什么（设计 §3.1）
    files: ["src/core/diagnostics/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/wallet/vault/**", "**/wallet/keygen/**"],
              message:
                "Diagnostics must not be able to reach key material. Pass an already-safe string in instead.",
            },
          ],
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
