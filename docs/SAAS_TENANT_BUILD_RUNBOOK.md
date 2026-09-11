# SaaS 租户 App 打包规范

本规范适用于 RN-App 的所有租户。目标是让不同开发者或 AI 在切换租户、升级版本和生成 APK 时使用同一套可重复流程。

## 1. 唯一配置源

每个租户只允许有一个构建配置文件：

```text
tenants/<tenant-slug>/tenant.json
```

必须集中维护：

- `slug`、`appName`、`scheme`
- `apiBaseUrl`、`applicationId`
- `androidPackage`、`iosBundleId`
- `distributionChannel`、`otaChannel`
- `version`、`androidVersionCode`、`iosBuildNumber`
- `iconBackgroundColor`
- `icon.icon`、`icon.androidForeground`、`icon.androidBackground`、`icon.androidMonochrome`

`app.config.ts`、`eas.json`、CI workflow 和命令行不得复制租户域名、包名、applicationId、版本或 Build。构建环境只选择租户 slug；签名证书、`google-services.json`、OTA 私钥和推送凭证只能使用 Secret。

机器级构建输入统一放在 git 忽略的 `.env.local`（模板见 `.env.example`），不写进 tenant.json，也不在命令行传。Firebase 文件可以放在项目内 git 忽略的 `secrets/<tenant>/`，也可以放在仓库外：

```text
ANDROID_HOME=/home/<user>/android-sdk
GOOGLE_SERVICES_JSON=/path/to/RN-App/secrets/<slug>/google-services.json
```

`pnpm android:release <slug>` 会读取这两项；缺少 `GOOGLE_SERVICES_JSON` 时构建直接失败，只有明确传 `--no-push` 才允许出无推送的包。服务端推送凭证（FCM 服务账号、APNs 密钥）只放部署机的 `.env`，见 RN-Server `deploy/web4/README.md`。

## 2. 新增租户

1. 创建 `tenants/<slug>/tenant.json`。
2. 为该租户准备独立品牌资源：`assets/tenants/<slug>/`，并在 `tenant.json.icon` 中逐项指定文件名；不要复用其他租户的包名、签名或品牌资产。
3. 确认 API 域名指向对应租户，生产环境必须使用 HTTPS。
4. 运行配置检查：

```bash
pnpm config:check
EXPO_PUBLIC_TENANT=<slug> pnpm exec expo config --json
```

租户之间不得复用 Android applicationId、iOS Bundle ID、签名证书或缓存命名空间。

## 3. Android Release APK

统一使用：

```bash
pnpm android:release <tenant-slug>
```

例如：

```bash
pnpm android:release anyfun
```

禁止直接分开执行：

```bash
expo prebuild
./android/gradlew assembleRelease
```

因为 Expo 配置和 Gradle 可能读取不同环境，导致生产 APK 嵌入 `localhost` 或其他租户配置。

统一脚本会：

```text
读取 tenant.json
→ 生成 Expo 配置
→ 清理并生成 Android 原生工程
→ Gradle assembleRelease
→ 读取 APK 内嵌 app.config
→ 校验域名 / 渠道 / applicationId / 版本 / Build / OTA / runtimeVersion
→ 校验通过后输出租户命名的 APK
```

输出示例：

```text
artifacts/anyfun-1.2.1-build15-release.apk
```

构建失败时不得上传或发布旧产物。脚本在复制产物前已执行签名者、包名、版本与权限门禁（见 §3.2）；上传后服务端再按租户比对一次。

### 3.1 生产签名密钥（安全评审 N1）

Release 永远不用模板 `debug.keystore`。`plugins/with-release-signing.js` 在 prebuild 时把 release signingConfig 指向四个环境变量，缺任一个 prebuild 与 Gradle 直接失败：

```bash
export ANDROID_RELEASE_KEYSTORE_PATH=/abs/path/to/<slug>-release.jks   # 必须是绝对路径；可放 .env.local（只是路径）
export ANDROID_RELEASE_STORE_PASSWORD=...                           # 只能来自密钥管理服务 / CI secret
export ANDROID_RELEASE_KEY_ALIAS=...
export ANDROID_RELEASE_KEY_PASSWORD=...
```

生成与登记（一次性，由密钥保管人在干净机器上执行）。推荐用脚本，它会生成 PKCS12 keystore、提取 64 位小写指纹、把口令与 CI 用的 base64 写成 0600 文件而不上屏，并可选写入 tenant.json：

```bash
pnpm android:keystore --tenant <slug> --out /secure/keys/<slug>
```

手动等价步骤：

```bash
keytool -genkeypair -v -keystore <slug>-release.jks -alias <slug> -keyalg RSA -keysize 4096 -validity 10000
keytool -list -v -keystore <slug>-release.jks -alias <slug> | grep SHA256
```

把 SHA-256 指纹（去掉冒号、小写）写进 `tenants/<slug>/tenant.json` 的 `signerSha256`，并在 RN-Server 管理端为该租户登记同一指纹与包名。keystore 与口令进密钥管理服务并离线加密备份两份；仓库、`.env`、tenant.json 都不放密钥本体。密钥丢失等于全员重装。

无租户的开发构建使用 `tenants/development-identity.json` 声明的 `.dev` 包名与 Bundle ID；`pnpm config:check` 会拒绝任何与之相同、或租户之间重复的包名 / Bundle ID / scheme。

### 3.2 产物身份门禁

`pnpm android:release <slug>` 在复制产物前运行 `apksigner verify --print-certs` 与 `aapt dump badging`，要求：签名者 = `tenant.json.signerSha256`；永远拒绝 RN 模板 debug 指纹 `fac61745…1033b9c`；包名 / versionCode / versionName 与 tenant.json 一致；不含 `android.permission.SYSTEM_ALERT_WINDOW`。对任意已有 APK 复跑：

