# 生产签名首次发布手册（以 anyfun 为例）

状态：Runbook · 日期：2026-09-10  
依据：`docs/design/cross-platform-wallet-key-security-adversarial-review-2026-09-09.md` §4.2、§5.2；`docs/SAAS_TENANT_BUILD_RUNBOOK.md` §3；执行范围 `docs/design/wallet-security-phase0-scope-2026-09-10.md` §6。

这份手册把"从 debug 签名切换到生产签名并发出第一个真实包"拆成可逐步执行、可核对的动作。每一步都写了命令、示例与预期结果；任何一步结果不符就停下，不要跳过门禁。

## 0. 角色、前置与一次性决策

| 角色 | 负责步骤 |
| --- | --- |
| 密钥保管人 | 1（生成与托管）、4（CI secrets） |
| 发布负责人 | 2、5、6、7、9、10 |
| 服务端/运维 | 3、8 中的 bootstrap 策略 |
| 客服/运营 | 8 的用户沟通 |

环境：JDK 17、Android SDK（含 build-tools 36）、Node 22–24、pnpm 10.28.1、可登录 RN-Admin 的账号；RN-Server 以 `APP_ENV=production` 运行且发布存储端点为 https（否则生产入库会被 `RELEASE_SIGNER_UNPINNED` 或 `STORAGE_ENDPOINT_INSECURE` 拒绝）。

**一次性决策：包名。** 现有用户装的是 `com.anyfun.foundation` + debug 签名。

- 方案 A（推荐）：换新包名，例如 `com.anyfun.wallet`。新旧 App 并排安装，用户先在旧 App 备份助记词、在新 App 导入、确认后再卸旧 App，没有丢钱窗口。代价：用户短期两个图标；深链 scheme 可保留；Firebase 项目里要加新包名。
- 方案 B：沿用包名。用户必须先卸载再安装，卸载即清空本地钱包，只能靠事先备份。

下文按方案 A 写；方案 B 只需跳过改包名。

## 1. 生成生产签名密钥（密钥保管人）

在干净机器上执行，输出目录必须在仓库之外：

```bash
cd RN-App
pnpm android:keystore --tenant anyfun --out /secure/keys/anyfun
```

交互提示依次为：别名（默认 `anyfun`）、有效期（默认 10000 天）、证书 DN、是否自动生成口令（选 Y）、是否写入 tenant.json（此处选 no，第 2 步统一改）。预期输出结尾：

```text
================ 生成完成 ================
租户:            anyfun（包名 com.anyfun.foundation）
keystore:        /secure/keys/anyfun/anyfun-release.jks
别名:            anyfun
口令文件:        /secure/keys/anyfun/anyfun-release.password   （0600，只此一份，不上屏）
CI base64:       /secure/keys/anyfun/anyfun-release.jks.base64
signerSha256:    06d2ab97…936f0        ← 64 位小写十六进制，后面三处登记都用它
```

核对：`ls -la /secure/keys/anyfun` 三个文件权限均为 `-rw-------`。

托管（当天完成）：

1. `anyfun-release.jks` 与 `anyfun-release.password` 分别存入密钥管理服务的两个条目。
2. 离线加密备份两份放不同地点：`age -p anyfun-release.jks > anyfun-release.jks.age`（或 `gpg -c`），并在另一台机器解开一次验证。
3. 记录仪式：日期、执行人、指纹、备份位置，存在密钥管理服务的备注里，不进仓库。
4. 第 4 步 secrets 配置完成后，删除 `/secure/keys/anyfun` 下的明文文件。

不要做：把 keystore 或口令放进仓库、`.env`、聊天工具、工单。

## 2. 登记 tenant.json 并提升版本（发布负责人）

编辑 `tenants/anyfun/tenant.json`，示例改动：

```diff
   "scheme": "anyfun",
-  "androidPackage": "com.anyfun.foundation",
+  "androidPackage": "com.anyfun.wallet",
   "iosBundleId": "com.anyfun.foundation",
   ...
-  "version": "1.2.11",
-  "androidVersionCode": 25,
+  "version": "1.3.0",
+  "androidVersionCode": 26,
+  "signerSha256": "06d2ab9783bcce4782711e818e8e4c6f3c8a9469a11e0c89805c41f7502936f0",
```

