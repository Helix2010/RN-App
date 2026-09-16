# 签名密钥重置后的首次发布手册（以 anyfun 为例）

状态：Runbook · 日期：2026-09-16（取代 2026-09-10 的“本地生产签名首次发布”版本）  
依据：RN-Server `docs/design/android-signing-gate-2026-09-16.md`「已定事项」「密钥生成与上传」「现有租户的签名密钥重置」「落地顺序」；`docs/SAAS_TENANT_BUILD_RUNBOOK.md` §3。

**正式包只由签名闸产出。** RN-App 仓库里没有正式签名模式：`pnpm android:release` 只出未签名包，本地、CI、构建机都签不出租户的正式包。原来“在本机用生产 keystore 出包、再手工上传”的流程，连同本地 keystore 生成脚本、四个签名环境变量和 GitHub 上的签名 secret，全部作废。

这份手册只覆盖 RN-App 侧要做的事，以及发布负责人在控制台上的动作。签名闸部署、机器登记、离线生成密钥、`signer confirm` 由平台负责人按设计文档执行，这里只写它们的完成标志。任何一步结果不符就停下，不要跳过门禁。

## 0. 角色与前置

| 角色 | 负责步骤 |
| --- | --- |
| 平台负责人 | 1（签名闸与密钥就绪） |
| 发布负责人 | 2、3、4、5、6、8 |
| 服务端/运维 | 7 中的 bootstrap 策略 |
| 客服/运营 | 7 的用户沟通 |

环境：Node 22–24、pnpm 10.28.1；本机做第 4 步复核需要 Android SDK build-tools（`ANDROID_HOME` 放 `.env.local`）；可登录 RN-Admin 的账号。

**一次性决策（已定）**：沿用原包名 `com.anyfun.foundation`。证书一换，Android 就认为这是另一个 App，已装机用户必须卸载重装、用助记词恢复钱包（第 7 步）。

## 1. 签名闸与新密钥就绪（平台负责人）

按设计文档「落地顺序」第 5、6 步完成，完成标志是控制台「配置中心 → 打包与签名 → 打包配置」里：

- 已上传离线工具产出的 v3 密钥文件，登记的包名是 `com.anyfun.foundation`；
- 主、备签名闸均已本机确认，主签名闸试签通过；
- 页面显示的证书完整 SHA-256（下文记作 `<新指纹>`）与离线记录一致。**以离线记录为准，不以控制台为准。**

旧指纹 `1a5d9fb446e2f4c8e1aa464a02b14248a265ea9c554f83eb01ec94886329e694` 由服务端永久拒绝，不提供回退。

## 2. 更新 tenant.json（发布负责人）

`tenants/anyfun/tenant.json` 的 `signerSha256` **只用于**本地 `pnpm android:verify` 核对签名闸产出的包；构建不读它，构建任务里的 tenant.json 由服务端按登记的指纹合成。重置之前仓库里的值仍是作废的旧指纹，这时对新包跑 `android:verify` 会失败，这是预期的。

拿到 `<新指纹>` 之后改掉它，并按惯例提升版本：

```diff
-  "version": "1.3.16",
-  "androidVersionCode": 46,
+  "version": "1.3.17",
+  "androidVersionCode": 47,
   ...
-  "signerSha256": "1a5d9fb446e2f4c8e1aa464a02b14248a265ea9c554f83eb01ec94886329e694"
+  "signerSha256": "<新指纹>"
```

规则：服务端要求 `version` 与 `androidVersionCode` 都严格大于上一版。校验：

```bash
pnpm config:check
# 预期：EAS profiles are tenant-neutral and tenant build configs are valid.
```

若报 `signerSha256 must be 64 lowercase hex`，说明复制时带了冒号或大写。改动合入 main 后再排构建任务：构建机拉的是 main。

## 3. 排构建任务（发布负责人）

RN-Admin →「发布中心 → 打包任务」→ 新建 Android 安装包任务（版本、Build 与第 2 步一致）。状态依次是：排队 → 构建中 → 待签名（`built`）→ 签名中（`signing`）→ 成功。

- 控制台提示签名闸未就绪（`SIGNER_NOT_READY`）：回第 1 步，看缺哪一项。
- 构建失败：看任务详情里的日志尾部；常见是依赖变了没重新生成依赖校验清单（`docs/SAAS_TENANT_BUILD_RUNBOOK.md` §3.2.3），或权限不在允许列表。
- 签名闸拒签：任务详情里有拒签原因（违规直接判失败；临时错误会重试一次）。按原因修代码或配置后重新排任务，不要试图绕过签名闸。

成功后「发布管理」里出现一条待发布记录，记录上有未签名包与已签名包各自的 sha256。

