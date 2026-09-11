import { authenticate } from "../../security/app-lock";
import type { AuthenticatePort } from "./ports";

/**
 * 平台身份验证。**发布构建里 `KeystoreVault` 只用这一个实现**，不接受注入。
 *
 * 单独一个文件是为了避免环行依赖（`expo-ports` 也 import 金库相关的东西），
 * 顺便让下面那个开关可以被测试替换——它本身在发布包里是编译期常量。
 */
export const platformAuthenticate: AuthenticatePort = (reason) =>
  authenticate(reason);

/**
 * 认证能不能被替换（安全评审 N6）。
 *
 * 金库与端口都是导出的，同信任域里的任何 JS——一个 OTA 下来的 bundle、一个被投毒
 * 的依赖——都能 `new KeystoreVault({..., authenticate: async () => "success" })`，
 * 零弹窗拿到包裹密钥，进而解开所有私钥。
 *
 * `__DEV__` 与 `process.env.NODE_ENV` 都是**编译期常量**：打包器在构建时就把它们
 * 替换成字面量，所以发布包（包括 OTA bundle，它同样是 production 构建）里这个
 * 函数直接被折叠成 `false`，运行时改环境变量改不动它。这也是它必须单独成一个
 * 可被 mock 的模块的原因——否则测不了。
 */
export function authenticateOverrideAllowed(): boolean {
  return (
    (typeof __DEV__ !== "undefined" && __DEV__) ||
    process.env.NODE_ENV === "test"
  );
}
