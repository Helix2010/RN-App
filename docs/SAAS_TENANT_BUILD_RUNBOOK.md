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
4. 为该租户生成一把**独立**的 OTA 签名密钥并装进它自己的服务端（§3.2.2）。**每租户一把、每环境一把**，不得复用：密钥按租户存在服务端 `app_configs` 的 `ota.signing` 里，每个租户的包里编的是它自己那张证书；共用一把就意味着任何一个租户（或 staging）泄露，所有租户的 OTA 真实性一起失效。staging 和生产也各一把——staging 的私钥必然更多人碰得到。
5. 运行配置检查：

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

需要 syft（CI 里按固定版本 + sha256 下载，不进 `package.json`）。**这份 SBOM 只覆盖 JS 依赖**：APK 里是 dex 不是 jar，原生那一半扫不出来；文件自己的 `rn-app:coverage` 属性会如实写着 `javascript-only`。原生依赖的清单在 `gradle/verification-metadata.xml`（见 §3.2.3），两份合起来才是完整的物料清单。

### 3.2.1 OTA 信任根门禁（安全评审 N19，默认关闭）

`EXPO_REQUIRE_OTA_SIGNING=1` 打开后，任何会真正启用 OTA 的非 development 构建缺 `EXPO_UPDATES_CODE_SIGNING_CERTIFICATE` 即失败，两道都会拦：`pnpm android:release` 在跑任何构建步骤之前先报错，`expo prebuild` 走到 `app.config.ts` 时再报一次。

**现在默认关闭是有意的**：还差密钥仪式这一步。服务端签名已经就位（2026-09-11，见 RN-Server `docs/OPERATIONS_AND_RELEASE.md` §5「OTA」），开关默认打开的前提是先有密钥、且已装进服务端。

### 3.2.2 OTA 签名密钥仪式（发布负责人 + 服务端/运维）

**顺序不能反**：先装服务端密钥，再发带证书的原生包。反过来的话，新包的所有设备都收不到 OTA——它们要求验签，而服务端给不出签名。

**正常路径是管理端**：应用配置 → OTA 签名密钥 → 生成并装入。私钥在服务端生成、加密落库，一次都不经过浏览器或运维机；`expectedVersion` 由页面从当前记录自己填；生成完在同一页下载证书。下面这套命令行流程留给两种情况：管理端还没部署，或者要导入一把外部已有的密钥。

为什么允许服务端生成：签每一份 manifest 时服务端本来就必须把明文私钥解出来，让它在那边诞生没有扩大暴露面，却省掉了运维机上的明文文件、跨机器搬运、以及靠人记得 shred 的纪律——2026-09-11 的一次轮换就死在搬运这一段（`mv` 跑了两次，curl 指向了一个已经不存在的文件，而"换了"其实没换）。代价是没有离线备份，但丢了这把密钥的代价本来就等于主动轮换它的代价：发一个原生新版。**Android keystore 不适用这条推论**——服务端运行时根本不用它，而它丢了没有任何补救。

1. 生成密钥对。**在你打算长期保管私钥的那台机器上**执行——私钥生成在哪台机器，就等于它被保管在哪：

   ```bash
   pnpm ota:keygen --tenant anyfun          # 交互式
   pnpm ota:keygen --tenant anyfun --out /secure/keys/anyfun-ota --yes
   ```

   脚本只用 openssl、不联网、不需要 node_modules，可以直接拷到运维机上跑（`scripts/generate-ota-signing-key.sh` 是自包含的）。它拒绝写进仓库、拒绝覆盖已有密钥、私钥 0600。

   **为什么不直接 `openssl req -x509`**：expo-updates 会检查叶证书带 `X509v3 Key Usage: Digital Signature` 与 `X509v3 Extended Key Usage: Code Signing`（`CertificateChain.kt:39-58`）。少任何一个都会在**运行时**被拒，症状是所有设备静默停在内置 bundle。脚本显式写这两个扩展，并在生成后逐条复验；测试里也钉住了这两条。

   产出 `private-key.pem`（机密）、`certificate.pem`（公开）、`signing-key.json`（第 2 步直接用的请求体，**含私钥，装完 shred**）。

2. 把私钥与证书装进服务端（私钥在服务端用 storage master key 加密落库，之后只能整把替换，读不回来）。PEM 带换行，**不要手拼 JSON**——用第 1 步生成的请求体：

   ```bash
   curl -sS -X PUT https://<租户域名>/v1/admin/ota/signing-key \
     -H "content-type: application/json" -H "x-admin-key: $ADMIN_API_KEY" \
     --data-binary @/secure/keys/anyfun-ota/signing-key.json
   shred -u /secure/keys/anyfun-ota/signing-key.json
   ```

   服务端会校验证书与私钥是一对——不匹配的话它签得出来而客户端一定验不过，症状是所有设备静默停在内置 bundle。

3. 用 `GET /v1/admin/ota/signing-key` 记下 `certificateSha256`，与下一步编进包里的那份证书核对。