```bash
pnpm android:verify artifacts/<slug>-<version>-build<code>-release.apk <slug>
```

CI 的 `android-release-gate` job 在 main 与手动触发时用受保护环境 `android-release` 的 secrets（`ANDROID_RELEASE_KEYSTORE_BASE64`、`ANDROID_RELEASE_STORE_PASSWORD`、`ANDROID_RELEASE_KEY_ALIAS`、`ANDROID_RELEASE_KEY_PASSWORD`）完整构建并复核。

`EXPO_UPDATES_CODE_SIGNING_CERTIFICATE` 一旦设置，`app.config.ts` 会先确认那个路径真的存在（相对仓库根解析，与 expo-updates 一致）——拼错的路径原本会一路沉默到运行时才表现为"更新没有验签"。

CI 门禁在复核通过后还会生成一份 SBOM（`artifacts/<slug>-<version>-build<code>-sbom.cdx.json`，CycloneDX，保留 90 天）并绑定到该 APK 的 sha256。本地复现：

```bash
pnpm sbom --tenant <slug> --apk artifacts/<slug>-<version>-build<code>-release.apk
```

需要 syft（CI 里按固定版本 + sha256 下载，不进 `package.json`）。**这份 SBOM 只覆盖 JS 依赖**：本工程没有 Gradle 依赖锁定，APK 里是 dex 不是 jar，原生那一半扫不出来；文件自己的 `rn-app:coverage` 属性会如实写着 `javascript-only`。要补上原生的一半，前置条件是给 Gradle 加 `verification-metadata.xml`（N28 的另一项欠账）。

### 3.2.1 OTA 信任根门禁（安全评审 N19，默认关闭）

`EXPO_REQUIRE_OTA_SIGNING=1` 打开后，任何会真正启用 OTA 的非 development 构建缺 `EXPO_UPDATES_CODE_SIGNING_CERTIFICATE` 即失败，两道都会拦：`pnpm android:release` 在跑任何构建步骤之前先报错，`expo prebuild` 走到 `app.config.ts` 时再报一次。

**现在默认关闭是有意的**：证书体系还没建立——密钥仪式、服务端对最终 manifest 与 directive 签名、`includeManifestResponseCertificateChain` 的自定义 plugin，三件一件都没到位。开关先就位，等证书发下来后把默认改成开、再把开关本身删掉。在那之前，OTA 仍然只有完整性（bootstrap 下发的 sha256）而没有真实性，这一条是评审 §12.1 未关闭的 P0 门禁。

### 3.3 已装机用户从 debug 签名迁移

完整的分步执行手册（角色、命令、预期输出、错误对照、迁移与收尾）见 `docs/RELEASE_SIGNING_ROLLOUT.md`。

Android 不允许签名不同的 APK 覆盖安装；旧密钥公开，也不能走 v3 轮换。第一个生产签名版本发布时：

1. 建议改用新包名（并排安装，用户先在旧 App 备份助记词、在新 App 导入、确认后再卸旧 App）；沿用旧包名则用户必须先卸载，卸载即清空本地钱包。
2. 给旧 runtime 发最后一个 OTA：全屏迁移引导（备份 → 下载 → 导入 → 卸载）。
3. bootstrap 提高 `minSupportedVersion`，`releaseNotes` 写迁移说明；旧包下载链接保留一段时间以便回退。
4. 客服口径：卸载前必须备份；未备份的钱包无法找回。

## 4. EAS 构建

EAS 只选择租户，不重复维护租户字段：

```bash
EXPO_PUBLIC_TENANT=<slug> eas build --profile android-direct
EXPO_PUBLIC_TENANT=<slug> eas build --profile production-store
```

若使用 CI，租户 slug 作为 workflow 输入或环境变量，敏感信息使用 GitHub Secrets。EAS 的 `staging`、`android-direct` 等非 development profile 会执行 `with-release-signing` 插件，同样需要在 EAS 环境里配置四个 `ANDROID_RELEASE_*` 变量，否则 prebuild 失败。任何版本变更都必须同时更新 `version` 和对应平台递增的 Build。

## 5. 版本和升级边界

- 修改 TS/JS、样式、文案且不改变原生 ABI：可发布 OTA。
- 修改原生模块、权限、Manifest、Bundle ID、图标、启动页或原生 SDK：必须发布全量 APK/IPA。
- `runtimeVersion` 必须与基线 App Version 一致。
- APK 的 `versionCode` / iOS buildNumber 必须递增。
- 发布前必须确认新 APK 实际可安装，再提升服务端最低支持版本。

## 6. 发布前检查

```bash
pnpm check
pnpm android:release <tenant-slug>
```

至少确认：

- APK 内 API 地址不是 localhost；
- applicationId、包名、渠道和租户一致；
- App Version、Build、Runtime Version 一致；
- OTA URL 和 channel 指向当前租户；
- 清装后能完成远程 Bootstrap；
- 覆盖安装满足签名和版本递增要求；
- `pnpm android:verify` 对产物通过：签名者 = 租户 `signerSha256`，不是 debug keystore，不含 `SYSTEM_ALERT_WINDOW`；
- RN-Server 管理端已登记该租户的包名与签名指纹，上传未被 `RELEASE_SIGNER_*` 拒绝。

## 7. 回滚

代码回滚到上一稳定提交；发布回滚通过管理端撤回当前版本并恢复上一条可安装的全量版本。原生配置错误不能依赖 OTA 修复。