规则：服务端要求 `version` 与 `androidVersionCode` 都严格大于上一版（1.2.11 / 25）。校验：

```bash
pnpm config:check
# 预期：EAS profiles are tenant-neutral and tenant build configs are valid.
```

若报 `signerSha256 must be 64 lowercase hex`，说明复制时带了冒号或大写。

## 3. 登记服务端 pin（服务端/运维）

方式一，RN-Admin：登录 → 左侧「发布基础设施」→「Android 发布身份」→ 填包名 `com.anyfun.wallet` 与指纹（可直接粘贴带冒号的形式，页面会规范化）→ 填原因，如 `production signing key ceremony 2026-09-12` → 确认。页面显示"已配置"与版本号 1 即成功。

方式二，接口（租户由请求 Host 决定，必须打租户自己的 API 域名；非安全方法需带允许的 Origin）：

```bash
curl -sc cookies.txt https://api.anyfun.win/v1/admin/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"<admin>","password":"<password>"}'

curl -sb cookies.txt -X PUT https://api.anyfun.win/v1/admin/release-identity/android \
  -H 'Content-Type: application/json' -H 'Origin: https://admin.anyfun.win' \
  -d '{"packageName":"com.anyfun.wallet",
       "signerSha256":"06d2ab9783bcce4782711e818e8e4c6f3c8a9469a11e0c89805c41f7502936f0",
       "expectedVersion":0,"reason":"production signing key ceremony 2026-09-12","confirm":true}'
```

预期响应包含 `"configured": true` 与 `"version": 1`。常见错误：`STALE_RELEASE_IDENTITY`（先 GET 取当前 version 再填 `expectedVersion`）；400 提示 debug 指纹（贴错了模板密钥指纹）。

## 4. 配置 CI secrets（密钥保管人）

GitHub 仓库 → Settings → Environments → 新建 `android-release`，加 required reviewers，再添加 4 个 secrets：

| Secret | 取值 |
| --- | --- |
| `ANDROID_RELEASE_KEYSTORE_BASE64` | `cat /secure/keys/anyfun/anyfun-release.jks.base64` 的内容 |
| `ANDROID_RELEASE_STORE_PASSWORD` | `cat /secure/keys/anyfun/anyfun-release.password` 的内容 |
| `ANDROID_RELEASE_KEY_ALIAS` | `anyfun` |
| `ANDROID_RELEASE_KEY_PASSWORD` | 同 STORE_PASSWORD（PKCS12 两者相同） |

push 到 main 后 `android-release-gate` job 会用它们完整构建并复核；密钥登记前该 job 失败是预期。

## 5. 本地构建生产包（发布负责人）

`.env.local` 只放非秘密：

```bash
ANDROID_HOME=/home/<user>/android-sdk
JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
GOOGLE_SERVICES_JSON=/secure/firebase/anyfun-google-services.json   # 必须包含新包名 com.anyfun.wallet
ANDROID_RELEASE_KEYSTORE_PATH=/secure/keys/anyfun/anyfun-release.jks  # 绝对路径
```

口令只走当前 shell：

```bash
export ANDROID_RELEASE_STORE_PASSWORD="$(cat /secure/keys/anyfun/anyfun-release.password)"
export ANDROID_RELEASE_KEY_ALIAS=anyfun
export ANDROID_RELEASE_KEY_PASSWORD="$ANDROID_RELEASE_STORE_PASSWORD"
pnpm android:release anyfun
```

预期关键输出：

```text
✔ Finished prebuild
BUILD SUCCESSFUL
Release identity verified: signer 06d2ab97…936f0 · com.anyfun.wallet 1.3.0 (26) · 36 permissions
Android release APK: artifacts/anyfun-1.3.0-build26-release.apk
```

失败对照：

