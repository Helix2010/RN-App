# Feature: release 构建一律不签名（签名闸 RN-App 部分）

状态：Implemented · 日期：2026-09-16  
依据：RN-Server `docs/design/android-signing-gate-2026-09-16.md`「已定事项」「实现细节 → RN-App」「测试 → RN-App」「现有租户的签名密钥重置」。

## 用户场景与现状证据

- 用户/角色：构建机（amos 上的 build-agent / build-runner）、发布负责人、开发者。
- 当前行为：`plugins/with-release-signing.js` 在非 development 构建里注入读四个签名环境变量的 release signingConfig；`pnpm android:release` 要求 `tenant.json.signerSha256` 与这四个变量，产出已签名的 `app-release.apk`，复制前核对签名者。构建机因此在执行第三方依赖代码的同一个系统用户下持有解开的 keystore 与口令。Gradle 依赖校验靠 `GRADLE_DEPENDENCY_VERIFICATION` 开关，默认关。开发者本地自测用生产密钥出租户包。
- 非目标：签名闸本身、构建机拆进程、离线工具、服务端接口（RN-Server 另行实现）；`tenants/anyfun/tenant.json` 的 `signerSha256` 新值（离线重置密钥后才知道，本次不改）。

## Given / When / Then

1. Given 任意渠道 When `expo prebuild` Then release buildType 没有任何 signingConfig（模板的 `signingConfig signingConfigs.debug` 被删掉），插件不读任何签名环境变量；debug buildType 保持 debug 签名。
2. Given 租户没有 `signerSha256`、环境里没有任何签名材料 When `pnpm android:release <slug>` Then 构建照常进行，产出 `artifacts/<slug>-<version>-build<code>-release-unsigned.apk`。
3. Given Gradle 产出的包带 v1 签名文件、APK Signing Block，或 `apksigner verify` 通过，或 Gradle 写的是 `app-release.apk` When 复制前检查 Then 失败，不复制。`apksigner` 本身跑不起来不算“没有签名”的证据。
4. Given 非 development 渠道 When prebuild Then 依赖校验清单一律装入；`pnpm android:release` 在 Gradle 之前确认清单在位且不少于 1000 个组件、没有任何来源（`android/gradle.properties`、`$GRADLE_USER_HOME/gradle.properties`、`GRADLE_OPTS`/`JAVA_OPTS`）把 `org.gradle.dependency.verification` 设成 strict 以外的值，否则失败；调 Gradle 时显式传 `--dependency-verification strict`；`GRADLE_DEPENDENCY_VERIFICATION` 不再有任何作用。
4a. Given `--write-verification-metadata` When 清单写完 Then 删掉 Gradle 输出的 APK 并退出，不做产物检查、不复制到 `artifacts/`（这次构建没做依赖校验）。
5. Given `--apk` 指向租户包，或 `EXPO_PUBLIC_TENANT` / 解析后的 Expo 配置是租户包名 When `pnpm android:dev-signed` Then 拒绝签名，并说明正式包只由签名闸产出。
6. Given 开发包名的未签名包与本机测试密钥 When `pnpm android:dev-signed --apk` Then 先把输入复制进 0700 临时目录，检查、对齐、签名、复核都对副本做；签完复核签名者只有本机测试密钥、包名仍是开发包名，才复制到 `artifacts/`；口令不打印、不进命令行参数。
6a. Given 签名者或 `tenant.json.signerSha256` 是 2026-09 重置作废的旧指纹（anyfun `1a5d9fb4…`、predict-kim `9ab5fbe6…`，与服务端常量同一份）When `pnpm android:verify` Then 失败；后者提示换成重置后的新指纹。
6b. Given EAS 构建机（`EAS_BUILD` + `EAS_BUILD_PLATFORM=android`）When 非 development 渠道读取 `app.config.ts` Then 报错；iOS 与 development profile 不受影响。
7. Given `--apk` 指向带签名的包 When `pnpm sbom` Then 拒绝；绑定未签名包时 SBOM 属性写明 `rn-app:artifact-signing=unsigned`。

## UI 与交互状态

无 App 界面变化。

## 技术影响

- API/OpenAPI：App 调用的接口无变化。`contracts/rn-server.openapi.json` 已同步 RN-Server 签名闸分支的定稿契约（2026.09.22）：只增删了管理端、构建机、签名闸接口（含删除 `POST /v1/admin/build-keystore/generate`，旧签名变量名随之消失）；`/v1/mobile/*`、`/v1/public/*`、`/v1/ota/*` 的操作与它们引用的 schema 逐项比对无差异。
- 状态与本地数据：无。
- 钱包/签名/链/金额精度：无运行时影响。
- 权限、隐私与遥测：`ALLOWED_PERMISSIONS` 内容未改（签名闸内嵌同一份，改动须两边同一次变更）。
- **全量更新**：构建配置变化，只影响之后产出的原生包；不能也不需要 OTA。
- **发布链影响**：本地与 CI 再也签不出租户正式包；正式包只由签名闸产出。构建机（RN-Server `cmd/build-agent`）要按新文件名 `-release-unsigned.apk` 取产物，并不再注入签名环境变量。

