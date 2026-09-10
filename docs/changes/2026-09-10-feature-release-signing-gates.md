# Feature: 发布身份门禁与 APK 直装完整性校验（安全评审阶段 0a/0b）

状态：Implemented（待 codex 复核）· 日期：2026-09-10  
依据：`docs/design/cross-platform-wallet-key-security-adversarial-review-2026-09-09.md` 修订 3 的 N1、N2、N16、N18、N20、N28、N33；执行范围见 `docs/design/wallet-security-phase0-scope-2026-09-10.md` A2-1 至 A2-8。

## 用户场景与现状证据

- 用户/角色：发布负责人、CI、直装渠道的现有用户。
- 当前行为：`android/app/build.gradle` 的 release buildType 使用模板 `debug.keystore`（`signingConfig signingConfigs.debug`），`artifacts/` 下 1.2.4 至 1.2.11 全部 5 个 release APK 签名者为 `CN=Android Debug`，SHA-256 `fac61745…1033b9c`。构建脚本只校验内嵌 app.config，不看签名者与包名。CI 从不构建产物。客户端直装下载只比大小，丢弃 bootstrap 的 `sha256`，URL 只要求 `https://`。
- 代码调用链：`scripts/build-android-release.mjs` → `expo prebuild --clean` → `gradlew assembleRelease` → 复制到 `artifacts/`；`runtime-context.tsx` → `ApkDownloadManager.configure/run` → `apk-download.ts.openInstaller`。
- 非目标：生产密钥的生成与托管（组织决策，见运行手册 §3）；安装前读取 APK 签名证书（需原生模块）；OTA 签名。

## Given / When / Then

1. Given 非 development 渠道 When `expo prebuild` Then release signingConfig 只引用 `ANDROID_RELEASE_*` 环境变量；缺任一变量 prebuild 与 Gradle 直接失败，绝不退回 debug 签名。
2. Given 产物已构建 When 脚本复制到 `artifacts/` 前 Then `apksigner`/`aapt` 复核：签名者等于 `tenant.json.signerSha256`、永远拒绝 `fac61745…`、包名/versionCode/versionName 与租户一致、无 `SYSTEM_ALERT_WINDOW`；任一不符退出非 0。
3. Given 租户未登记 `signerSha256` When `pnpm android:release` Then 立即失败并指向运行手册。
4. Given bootstrap `update.full` When URL 非 https 或与租户 API 不同源、或 `sha256` 缺失 Then 下载管理器进入 `failed` 并上报遥测，不下载也不装作没有更新。
5. Given 下载完成 When 文件摘要 ≠ `sha256` Then 删除文件重下一次，仍不符进入 `failed`，从不进入 `ready`；冷启动恢复的完整文件同样先过摘要。
6. Given 两个租户 When `pnpm config:check` Then 包名、Bundle ID、scheme 两两不同，且不等于无租户开发构建身份 `com.anyfun.foundation.dev`。
7. Given CI When push 到 main 或手动触发 Then `android-release-gate` 用受保护环境的密钥完整构建并独立复核；没有配置 secrets 时该 job 失败。

## UI 与交互状态

- 下载弹层已有 `failed` 态（"下载失败 / 重试下载"），本次复用；`error` 文本不直接展示。
- 无新页面；无 light/dark 影响。

## 技术影响

- API/OpenAPI：无。
- 状态与本地数据：`ApkReleaseTarget` 新增 `sha256`、`allowedOrigin`；`ApkDownloadDeps` 新增 `hashFile`。
- 钱包/签名：无。
- 权限、隐私与遥测：Manifest 移除 `SYSTEM_ALERT_WINDOW`（`blockedPermissions`）；拒绝目标与摘要不符走既有 `error` 遥测阶段。
- **全量更新**：权限与签名配置变化必须发原生包，不能 OTA。
- **发布链影响（必须知悉）**：从本次起，没有生产密钥与 `tenant.json.signerSha256` 就打不出 release 包。这是有意的：见主评审 §4.2 与运行手册 §3。已装机用户从 debug 签名切到生产签名需要卸载重装，迁移方案见运行手册 §3.4。
- 开发构建身份从 `com.anyfun.foundation` 改为 `com.anyfun.foundation.dev`：本地 dev client 需重装一次；使用开发 `google-services.json` 的同事需在 Firebase 加该包名。