| 报错 | 含义 | 处理 |
| --- | --- | --- |
| `must pin signerSha256` | tenant.json 没写指纹 | 回第 2 步 |
| `Release signing requires ANDROID_RELEASE_…` | 环境变量缺失 | 重新 export |
| `must be an absolute path` | keystore 路径是相对路径 | 改绝对路径 |
| prebuild 报 `Release signing requires …` | 同上，插件在 prebuild 阶段拦截 | 同上 |
| `Release identity check failed: … signer … does not match` | 用错了 keystore 或 tenant.json 指纹写错 | 用 `keytool -list -v` 重新核对 |
| `forbidden permission declared: SYSTEM_ALERT_WINDOW` | `blockedPermissions` 没生效，通常是没 `--clean` 重生成工程 | 脚本自带 `--clean`，检查是否手改了 android/ |

## 6. 独立复核产物

```bash
pnpm android:verify artifacts/anyfun-1.3.0-build26-release.apk anyfun
```

预期：

```json
{
  "apk": "artifacts/anyfun-1.3.0-build26-release.apk",
  "tenant": "anyfun",
  "signerSha256": "06d2ab9783bcce4782711e818e8e4c6f3c8a9469a11e0c89805c41f7502936f0",
  "packageName": "com.anyfun.wallet",
  "versionName": "1.3.0",
  "versionCode": 26,
  "permissions": 36
}
```

对比反例，对旧产物必然失败：

```bash
pnpm android:verify artifacts/anyfun-1.2.11-build25-release.apk anyfun
# Release identity check failed:
# - APK is signed with the public React Native debug keystore (fac61745…)
# - signer fac61745… does not match tenant.json signerSha256 06d2ab97…
# - versionCode 25 does not match tenant androidVersionCode 26 ...
```

再用一台测试机 `adb install artifacts/anyfun-1.3.0-build26-release.apk`（旧 App 在机上时应并排安装成功），冷启动完成 bootstrap、创建/导入钱包、签一笔测试网交易。

## 7. 上传与发布（发布负责人）

RN-Admin →「发布管理」→「发布总览」→「上传安装包」→ 选择 `anyfun-1.3.0-build26-release.apk` → 填版本 `1.3.0`、Build `26`、发布说明（含迁移步骤，见第 8 步）→「保存为待发布」。服务端此时执行：签名者与包名与 pin 比对、拒绝 debug 指纹、版本递增、内嵌配置校验，并记录对象 ETag。

| 服务端错误码 | 含义 | 处理 |
| --- | --- | --- |
| `RELEASE_DEBUG_SIGNER` | 上传的是 debug 签名包 | 用第 5 步产物 |
| `RELEASE_SIGNER_UNPINNED` | 生产环境未登记 pin | 回第 3 步 |
| `RELEASE_SIGNER_MISMATCH` / `RELEASE_PACKAGE_MISMATCH` | pin 与产物不一致 | 核对指纹与包名，两边必须同一份 |
| `RELEASE_VERSION_NOT_INCREASING` | 版本或 Build 未递增 | 回第 2 步 |
| `RELEASE_OBJECT_ETAG_MISSING` / `STORAGE_ENDPOINT_INSECURE` | 存储配置问题 | 运维检查发布存储 |

待发布记录核对无误后点「发布」。是否勾选强制更新见第 8 步。

## 8. 老用户迁移（发布负责人 + 服务端/运维 + 客服）

> **2026-09-11 现场核对**：生产租户共 19 台装机，其中 **12 台仍是 debug 签名**（build ≤ 25：1.2.11×4、1.2.9×2、1.2.6×2、1.2.5×1、1.2.4×3），6 台 7 天内活跃、5 台建过钱包；1.2.11 那 4 台一天前还在用。而 1.3.7 (33) 已是 `active` + `mandatory`。**这一节因此不能按"无存量装机"关闭**，下面第 1、2 步仍是欠账。
> 核对方法（只读）：`GET /v1/admin/installations/overview` 的 `versions` 数组，或 `GET /v1/admin/installations?limit=100` 看每台的 `appVersion` / `lastActiveAt` / `accountsCount`。服务端容器里没有 mysql 客户端，不要走 `docker compose exec ... mysql`。