4. 构建带证书的原生包：`EXPO_UPDATES_CODE_SIGNING_CERTIFICATE=<certs/certificate.pem>`（可放 `.env.local`，证书是公钥材料），并把 `EXPO_REQUIRE_OTA_SIGNING=1` 打开，让"忘了带证书"变成构建失败而不是一个不验签的包。

5. 发布后验证：用装了新包的设备拉一次 OTA，确认更新能装上（能装上就说明验签通过）。**故意用错的证书再验一次**——那次必须失败并停在内置 bundle，否则说明验签根本没生效。

在密钥装进服务端之前，OTA 仍然只有完整性（bootstrap 下发的 sha256）而没有真实性，这一条是评审 §12.1 未关闭的 P0 门禁。

**这套仪式每个租户都要走一遍，每个环境也要走一遍**（见 §2 第 4 步）。密钥是按租户存的，证书是按租户编进包的，共用一把 = 任何一处泄露就打穿全部。

#### 轮换（私钥泄露、到期前、保管人交接）

```bash
# 1. 先看线上当前版本号
curl -sS https://<租户域名>/v1/admin/ota/signing-key -H "x-admin-key: $ADMIN_API_KEY"
# 2. 用那个 version 作为 --expected-version 生成新密钥（旧目录先整个移走，脚本拒绝覆盖）
pnpm ota:keygen --tenant <slug> --expected-version <线上 version> --out /secure/keys/<slug>-ota-2 --yes
# 3. PUT 进去（请求体已经带好 expectedVersion，不用手改 JSON）、shred、销毁旧私钥
```

请求体装完就要 shred，但 PUT 会失败、环境会重装。要它再来一次用 `--rebuild-body`，它只读 `--out` 目录里已有的两个 PEM 重新拼请求体，不碰密钥本身：

```bash
pnpm ota:keygen --tenant <slug> --out /secure/keys/<slug>-ota --rebuild-body --expected-version <线上 version> --yes
```

`expectedVersion` 是服务端的乐观锁：不等于线上当前 `version` 就拒绝写入。两个人同时换密钥时，后一个必须失败而不是悄悄盖掉——被盖掉的那把可能正是刚编进原生包的那张证书对应的私钥。

**轮换的时机不自由**：已经装在用户手机上、内嵌旧证书的原生包只认编进包里的那张证书，OTA 换不了自己的证书。所以换掉的那一刻，旧版设备就再也验不过任何 OTA，直到它们升到带新证书的原生版本。只有两种安全时机：还没有任何原生包带过证书（此时零成本），或者你已经准备好立刻发带新证书的原生版本并接受这段空窗。

### 3.2.3 Gradle 依赖校验（安全评审 N28）

`gradle/verification-metadata.xml` 给每一个 Android 依赖记了 sha256（当前 1313 个组件）。`GRADLE_DEPENDENCY_VERIFICATION=1` 时，`plugins/with-gradle-dependency-verification.js` 在 prebuild 把它装进 `android/gradle/`，Gradle 会在**下载之后、使用之前**逐个比对——被顶替的 maven 仓库、被改写的缓存、下毒的传递依赖都会当场失败，而不是安静地进 APK。

**为什么默认关闭**：Gradle 的依赖校验靠"文件在不在"生效，没有 lenient 档。清单里少任何一条都会让构建失败，而升一个 Expo 小版本、加一个原生模块、甚至 AGP 换个变体都会引入清单里没有的坐标。这条路径是发布门禁，让它在无人预期的时候变红，结果一定是有人为了发版把校验关掉、然后再也不打开。先用开关在 CI 上跑一段时间，确认"改依赖 → 重新生成"这条流程真的走得通，再把默认改成开。

依赖变了就必须重新生成，否则开着开关的构建会直接失败：

```bash
pnpm android:verification-metadata <slug>
```

它跑一次**真实的 release 构建**并让 Gradle 记下全部解析结果——只有真实构建才覆盖得到所有配置（buildscript 类路径、各个 Expo 子工程、变体相关的依赖）；`:app:dependencies` 只解析依赖图，取不到 `.aar`。生成期间脚本会强制把校验关掉，否则就是拿旧清单去校验、再用校验失败的结果写新清单。写出前校验组件数不低于 1000，一份残缺的清单比没有更坏——它会被强制执行，然后在别人手里炸成"依赖校验失败"。

**脚本会自己建一个临时的 `GRADLE_USER_HOME`，在冷缓存下生成，完事删掉。** 这不是保险起见：暖缓存里 Gradle 用的是已解析的模块元数据，不会重读原始 `.pom` / `.module`，那些文件就不会被记进清单。2026-09-11 第一次用开发机缓存生成的清单，在冷缓存下差一条 `guava-parent-33.3.1-jre.pom` 就把构建打挂了——而 CI 的 runner 每次都是冷的。代价是重新生成要把依赖整套下一遍（约 1 GB / 十几分钟）。

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