## 改动文件

| 文件 | 目的 |
| --- | --- |
| `plugins/with-release-signing.js`（+test） | prebuild 注入环境变量驱动的 release signingConfig；缺变量即失败 |
| `plugins/with-gradle-distribution-checksum.js`（+test） | `gradle-wrapper.properties` 固定 `distributionSha256Sum`（N28） |
| `scripts/lib/android-release-identity.js`（+test） | apksigner/aapt 解析与身份断言；拒绝 debug 指纹 |
| `scripts/verify-android-release.mjs` | 对任意 APK 复跑门禁（CI 与取证用） |
| `scripts/build-android-release.mjs` | 要求 `signerSha256` 与签名环境变量；复制前调用门禁 |
| `scripts/tenant-config.mjs` | `signerSha256` 格式校验 |
| `scripts/check-build-profiles.mjs` | 跨租户身份唯一性；不得等于开发构建身份 |
| `app.config.ts` | `blockedPermissions`；注册两个插件；开发构建身份改 `.dev` |
| `.github/workflows/app-quality.yml` | action 固定 SHA、`permissions: contents: read`、`android-release-gate` job |
| `src/core/updates/apk-download-manager.ts`（+spec） | 同源 + sha256 校验；拒绝目标以失败态呈现 |
| `src/core/updates/apk-download.ts` | 分块 SHA-256 |
| `src/app/runtime-context.tsx` | 传入 `sha256` 与 API origin |
| `package.json` | `android:verify`；prettier 覆盖 `scripts/**` |
| `docs/SAAS_TENANT_BUILD_RUNBOOK.md` | §3 签名密钥与环境变量、§3.4 用户迁移、§6 检查项 |

## 验证与发布

- 见交付说明中的实际运行结果（单测、lint、typecheck、format、config:check、对现有 debug 签名产物运行 `pnpm android:verify` 必须失败）。
- iOS / Android：本环境无法运行 Gradle 与真机；`expo prebuild` 产物中的 build.gradle 注入由插件单测覆盖，真实 `assembleRelease` 需在具备 SDK 的构建机执行。
- 灰度指标与停止条件：不适用（构建链变更）；客户端侧观察 `update` 遥测 `error` 阶段中 `apk` 渠道的占比。
- 回滚：revert 本变更；客户端部分可 OTA 回滚，构建链部分只影响构建机。

## 追加（2026-09-10）：独立评审后的修正

- 内置字典拆出 `src/core/config/builtin-messages.ts`（无运行时依赖），`fallback-config.ts` 与 `scripts/export-i18n-seed.mjs` 改读它；此前 `app-lock → prompt-text → fallback-config → api-client` 的依赖链让 `update-service.spec.ts` 5 个用例失败。测试 setup 改为延迟加载 app-lock，避免抢在各 spec 的 `jest.mock` 之前加载 `expo-localization`。
- `builtinPromptText` 对未知 key 抛错（不再退回通用文案掩盖错误）；`authenticate()` 先解析文案再进入 try，编码错误不会被记成用户认证失败。`prompt-text.spec.ts` 新增静态扫描：全部 `authenticate/reason/_REASON/revealMnemonic/recoverStorage/useWalletLogin` 调用只能传 key，且 key 必须在内置字典。
- 下载管理器：冷启动完整文件摘要不符改为删除 + 失败态 + 上报（与下载后路径一致）；同一被拒目标只告警、上报一次；目标类型收窄为已校验目标，删除不可达分支。
- 验证脚本：解析 `uses-permission-sdk-23:`；多签名者（v3.1 轮换链）明确拒绝并有测试；移除从未传入的 `forbiddenPermissions` 参数。
- 构建脚本：`ANDROID_RELEASE_KEYSTORE_PATH` 必须是绝对路径（Gradle 相对 `android/app` 解析）。CI 的 keystore secret 改经 `env` 传入。
- 测试夹具：`RN_TENANTS_ROOT`（仅 Jest 子进程生效）让脚本测试用临时目录，不再往仓库 `tenants/` 写文件；新增 `scripts/check-build-profiles.test.js`（重复包名、开发身份、指纹格式、正常通过）。
- 开发构建身份单一来源 `tenants/development-identity.json`；`root-error-boundary` 改用共享的 `systemLocale()`。
- 范围文档 §6 记录了 A1-2、A2-2、A2-3、A2-4、A2-5 相对范围表的收窄与理由。

