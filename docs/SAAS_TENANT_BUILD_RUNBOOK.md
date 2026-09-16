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

`app.config.ts`、`eas.json`、CI workflow 和命令行不得复制租户域名、包名、applicationId、版本或 Build。构建环境只选择租户 slug；`google-services.json`、OTA 私钥和推送凭证只能使用 Secret。Android 签名密钥不进任何构建环境，只有签名闸解得开（§3.1）。

机器级构建输入统一放在 git 忽略的 `.env.local`（模板见 `.env.example`），不写进 tenant.json，也不在命令行传。Firebase 文件可以放在项目内 git 忽略的 `secrets/<tenant>/`，也可以放在仓库外：

```text
ANDROID_HOME=/home/<user>/android-sdk
GOOGLE_SERVICES_JSON=/path/to/RN-App/secrets/<slug>/google-services.json
```

`pnpm android:release <slug>` 会读取这两项；缺少 `GOOGLE_SERVICES_JSON` 时构建直接失败，只有明确传 `--no-push` 才允许出无推送的包。服务端推送凭证（FCM 服务账号、APNs 密钥）只放部署机的配置文件，见 RN-Server `deploy/amos/README.md`（2026-09-12 起生产在 amos，配置是 `/etc/rn-foundation.env`；此前是 web4 的 `.env`）。

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

**正式包（装到用户手机上的包）只由签名闸产出。** 在控制台「发布中心 → 打包任务」排 Android 安装包任务：构建机出未签名包，签名闸检查后签名，服务端落「待发布」。设计见 RN-Server `docs/design/android-signing-gate-2026-09-16.md`。仓库里没有正式签名模式——本地、CI、构建机都签不出租户的正式包。