## 与设计的偏离

- **development 渠道不强制 Gradle 依赖校验**。设计写的是“在 release 构建里强制开启”；这里的实现是所有非 development 渠道（`pnpm android:release`、构建机、EAS 各正式 profile）强制，development 渠道（`expo run:android`、`pnpm android:dev-signed` 的 assembleRelease）不装清单，并删掉残留的旧清单。理由：
  - 清单是按租户 release 构建生成的；development 渠道会链接 expo-dev-client / dev-launcher / dev-menu（正式渠道由 `with-production-android-optimizations` 排除），解析到的坐标和清单不是同一套，强制执行会让开发构建直接失败，而重新生成清单又只能覆盖正式构建那一套。
  - development 渠道的包用开发包名 `com.anyfun.foundation.dev`，服务端上传门禁天然拒收，只装在开发者自己的设备上，不分发。签名闸对正式包的保护不依赖开发构建。
  - 判定依据是 `app.config.ts` 解析出的渠道，不是环境变量开关，没有“关掉校验”的入口。

## 改动文件

| 文件 | 目的 |
| --- | --- |
| `plugins/with-release-signing.js`（+test） | 删掉 release buildType 的 signingConfig，不注入、不读环境 |
| `plugins/with-gradle-dependency-verification.js`（+test） | 按渠道决定安装：非 development 一律装，删开关；找出试图降档的属性来源 |
| `app.config.ts` | 签名插件对所有渠道生效；依赖校验插件传入渠道；EAS 构建机上拒绝非 development 的 Android 构建 |
| `scripts/check-build-profiles.test.js` | EAS Android 拒绝、iOS 与 dev client 放行 |
| `scripts/generate-ota-signing-key.sh` | 保管说明去掉原备份方案的“离线加密备份” |
| `scripts/build-android-release.mjs`（+test） | 读 `app-release-unsigned.apk`；去掉签名前置要求；依赖校验无条件要正向证据；内嵌配置从 APK 里读 |
| `scripts/lib/android-release-identity.js`（+test） | 拆出“没有签名”断言、包名/版本/权限、内嵌配置检查；已签名包复核保留给 `android:verify`，永久拒绝作废旧指纹 |
| `scripts/lib/apk-zip.js` | 只读 ZIP 结构：中央目录、APK Signing Block、单条目内容 |
| `scripts/lib/machine-env.js` | `.env.local` 机器配置加载（三个脚本共用） |
| `scripts/android-dev-signed.mjs`（+test） | 开发包名自测出包与测试密钥生成 |
| `scripts/lib/apk-test-fixture.js` | 测试用合成 APK（二进制 manifest）与假 SDK 工具 |
| `scripts/build-sbom.mjs`（+test） | 绑定未签名包并写明；拒绝带签名的包 |
| `scripts/verify-android-release.mjs` | 复核签名闸产出的包 |
| `scripts/generate-release-keystore.sh`（+test） | 删除 |
| `package.json` | 删本地 keystore 生成命令，加 `android:dev-signed` |
| `.github/workflows/app-quality.yml` | 注释改为签名闸与未签名包 SBOM |
| `docs/SAAS_TENANT_BUILD_RUNBOOK.md`、`docs/RELEASE_SIGNING_ROLLOUT.md`、`AGENTS.md`、`CLAUDE.md`、`README.md`、`.env.example` | 正式包只由签名闸产出；开发自测方式 |

## 验证与发布

- 脚本行为由测试钉死：沙箱里用假的 `pnpm`/`gradlew` 跑完整条 `android:release`，合成 APK 能被真实 `apksigner`/`aapt` 读懂；找得到 build-tools 35+（`ANDROID_HOME` 或 `RN_TEST_ANDROID_BUILD_TOOLS`）时用真工具，找不到时用模拟输出。
- 真实 `expo prebuild`（不跑 Gradle，产物已删）：`EXPO_PUBLIC_TENANT=anyfun` 生成的 `android/app/build.gradle` release buildType 没有 signingConfig（debug buildType 仍是 debug 签名），`android/gradle/verification-metadata.xml` 已装入（1313 个组件）；随后不带 `--clean` 做无租户 prebuild，残留清单被删除、release 仍无 signingConfig。
- 未运行：Gradle `assembleRelease`（本机没有 Android SDK），需在 amos 构建机上首次跑通时确认产物名为 `app-release-unsigned.apk`、依赖校验照常通过；`pnpm android:dev-signed` 的完整构建模式同理，只验证了 `--apk` 签名模式。
- 回滚：代码回滚到上一提交即可恢复旧构建脚本；但旧签名模式依赖的密钥已作废，回滚后也签不出可发布的包，出问题修复向前。