旧版本（1.2.x，debug 签名，包名 `com.anyfun.foundation`）无法被新包覆盖升级，必须引导。顺序：

1. **给旧 runtime 发最后一个 OTA：迁移引导页**。在旧 runtime 的代码基线上加一个全屏引导（备份助记词 → 下载新版 → 导入 → 确认资产 → 卸载旧版；按钮直达备份页与新版下载链接），构建 OTA：

   ```bash
   EXPO_PUBLIC_TENANT=anyfun pnpm ota:build -- \
     --platform android --channel production --distribution-channel direct \
     --runtime-version 1.2.11 --apply-strategy immediate \
     --output-zip artifacts/ota-anyfun-1.2.11-migration.zip
   ```

   RN-Admin →「发布管理」→「上传 OTA 热更新」→ 基线选 1.2.11（build 25）→ 上传 zip →「保存为待发布」→「发布」。注意服务端规则"发布新全量版本后旧基线不再接收 OTA"：**这个 OTA 必须在第 7 步点「发布」之前先发出去**，或者先发 OTA、再发全量。

2. **bootstrap 策略**：RN-Admin →「应用配置」→ 更新策略：`minSupportedVersion` 提到 `1.3.0`，旧版本进入"必须更新"提示；`latestVersion` 由活跃 release 自动决定。发布说明写清"新版本是新的应用，需先备份助记词再安装并导入"。
3. **保留旧包下载**一段时间（建议 30 天）以便回退；不要下架 1.2.11 记录。
4. **客服口径**：卸载旧 App 前必须备份助记词；未备份的钱包无法找回；新 App 图标名称与旧的区别。
5. **方案 B（同包名）额外动作**：旧版 App 内的直装更新会因签名不一致被系统拒绝，因此迁移页必须明确"先卸载再安装"。
   - `features.directUpdateEnabled` 对旧版本关闭这件事**已经自动化**（2026-09-11）：bootstrap 比对设备已装 build 与目标发布各自入库的 `file_metadata.signerSha256`，不一致就对这台设备返回 `false`，不需要再手工配版本区间。见 RN-Server `docs/OPERATIONS_AND_RELEASE.md` §5「Android direct APK」。
   - **它只消除应用内的失败循环**：客户端退回用浏览器打开下载页，装到系统安装器那一步仍然会被拒。真正的出路只有"备份助记词 → 卸载 → 重装"，所以第 1 步的迁移 OTA、或至少把这三步写进 `releaseNotes`（强制更新弹层渲染前 3 条，该渲染自 2026-08-31 `f0fc88f` 起就在，早于 1.2.4，所有存量装机都看得到），必须有一个落地。

## 9. 验证与观测

- 新装机：完成 bootstrap、创建钱包、备份、转账测试网、OTA 检查正常。
- 旧版本：冷启动看到迁移引导；点击能到备份页与下载链接。
- 服务端：`audit_events` 中没有 `release_rejected`、`release_object_changed`；RN-Admin「设备管理」里 1.2.x 活跃安装数逐日下降，1.3.0 上升。
- CI：main 上的 `android-release-gate` 变绿，产物签名者与本地一致。

## 10. 收尾

1. 1.2.x 活跃数降到阈值后（例如 <5% 或 30 天），RN-Admin 停止官网分发旧版本，关闭旧 runtime 的 OTA。
2. 删除构建机与本机上的 keystore 明文与口令文件，只保留密钥管理服务与离线备份。
3. 更新 `docs/changes/` 记录：发布日期、版本、指纹后 8 位、迁移窗口。
4. 未来所有发版重复第 5–7 步；密钥不变。若日后密钥泄露，可用 Android v3 轮换正常换钥，不再需要全员重装。

## 附：本手册涉及的命令一览

```bash
pnpm android:keystore --tenant anyfun --out /secure/keys/anyfun   # 1 生成
pnpm config:check                                                   # 2 校验 tenant.json
pnpm android:release anyfun                                         # 5 构建 + 门禁
pnpm android:verify artifacts/<apk> anyfun                          # 6 独立复核
pnpm ota:build --platform android --channel production ...        # 8 迁移 OTA
```