## 4. 独立复核产物（发布负责人）

从待发布记录下载签名闸产出的 APK，在本机复核：

```bash
pnpm android:verify ~/Downloads/anyfun-1.3.17-build47.apk anyfun
```

预期：

```json
{
  "apk": "/home/<user>/Downloads/anyfun-1.3.17-build47.apk",
  "tenant": "anyfun",
  "signerSha256": "<新指纹>",
  "packageName": "com.anyfun.foundation",
  "versionName": "1.3.17",
  "versionCode": 47,
  "permissions": 36
}
```

对旧签名的包必然失败（签名者是作废的旧指纹，`scripts/lib/android-release-identity.js` 的 `RETIRED_SIGNER_SHA256` 与服务端常量同一份，永久拒绝）：

```bash
pnpm android:verify ~/Downloads/anyfun-1.3.16-build46.apk anyfun
# Release identity check failed:
# - APK is signed with a retired signing key 1a5d9fb4… (anyfun (2026-09 reset)); retired keys are rejected permanently
# - signer 1a5d9fb4… does not match tenant.json signerSha256 <新指纹>
# - versionCode 46 does not match tenant androidVersionCode 47 ...
```

第 2 步之前（`tenant.json` 里还是旧指纹）跑 `android:verify`，会直接提示 `signerSha256 … is a retired key … replace it with the certificate SHA-256 registered after the key reset`。

## 5. 设备验证（发布负责人）

在测试机或模拟器上：

1. 卸载旧签名的 anyfun（覆盖安装必然被系统拒绝，这正说明证书换了）。
2. `adb install` 第 4 步复核过的包。
3. 冷启动完成 bootstrap，用助记词恢复钱包，确认资产；签一笔测试网交易。
4. 核对 App Links（邀请链接、WalletConnect 回跳）能直接拉起应用：`/.well-known/assetlinks.json` 由服务端按登记的指纹生成，已自动切到新指纹。
5. 拉一次 OTA，确认能装上。

本地自测不要试图给租户包签名：`pnpm android:dev-signed` 只签开发包名 `com.anyfun.foundation.dev`，见 `docs/SAAS_TENANT_BUILD_RUNBOOK.md` §3.4。

## 6. 发布（发布负责人）

RN-Admin →「发布管理」→ 待发布记录 → 核对版本、Build、两个 sha256 →「发布」。是否强制更新见第 7 步。

## 7. 老用户迁移（发布负责人 + 服务端/运维 + 客服）

所有已装机用户（包括旧签名的 1.3.x 与更早的 debug 签名 1.2.x）都不能覆盖升级到新签名的包。

1. **发布说明**：写清“新版本需要先卸载旧 App；卸载前确认助记词已备份；卸载后安装新版本并用助记词恢复”。强制更新弹层渲染 `releaseNotes` 的前 3 条，迁移三步必须在前 3 条里。
2. **bootstrap 策略**：RN-Admin →「应用配置」→ 更新策略：`minSupportedVersion` 提到新版本，旧版本进入“必须更新”提示。设备已装包与目标发布的签名指纹不一致时，服务端自动对这台设备返回 `directUpdateEnabled=false`（RN-Server `docs/OPERATIONS_AND_RELEASE.md` §5「Android direct APK」），客户端改为用浏览器打开下载页，避免应用内安装失败循环；系统安装器那一步仍会被拒，出路只有卸载重装。
3. **客服口径**：卸载前必须备份助记词；未备份的钱包无法找回。
4. **不回退**：旧指纹被服务端永久拒绝，出问题只修复向前。

核对存量装机（只读）：`GET /v1/admin/installations/overview` 的 `versions` 数组，或 `GET /v1/admin/installations?limit=100` 看每台的 `appVersion` / `lastActiveAt` / `accountsCount`。

## 8. 收尾（发布负责人）

新签名的包在设备上装通之后：

1. 删除开发机上 anyfun 旧 keystore 原件与口令文件，以及 `.env.local` 里指向旧 keystore 的那一行路径。
2. 确认 GitHub RN-App 仓库 `android-release` 环境里原来的 4 个签名 secret 已删除（删 workflow 不会删 secret）。
3. 模拟器上旧签名的 anyfun 包卸掉，改装签名闸产出的新包。
4. 在 `docs/changes/` 记录：发布日期、版本、新指纹后 8 位、迁移窗口。

未来每次发版重复第 2–6 步（第 2 步只改版本），密钥不变。

## 附：本手册涉及的命令一览

```bash
pnpm config:check                                   # 2 校验 tenant.json
pnpm android:verify <签名闸产出的 apk> anyfun          # 4 独立复核
pnpm android:dev-signed                             # 本地自测（只签开发包名）
```