## 追加（2026-09-10）：密钥生成脚本

- `scripts/generate-release-keystore.sh`（`pnpm android:keystore`）：交互式或参数化生成租户的 PKCS12 生产签名 keystore（RSA 4096、SHA256withRSA、默认 10000 天），提取 64 位小写指纹，把口令与 CI 用的 base64 写成 0600 文件而不上屏，可选写入 `tenant.json` 的 `signerSha256`；拒绝仓库内输出目录、拒绝覆盖已有 keystore、tenant.json 已登记指纹时需 `--force`。测试 `scripts/generate-release-keystore.test.js`（有 keytool 时运行）覆盖生成、写入、两道拒绝与仓库内目录拒绝。

## 首次生产签名构建（2026-09-10）

- 密钥：`pnpm android:keystore` 生成，别名 `anyfun`，`CN=AnyFun Release, O=AnyFun, C=CN`，RSA 4096 / SHA256withRSA，有效期至 2054-01-26；证书 SHA-256 `1a5d9fb446e2f4c8e1aa464a02b14248a265ea9c554f83eb01ec94886329e694`，已写入 `tenants/anyfun/tenant.json`（版本同时提到 1.3.0 / 26）。keystore 与口令在保管人机器，不入库。
- 构建：`pnpm android:release anyfun`（含 FCM 配置）BUILD SUCCESSFUL 3m01s；门禁输出 `Release identity verified: signer 1a5d9f… · com.anyfun.foundation 1.3.0 (26) · 34 permissions`。
- 独立复核：`pnpm android:verify` 通过；`apksigner` 签名者 DN 为 AnyFun Release；`aapt` 无 `SYSTEM_ALERT_WINDOW`；内嵌配置 runtime 1.3.0、direct/production、push 已配置、无 OTA 代码签名证书（阶段 0b）。
- 产物：`artifacts/anyfun-1.3.0-build26-release.apk`，38,717,622 字节，SHA-256 `30a6725bfd54e89a143c6aee38a81c0813c5dfde660a8ac09ad8f4991a5456ec`。构建日志中无口令。
- 未完成：服务端 pin 登记、CI secrets、上传发布、旧用户迁移 OTA（引导页尚未开发），见 `docs/RELEASE_SIGNING_ROLLOUT.md` §3–§8。包名沿用 `com.anyfun.foundation`（方案 B，用户需卸载重装）；如改方案 A 需重建。

## 追加（2026-09-10）：推送前修正

- `expo` 由 `~57.0.20` 升到 `~57.0.21`：main 上的 `app-quality` 此前连续失败在 `scripts/check-expo-doctor.mjs`（SDK 要求 57.0.21），而新增的 `android-release-gate` 依赖 `verify` 通过，不修则门禁永远不跑。本地 expo-doctor 21/21 通过。
- `scripts/build-android-release.mjs` 新增 `RN_ENV_ROOT`（仅 Jest 子进程生效）：脚本测试把 `.env` 查找根指到临时目录，断言不再受开发者本机 `.env.local` 里的 `ANDROID_RELEASE_KEYSTORE_PATH` 影响（此前登记路径后「缺少签名材料」用例会因缺失列表变化而失败）。
- GitHub `android-release` 环境的 4 个 secrets 已由保管人配置；密钥库与口令仍只在保管人机器，不入库。