构建机与本地复现统一使用：

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
→ 清理并生成 Android 原生工程（依赖校验清单随之装入）
→ 确认依赖校验会执行（清单在位、组件数不低于下限）
→ Gradle assembleRelease（release buildType 没有 signingConfig）
→ 断言产物没有签名
→ 校验包名 / 版本 / 权限；读取 APK 内嵌 app.config，校验域名 / 渠道 / applicationId / 版本 / Build / OTA / runtimeVersion
→ 校验通过后输出租户命名的未签名 APK
```

输出示例：

```text
artifacts/anyfun-1.3.16-build46-release-unsigned.apk
```

这个包没有签名，装不上设备；它是构建机交给签名闸的输入。构建失败时不得上传旧产物。本地开发要一个装得上设备的包，见 §3.4。

### 3.1 签名只在签名闸上做

- `plugins/with-release-signing.js` 在 prebuild 时删掉模板 release buildType 里的 `signingConfig signingConfigs.debug`，不注入任何 signingConfig、不读任何签名相关的环境变量，AGP 因此产出 `app-release-unsigned.apk`。debug buildType 保持模板的 debug 签名（`expo run:android` 要用）。
- 租户签名密钥在离线机器上生成，只以密文存进服务端，只有签名闸解得开；RN-App 仓库、开发机、构建机、CI 都不持有任何租户的签名密钥。生成、上传、签名闸确认与重置流程见设计文档「密钥生成与上传」「现有租户的签名密钥重置」。
- `tenants/<slug>/tenant.json` 的 `signerSha256` 是该租户登记证书的 SHA-256，**只用于**本地 `pnpm android:verify` 核对签名闸产出的包（§3.2）。构建不读它；构建任务里的 tenant.json 由服务端按登记的指纹合成。
- 密钥重置后要把 `signerSha256` 改成新指纹，见 `docs/RELEASE_SIGNING_ROLLOUT.md`。

无租户的开发构建使用 `tenants/development-identity.json` 声明的 `.dev` 包名与 Bundle ID；`pnpm config:check` 会拒绝任何与之相同、或租户之间重复的包名 / Bundle ID / scheme。

### 3.2 产物检查

**未签名包**：`pnpm android:release <slug>` 在复制产物前检查，任一不符即失败。这些是早期反馈，签名闸会独立再查一遍，它不采信构建机说的话。

- 没有签名：ZIP 里没有 `META-INF/*.SF|RSA|EC|DSA`，中央目录前没有 APK Signing Block，并且 `apksigner verify` 必须验证不通过（工具本身跑不起来不算）。Gradle 若产出的是 `app-release.apk`，说明有东西注入了签名配置，直接失败。
- 包名 / versionCode / versionName 与 tenant.json 一致；不含 `android.permission.SYSTEM_ALERT_WINDOW`；权限都在 `scripts/lib/android-release-identity.js` 的 `ALLOWED_PERMISSIONS` 里。**签名闸内嵌了同一份允许列表，改这份列表必须和签名闸在同一次变更里一起改。**
- 内嵌 app.config（从 APK 里读 `assets/app.config`）与本次构建一致。

**签名闸产出的正式包**：从控制台下载后复核。

```bash
pnpm android:verify <下载的 apk> <slug>
```

要求签名者 = `tenant.json.signerSha256`，永远拒绝 RN 模板 debug 指纹 `fac61745…1033b9c` 与 2026-09 重置作废的租户旧指纹（`RETIRED_SIGNER_SHA256`，与服务端常量同一份），包名 / 版本 / 权限同上。`tenant.json` 里的 `signerSha256` 本身还是作废指纹时也直接失败，提示换成重置后的新指纹。

`EXPO_UPDATES_CODE_SIGNING_CERTIFICATE` 一旦设置，`app.config.ts` 会先确认那个路径真的存在（相对仓库根解析，与 expo-updates 一致）——拼错的路径原本会一路沉默到运行时才表现为"更新没有验签"。

**SBOM 由构建机生成**（2026-09-12 从 CI 挪过来）。构建机在产物检查通过、worktree 还在的时候调 `scripts/build-sbom.mjs`，扫的是这次构建自己的 `pnpm-lock.yaml`，绑定的是**未签名包**的文件名与 sha256，并在属性 `rn-app:artifact-signing` 里写明 `unsigned`。签名闸签完之后文件 sha256 会变，发布记录的 `file_metadata.unsignedSha256` 把 SBOM 与已签名包连起来。`--apk` 指向带签名的包时脚本拒绝。生成失败整个构建任务失败——一个静默跳过的门禁比没有门禁更坏。构建机上的 syft 用 `RN-Server/deploy/amos/install-syft.sh` 装，版本与 sha256 都写死在脚本里。本地复现：

```bash
pnpm sbom --tenant <slug> --apk artifacts/<slug>-<version>-build<code>-release-unsigned.apk
```

需要 syft（固定版本 + sha256，不进 `package.json`）。**这份 SBOM 只覆盖 JS 依赖**：APK 里是 dex 不是 jar，原生那一半扫不出来；文件自己的 `rn-app:coverage` 属性会如实写着 `javascript-only`。原生依赖的清单在 `gradle/verification-metadata.xml`（见 §3.2.3），两份合起来才是完整的物料清单。

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

   不想等一个原生包也能先验签名链路：

   ```bash
   OTA_RUNTIME=1.3.7 OTA_CERTIFICATE=~/ota-keys/<slug>/certificate.pem \
     scripts/ota-signature-android-check/run.sh https://<租户域名>/v1/ota/manifest
   ```

   它把服务端真实下发的签名与正文推到**真实 Android 运行时**上，用 `CertificateChain.kt` 的原判据跑一遍。服务端的 Go 测试证明的是"我们的实现自洽"，而客户端跑的是 Android 的 Conscrypt，是另一套实现；两者不一致的症状是所有设备静默停在内置 bundle，线上完全看不出来。

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

`gradle/verification-metadata.xml` 给每一个 Android 依赖记了 sha256（当前 1313 个组件）。`plugins/with-gradle-dependency-verification.js` 在 prebuild 把它装进 `android/gradle/`，Gradle 会在**下载之后、使用之前**逐个比对——被顶替的 maven 仓库、被改写的缓存、下毒的传递依赖都会当场失败，而不是安静地进 APK。

**所有非 development 渠道的构建强制执行，没有开关。** release 包由构建机产出，构建机执行几千个第三方依赖的代码；依赖校验是交给签名闸之前唯一挡得住"被顶替的依赖"的地方，不能留一个能关掉它的环境变量。Gradle 的依赖校验成功时一个字都不打，所以 `pnpm android:release` 在 prebuild 之后、Gradle 之前先确认清单在位、组件数不低于 1000，否则不构建。

Gradle 的依赖校验有 `strict`、`lenient`、`off` 三档，可以用 `--dependency-verification` 或 gradle 属性 `org.gradle.dependency.verification` 切换。`pnpm android:release` 调 Gradle 时显式传 `--dependency-verification strict`（命令行参数优先于同名属性）；构建前还会检查 `android/gradle.properties`、`$GRADLE_USER_HOME/gradle.properties`（默认 `~/.gradle`）与 `GRADLE_OPTS` / `JAVA_OPTS`，任何一处把这个属性设成 strict 以外的值都直接失败。

development 渠道（`expo run:android`、`pnpm android:dev-signed`）不装清单，并删掉工程里残留的旧清单：开发构建链接 expo-dev-client 一系，解析到的坐标和清单不是同一套，而开发包不分发。

strict 下清单里少任何一条都会让 release 构建失败。升 Expo、加原生模块、AGP 换变体都会引入新坐标，改依赖就必须连带重新生成清单——这是预期行为，不要靠删清单绕过去：

```bash
pnpm android:verification-metadata <slug>
```

它跑一次**真实的 release 构建**并让 Gradle 记下全部解析结果——只有真实构建才覆盖得到所有配置（buildscript 类路径、各个 Expo 子工程、变体相关的依赖）；`:app:dependencies` 只解析依赖图，取不到 `.aar`。生成时脚本会先删掉 prebuild 装进去的旧清单，否则就是拿旧清单去校验、再把旧条目并进新清单。写出前校验组件数不低于 1000，一份残缺的清单比没有更坏——它会被强制执行，然后在别人手里炸成"依赖校验失败"。这次构建本身没有做依赖校验，所以写完清单就退出：删掉 Gradle 输出的 APK，不做产物检查，也不往 `artifacts/` 复制任何安装包。

**脚本会自己建一个临时的 `GRADLE_USER_HOME`，在冷缓存下生成，完事删掉。** 这不是保险起见：暖缓存里 Gradle 用的是已解析的模块元数据，不会重读原始 `.pom` / `.module`，那些文件就不会被记进清单。2026-09-11 第一次用开发机缓存生成的清单，在冷缓存下差一条 `guava-parent-33.3.1-jre.pom` 就把构建打挂了。代价是重新生成要把依赖整套下一遍（约 1 GB / 十几分钟）。

### 3.3 签名密钥重置后的已装机用户

完整的分步执行手册（角色、命令、预期输出、迁移与收尾）见 `docs/RELEASE_SIGNING_ROLLOUT.md`。

Android 按"包名 + 签名证书"认升级，证书一换，系统就认为这是另一个 App。2026-09 起现有租户的签名密钥全部重置、沿用原包名，所以已装机用户必须先卸载旧 App 再装签名闸产出的新包，本机钱包数据随卸载清空，用助记词恢复：

1. 发布说明与客服口径写清：卸载前确认助记词已备份；未备份的钱包无法找回。
2. bootstrap 提高 `minSupportedVersion`，`releaseNotes` 写迁移步骤；设备已装包与目标发布的签名指纹不一致时，服务端自动对这台设备关闭 `directUpdateEnabled`，避免应用内安装失败循环。
3. 旧指纹由服务端永久拒绝，不提供回退。

### 3.4 开发自测（开发包名 + 本机测试密钥）

本地要一个能装上设备的 release 包，只能用开发包名 `com.anyfun.foundation.dev`（`tenants/development-identity.json`）和这台开发机自己生成的测试密钥：

```bash
pnpm android:dev-signed keygen                 # 每台开发机一次：生成测试密钥
pnpm android:dev-signed                        # 无租户 prebuild + assembleRelease，签本机测试密钥
pnpm android:dev-signed --apk <未签名开发包>     # 只给一个已构建好的未签名开发包签名
```

- 测试密钥放在仓库外：默认 `~/.rn-test-keys/`（目录 0700），可用 `RN_TEST_KEYS_DIR`（绝对路径，可放 `.env.local`）改；脚本拒绝把密钥放进仓库。口令随机生成，只写进 0600 文件，不打印、不进命令行参数（keytool 用 `-storepass:file`，apksigner 用 `--ks-pass file:`）；目录或文件对其他用户可读时脚本拒绝签名。
- 包名不是开发包名时脚本拒绝签名，例如设置了 `EXPO_PUBLIC_TENANT`（进程环境或 `.env.local`），或 `--apk` 传入了租户包。开发包名不是任何租户的登记身份，服务端上传门禁天然拒收，签出来的包只能装在自己的设备上。
- 输出 `artifacts/com.anyfun.foundation.dev-<version>-build<code>-test-signed.apk`，用 `adb install` 安装。
- 开发包连的是 `EXPO_PUBLIC_API_BASE_URL`（默认本机服务），不装依赖校验清单（§3.2.3），不分发。

**需要验证正式包行为**（例如对正式基线的热更新、App Links、直装升级、正式签名下的安装与覆盖升级）：在控制台排构建任务，从签名闸产出的包下载安装。不要试图在本地给租户包签名。

## 4. EAS 构建

EAS 只选择租户，不重复维护租户字段：

```bash
EXPO_PUBLIC_TENANT=<slug> eas build --profile android-direct
EXPO_PUBLIC_TENANT=<slug> eas build --profile production-store
```

若使用 CI，租户 slug 作为 workflow 输入或环境变量，敏感信息使用 GitHub Secrets。**EAS 不是 Android 正式包的发布路径**：release buildType 没有 signingConfig，而 EAS 托管签名会拿它自己的凭据给租户包名签名，绕开签名闸；Android 正式包只由签名闸产出（§3）。`app.config.ts` 在 EAS 构建机上（`EAS_BUILD` + `EAS_BUILD_PLATFORM=android`）遇到非 development 渠道直接报错，`android-direct` 等 profile 因此跑不起来；iOS 与 development profile（dev client，开发包名）不受影响。任何版本变更都必须同时更新 `version` 和对应平台递增的 Build。

## 5. 版本和升级边界

- 修改 TS/JS、样式、文案且不改变原生 ABI：可发布 OTA。
- 修改原生模块、权限、Manifest、Bundle ID、图标、启动页或原生 SDK：必须发布全量 APK/IPA。
- `runtimeVersion` 必须与基线 App Version 一致。
- APK 的 `versionCode` / iOS buildNumber 必须递增。
- 发布前必须确认新 APK 实际可安装，再提升服务端最低支持版本。

## 6. 发布前检查

```bash
pnpm check
```

然后在控制台排构建任务，等签名闸产出待发布记录，下载该包执行 `pnpm android:verify <apk> <tenant-slug>`。至少确认：

- APK 内 API 地址不是 localhost；
- applicationId、包名、渠道和租户一致；
- App Version、Build、Runtime Version 一致；
- OTA URL 和 channel 指向当前租户；
- 清装后能完成远程 Bootstrap；
- 覆盖安装满足签名和版本递增要求；
- `pnpm android:verify` 对签名闸产出的包通过：签名者 = 租户 `signerSha256`，不是 debug keystore，不含 `SYSTEM_ALERT_WINDOW`；
- RN-Server 管理端已登记该租户的包名与签名指纹，上传未被 `RELEASE_SIGNER_*` 拒绝。

## 7. 回滚

代码回滚到上一稳定提交；发布回滚通过管理端撤回当前版本并恢复上一条可安装的全量版本。原生配置错误不能依赖 OTA 修复。
