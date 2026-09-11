# 钱包密钥安全评审：无争议项提前执行范围

状态：Execution scope / 供排期与 codex 复核  
日期：2026-09-10  
依据：`cross-platform-wallet-key-security-adversarial-review-2026-09-09.md` 修订 3（下称主评审），N 编号与章节均指该文档。

## 1. 判定原则

一项进入“可立即执行”范围必须同时满足：

1. codex 复审与主审二次核对对“要不要修”结论一致（严重度措辞分歧不影响）。
2. 不依赖尚未做出的产品/架构决策、未采购的资源（KMS、签名证书、真机）或原生模块开发。
3. 改动可用单测或构建脚本回归，且不改变现有用户数据格式，或带幂等迁移。

满足 1 但卡在一个明确决策上的进入第 3 节；卡在资源或原生工程的进入第 4 节。**第 2 节全部完成也不签署任何 P0 门禁**，主评审 §12.1 的状态不变，它们的价值是消除 fail-open 模式、收窄暴露面、为后续原生化铺路。

## 2. 范围 A：可立即执行

粗估为人日，含测试；文件路径相对 `RN-App/` 或 `RN-Server/`。

### A1 RN-App 客户端（纯 JS，阶段 0c）

| 项 | 编号 | 改动 | 文件 | 验收 | 估 |
| --- | --- | --- | --- | --- | --- |
| A1-1 | N4 | `revealMnemonic`、`remove`、`wipeAll`、导入前认证走独立 `authenticate`，不读 `cachedWrapKey`；成功后不写缓存 | `src/core/wallet/vault/keystore-vault.ts` | 规格测试：签名后立即 reveal 仍弹认证 | 0.5 |
| A1-2 | N7 | `read()` 损坏或版本不符抛 `WalletVaultCorruptedError`；任何 `write()` 前把原始 blob 备份到 `foundation.wallet.vault.v1.corrupt.<ts>`；`use-session.ts` 对该错误进入“需恢复”态而非 `needs-wallet` | `keystore-vault.ts`、`src/features/session/hooks/use-session.ts`、钱包 UI | 现有 “survives a corrupted vault file” 测试改为断言抛错且原文件未被覆盖 | 1 |
| A1-3 | N8 | `wrapKey()` 在 SecureStore 无 WK 且 vault 有条目时抛 `WalletVaultKeyMissingError`，不铸新；vault 文件加 `wkCheck = HKDF(WK, "check")` 前 8 字节，读时比对 | `keystore-vault.ts` | 测试：清空 secure store 后 `list()` 仍列出、`decrypt` 抛 KeyMissing、`importMnemonic` 拒绝 | 1 |
| A1-4 | N35 | vault 所有写路径经单飞 promise 队列串行化 | `keystore-vault.ts` | 测试：并发两次 import 都落盘且共用一把 WK | 0.5 |
| A1-5 | N38 | `readRegistry()` 损坏时抛错并备份原文，不返回空对象 | `src/features/wallet/api/embedded-wallet-gateway.ts` | 测试同 A1-2 | 0.25 |
| A1-6 | N9 | `withPrivateKey`/`revealMnemonic` 解密后重算地址，与条目 `address` 不符即抛，覆盖 `signMessage/signTypedData` 路径 | `keystore-vault.ts` | 测试：交换两条目密文后签名被拒 | 0.25 |
| A1-7 | N9 | GCM 加 AAD = `version‖address‖kind‖path`；条目加 `aad: 1` 标记；旧条目在下一次成功解密后原地重加密 | `keystore-vault.ts` | 新旧条目混存测试；迁移幂等测试 | 1.5 |
| A1-8 | 0c-2 | `AppState` 进入 `inactive/background` 立即 `vault.lock()`，不再等回前台判断 | `src/features/security/app-lock-gate.tsx`、`src/core/gateways/gateway-context.tsx` | `app-lock-gate.spec.tsx` 增加后台即锁断言 | 0.25 |
| A1-9 | N11 | `transfer-form`、`order-sheet`、`predict-enable-screen`、`swap-screen`、`dispute-sheet` 调用 `requireVerification({ usdValue })`，金额未知传 `null`（一律验证） | 五个 UI 文件 | 每处单测断言传参 | 0.5 |
| A1-10 | N12 | `predict.sign.reason`、`wallet.sign.transfer` 改为 `t()` 内置 key 并补进 `i18n/seed/*.json`；`security.*`、`send.*`、`wallet.*`、`backup.*` 命名空间在合并远程语言包时跳过 | `http-predict-gateway.ts`、`http-predict-account-gateway.ts`、`gateway-context.tsx`、`src/core/config/bootstrap-repository.ts` | `pnpm i18n:check` 通过；测试：远程包覆盖 `security.verify.reason` 无效 | 0.5 |
| A1-11 | N15 | 导入输入框加 `autoComplete="off"`、`importantForAutofill="no"`、`textContentType="none"`、`spellCheck={false}`、Android `keyboardType="visible-password"` | `src/features/wallet/ui/wallet-import-screen.tsx` | 快照测试 | 0.25 |
| A1-12 | N23 | 剪贴板清理：timer 存 ref、卸载时清理、清理前 `getStringAsync()` 比对仍为助记词才清；`walletconnect-sheet` 复制 pairing URI 同样处理 | `backup-screen.tsx`、`walletconnect-sheet.tsx` | 测试：60 秒内用户复制其他内容不被清 | 0.5 |
| A1-13 | N24 | `useScreenProtect` 扩到 WC 二维码、登录确认、转出确认；`BackupScreen` 等 `preventScreenCaptureAsync` resolve 后再渲染单词；启动调用 `enableAppSwitcherProtectionAsync`；保护失败 toast 告警而非吞掉 | `src/core/security/screen-protect.ts` 及三处 UI | `screen-protect.spec.ts` 改为失败可见 | 1 |
| A1-14 | N25 | 备份验证位置与干扰词用 `randomBytes` 随机；连续错 3 次退回展示页重看 | `backup-screen.tsx` | 测试：两次进入位置不同 | 0.5 |
| A1-15 | N36 | 创建钱包后 phrase 放进模块级一次性 `PendingRevealStore`，`BackupScreen` 取出即清；`navigation/types.ts` 删除 `phrase` 参数 | `wallet-setup-screen.tsx`、`backup-screen.tsx`、`src/navigation/types.ts` | 类型检查通过；路由 params 中无 phrase | 0.5 |
| A1-16 | N22 | swap 的 unlimited approve 移入确认弹层并经 `requireVerification`；弹层展示 spender 完整地址 | `src/features/dex/ui/swap-screen.tsx` | 测试：点主按钮不再直接 `approve.mutate` | 0.5 |
| A1-17 | N13 | MetaMask/Trust 改 Universal Link（`https://metamask.app.link/wc?uri=`、`https://link.trustwallet.com/wc?uri=`）；Android 用 `IntentLauncher.startActivityAsync` 带 `packageName` 显式包名；OKX 保留 scheme 但 Android 同样显式包名 | `src/features/wallet/api/wallet-deep-links.ts`、`walletconnect-client.ts` | 单测：Android 分支生成显式 intent | 1 |
| A1-18 | N14 | 为 `SignClient.init` 注入 `storage`：值用 SecureStore 持有的随机密钥 AES-GCM 加密后落 AsyncStorage（SecureStore 单值 2 KB 上限，不能直接存会话） | 新增 `src/features/wallet/api/walletconnect-storage.ts`、`walletconnect-client.ts` | 测试：AsyncStorage 中无明文 symKey | 1.5 |
| A1-19 | N26 | 客户端解析 EIP-4361：断言 `domain` = API origin host、`address` = 所签账户、`nonce` = challenge.nonce、`chainId` ∈ 会话链、`expirationTime` 未过；`verify()` 断言 `response.address === request.address`；`refresh()` 地址不同则清会话而非覆盖 | `use-session.ts`、`src/features/session/api/http-session-gateway.ts` | 每个断言一条负测 | 1 |
| A1-20 | N26/N37 | WalletConnect：`client.on("session_delete"/"session_update"/"session_event")` 更新或移除连接；`parseAccounts` 要求全部账户地址一致否则拒绝；`WalletConnectSigner` 断言 `transaction.from === address` 且 `chainId ∈ connection.chains` | `walletconnect-connector.ts`、`walletconnect-client.ts` | 多账户会话负测；from 不符负测 | 1 |
| A1-21 | N30 | `signTypedData` 用 `TypedDataEncoder.getPayload(domain, types, value)` 生成含 `primaryType`/`EIP712Domain` 的 v4 载荷 | `walletconnect-connector.ts` | 测试：载荷含两字段且与 ethers 哈希一致 | 0.25 |
| A1-22 | N21 | `SecureStorePort` 增加可选 `keychainService`；预测凭证走独立 service | `src/core/wallet/vault/ports.ts`、`expo-ports.ts`、`src/core/predict-platform/credentials.ts` | 测试：两 store 键空间隔离 | 0.5 |

A1 小计约 **14.5 人日**。

### A2 RN-App 构建、配置与 CI（阶段 0a/0b 的代码部分）

| 项 | 编号 | 改动 | 文件 | 验收 | 估 |
| --- | --- | --- | --- | --- | --- |
| A2-1 | N16 | `android.blockedPermissions: ["android.permission.SYSTEM_ALERT_WINDOW"]` | `app.config.ts` | `aapt dump permissions` 无该项 | 0.1 |
| A2-2 | N1 代码部分 | 新增 config plugin `plugins/with-release-signing.js`：从 `ANDROID_RELEASE_KEYSTORE_*` 环境变量注入 release `signingConfig`；非 development 且缺变量时 `expo config` 直接抛错。密钥本身由 §4 的 KMS 决策产生，插件先用临时 staging keystore 验证 | `plugins/`、`app.config.ts` | prebuild 后 `build.gradle` release 不再引用 `signingConfigs.debug` | 1 |
| A2-3 | N1/N18/N16 | `build-android-release.mjs` 在 `assembleRelease` 后执行 `apksigner verify --print-certs` 与 `aapt dump badging`：签名者 ≠ `fac61745…`、等于 `tenant.json.signerSha256`、包名等于 `androidPackage`、权限清单等于允许列表，任一不符退出非 0 | `scripts/build-android-release.mjs`、`tenants/*/tenant.json` 增 `signerSha256` | 用当前 debug 签名产物跑脚本必须失败 | 0.5 |
| A2-4 | N20 | `check-build-profiles.mjs` 跨租户校验 `androidPackage`、`iosBundleId`、`scheme`、`applicationId` 两两不同，且默认值不等于任何租户 | `scripts/check-build-profiles.mjs` | 构造重复租户 fixture 必须失败 | 0.25 |
| A2-5 | N28 | CI：三个 action 固定到完整 commit SHA；加 `permissions: contents: read`；新增 job 跑 A2-3 的 release 构建与门禁（JDK 17 + Android SDK setup） | `.github/workflows/app-quality.yml` | PR 上可见 release job | 1 |
| A2-6 | N28 | `gradle-wrapper.properties` 加 `distributionSha256Sum` | `android/gradle/wrapper/`（经 prebuild 模板或 plugin 写入） | wrapper 校验通过 | 0.1 |
| A2-7 | 12.2 | ESLint 规则：禁止 `console.*` 参数中出现 `route.params`、`phrase`、`mnemonic`、`privateKey` 标识符 | `eslint.config.mjs` | 反例文件 lint 失败 | 0.25 |
| A2-8 | N2 | `ApkReleaseTarget` 增加 `sha256`；下载完成后 JS 分块读文件计算 SHA-256（`expo-crypto` 无流式接口时用 `readAsStringAsync` 分片 + `@noble/hashes`），不符即删除并拒绝安装；URL 必须与租户 API origin 同源。签名者证书校验需原生，见第 4 节 | `src/core/updates/apk-download-manager.ts`、`runtime-context.tsx` | 测试：篡改文件后进入 `error` 而非 `ready` | 1 |

A2 小计约 **4.2 人日**。

### A3 RN-Server

| 项 | 编号 | 改动 | 文件 | 验收 | 估 |
| --- | --- | --- | --- | --- | --- |
| A3-1 | N18 | 租户表增 `android_package`、`android_signer_sha256`（管理端可编辑）；`createRelease` 对 Android 产物比对两者，不符 422；无条件拒绝 RN 模板 debug 指纹 | `simplified_releases.go`、迁移、RN-Admin 租户表单 | Go 测试：错误包名/debug 签名被拒 | 1 |
| A3-2 | N33 | `publicReleaseDownload` 与 OTA 资产下载前 `client.Head(key)`，size/ETag 与入库值（上传时记录 ETag）不符返回 502 并记审计 | `simplified_releases.go`、`ota.go`、`objectstore` | Go 测试：替换对象后下载被拒 | 0.5 |
| A3-3 | N34 | `validateOTAManifestPackage` 校验 `extra.applicationId` 等于租户配置的 applicationId 与基线 APK 记录值 | `ota.go` | 现有 `TestValidateOTAManifestPackage*` 增负例 | 0.5 |
| A3-4 | 4.10 | `absoluteURL` 在生产配置下强制 `https`，缺 `x-forwarded-proto` 时告警而非退回 `http` | `server.go`、`config.go` | Go 测试 | 0.25 |
| A3-5 | N13 | 每租户域名提供 `/.well-known/assetlinks.json`（Android App Links）与 `apple-app-site-association` 占位，供 A1-17 回跳验证 | `server.go` 静态路由 | curl 可取 | 0.25 |
| A3-6 | N27 | ADR-0002 措辞改为“与 bootstrap 指针一致的完整性，非真实性” | `RN-App/docs/decisions/0002-*.md` | 文档 | 0.1 |

A3 小计约 **2.6 人日**。

**范围 A 合计约 21 人日**（A1 14.5 + A2 4.2 + A3 2.6），两人并行约 2.5 周。

## 3. 范围 B：需一个明确决策后即可执行

| 编号 | 需要的决策 | 建议 | 决策后估 |
| --- | --- | --- | --- |
| N3 | 是否接受“预测平台合约地址编译期固化在 `tenant.json`，平台换合约必须发原生版”（主评审 §4.4 方案 1） | 接受；当前 anyfun 地址可从一次 `public-info` 快照取得，`platformContracts()` 结果与固化值不符即拒绝开通 | 1.5 |
| N10 | 无锁屏/无生物识别设备是否允许嵌入式钱包 | 禁止创建/导入；已有钱包在 `unavailable` 时提示先设置锁屏，`decrypt` fail closed | 0.5 |
| 0c-2 | `DEFAULT_UNLOCK_TTL_MS` 是否降为 0（预测开通一次要签 3 笔，会连弹 3 次） | 降为 60 秒作为折中，或对 `predict-enable` 单独允许一次会话内复用 | 0.1 |
| N23 | 是否彻底移除助记词“复制”入口 | 移除；主评审已把允许复制列为需明示的风险接受项 | 0.1 |
| N25 | “稍后备份”是否对入金/大额设置软门禁 | 未备份账户禁止显示收款二维码 | 0.5 |
| N17 | `x-admin-key` 旁路是否仍有自动化调用方（README 称“保留给受控自动化”） | 无调用方则移除；有则绑定固定 actor 白名单与来源 IP；`ADMIN_COOKIE_SECURE` 默认 true 需确认部署链路全程 TLS | 0.5 |
| N19 | 何时让“非 development 构建缺 `codeSigningCertificate` 即构建失败”生效 | 与 A2-2 同一 PR 加开关 `EXPO_REQUIRE_OTA_SIGNING`，证书就位后默认开启 | 0.1 |
| N32 | “演示/真实”标记的定义与来源（bootstrap 字段还是编译期） | 编译期 `distributionChannel` + bootstrap `features` 双重判定，替换 `mode: "mock"` | 0.5 |
| N29 | 是否支持 BIP-39 passphrase、是否改 256 位 | 产品决定；不阻塞其他项 | 1 |

## 4. 范围 C：本轮不做（依赖资源、原生工程或设计定稿）

- **N1 密钥本体**：KMS/HSM 或 Play App Signing 托管密钥的生成、保管与已装机用户“备份→卸载→重装”迁移方案，属组织决策与对外沟通；A2-2/A2-3 只准备好接收它。
- **N2 签名者证书校验**：安装前读取 APK 签名证书需 `PackageManager.getPackageArchiveInfo`，属原生模块；A2-8 只做 sha256。
- **N17/N19 OTA 端到端签名**：证书生成、Go 端对最终 manifest/directive 签名、`expo-signature` 输出、`includeManifestResponseCertificateChain` 自定义 plugin。
- **N5/N6/N4 终态、8.5 迁移、10.1/10.2 原生 signer 与可信确认 UI、0d 过渡性 WK 认证绑定**：需原生工程、iOS 工具链与迁移决策 A/C。
- **N22 calldata 解码器与 spender 白名单、费率表扩链**：需原生 signer 与各链阈值取值。
- **N31 完整性信号、N24 中 `FLAG_SECURE` 常驻与 `setHideOverlayWindows`**：原生。
- **E-05 至 E-11、E-16 真机部分、一切 iOS 结论**：无 `adb`/`xcodebuild`/真机。

## 5. 建议执行顺序与 PR 切分

1. **PR-1 发布链门禁**（A2-1 至 A2-6、A3-1 至 A3-4）：先让“再打一个 debug 签名包”在脚本、CI 和服务端三处都失败，这是 N1 修复的前置，且与密钥决策解耦。
2. **PR-2 vault 完整性**（A1-1 至 A1-8）：全部在 `keystore-vault.ts` 与 spec 内，先做无格式变更项（A1-1/2/3/4/5/6/8），A1-7 AAD 迁移单独提交。
3. **PR-3 外部钱包**（A1-17 至 A1-21、A3-5）：外部钱包是近期真实资产默认路径，四项缺口补齐后才能开始 E-16。
4. **PR-4 认证、文案与恢复材料**（A1-9 至 A1-16、A1-22、A2-7、A2-8、A3-6）。
5. 第 3 节各项随决策到位插入对应 PR。

每个 PR 的验收都以主评审第 11 节可复现实验的本机部分为准：E-01 保持通过并新增负向测试；E-02 第一段（`withPrivateKey(key => key)`）在本轮仍会成立，不得声称已关闭。完成范围 A 后，主评审的状态行保持 “Release blocked”，只把对应 N 项在登记表中加注“已缓解（阶段 0）”。

## 6. 执行记录（2026-09-10）

评审轮次：范围 A 实现后经两轮内部独立评审（RN-App、RN-Server 各一）与一轮 codex 评审（仅 RN-Server 完成；RN-App 的 codex 评审三次因模型过载未产出）。评审发现均已修正，详见 `docs/changes/2026-09-10-*.md` 的"追加"节与 RN-Server `docs/OPERATIONS_AND_RELEASE.md` §5；主要修正：服务端对象 ETag 比对此前误用 Content-Type（已改 `Stat()` 结构体）、回填基线前校验 sha256/大小、空 ETag 与非法元数据 fail closed、生产存储端点 https-only、客户端内置字典拆分解除对网络模块的依赖、认证检查移入 vault 写队列、系统弹窗 key 静态扫描。

**已实现的是范围 A 的一个子集**：A1-1～A1-6、A1-10、A2-1～A2-6、A2-8、A3-1～A3-4。RN-App `pnpm check` 全绿，RN-Server `go vet` / `go test ./...` 通过。

**范围 A 中未实现的项**（2026-09-10 复核确认，本节此前笼统写成"范围 A 已实现"，是错误登记）：

| 未做项 | 关联 | 代码证据 |
| --- | --- | --- |
| A1-7 | N9 AAD | `keystore-vault.ts` 无 `aad`/`additionalData` |
| A1-8 | 0c-2 进后台即锁 | `app-lock-gate.tsx:128-129` 只 `noteBackgrounded()` |
| A1-9 | N11 大额验证 | `transfer-form.tsx:112,281`、`order-sheet.tsx:353`、`predict-enable-screen.tsx:167`、`swap-screen.tsx:219` 仍裸调 `requireVerification()` |
| A1-11 | N15 输入框防护 | `wallet-import-screen.tsx` 无 `autoComplete`/`importantForAutofill`/`textContentType`/`spellCheck` |
| A1-12 | N23 剪贴板定时器 | `backup-screen.tsx:132` 裸 `setTimeout` |
| A1-13 | N24 截屏保护范围 | 仅导入页与备份页 |
| A1-14 | N25 备份验证随机化 | `backup-screen.tsx` 固定 seed |
| A1-15 | N36 助记词路由参数 | `navigation/types.ts` 仍是 `WalletBackup: { phrase?: string }` |
| A1-16 | N22 unlimited approve | `swap-screen.tsx:204-215` 主按钮直接 approve |
| A1-17 | N13 Universal Link | `wallet-deep-links.ts` 仍是自定义 scheme |
| A1-18 | N14 WC storage 加密 | `walletconnect-client.ts` 未注入 `storage` |
| A1-19 | N26 SIWE 断言 | 未解析校验 |
| A1-20 | N26/N37 WC 事件 | 全仓无 `client.on(` |
| A1-21 | N30 EIP-712 载荷 | 未用 `TypedDataEncoder.getPayload` |
| A1-22 | N21 keychainService | `vault/ports.ts` 无该字段 |
| A2-7 | 12.2 ESLint 敏感变量 | `eslint.config.mjs` 无对应规则 |
| A3-5 | N13 assetlinks/AASA | RN-Server 无该路由 |
| A3-6 | N27 ADR-0002 措辞 | 未改 |

**2026-09-11 更新：上表除 A3-5 外全部完成**，见 `docs/changes/2026-09-10-fix-verification-scale-and-session-binding.md`（A1-9/16/19 部分/20 部分/21）与 `docs/changes/2026-09-10-fix-wallet-hardening-batch-2.md`（其余项 + 对抗复核后的补齐）。仍未做：

| 未做项 | 关联 | 为什么 |
| --- | --- | --- |
| A3-5 | N13 服务端 `/.well-known/assetlinks.json` 与 AASA | 客户端已改用钱包厂商域名的通用链接并在 Android 走显式包名，抢注路径已闭合；这一项是给**本 App 自己**的深链（`anyfun://` 回跳）用的，属服务端工作，另行排期 |

与本表已实现项的偏差与补充如下，均为有意为之：

| 项 | 实际实现 | 与表中描述的差异 |
| --- | --- | --- |
| A1-10（N12） | `authenticate()` 的参数改为内置字典 key，`core/security/prompt-text.ts` 只从内置字典取系统弹窗文案；全部调用方（签名、转出、预测、导入、恢复、新建、备份展示、应用锁）改传 key；补 `wallet.sign.reason / wallet.sign.transfer / wallet.create.authReason / predict.sign.reason` | **窄于表述**：没有做“`security.*`、`send.*`、`wallet.*`、`backup.*` 命名空间禁止远程覆盖”。那会让其它语言的合法翻译失效；确认页文案的真实性应由 bootstrap 签名（N3 方案 2）解决，而不是冻结命名空间 |
| A1-1（N4） | 除表中三项外，`createWallet()` 向非空 vault 新建也要求独立认证 | 补充 |
| A1-2/3（N7/N8） | 损坏文件与 registry 归档到 `*.corrupt.<ISO>`；vault 文件加 `wkCheck` 并在首次成功解密时回填；新增 `needs-recovery` 登录态与恢复面板 | 与表一致，实现细节见变更记录 |
| A2-8（N2） | sha256 在 JS 分块计算（`hashFileSha256`），签名者证书校验未做（需原生） | 与表一致；证书校验留在范围 C |
| A3-1（N18） | pin 存 `app_configs` 的 `release.android`（`packageName`、`signerSha256`），经 `GET/PUT /v1/admin/release-identity/android` 维护，不加租户表列；契约 2026.09.10 已登记该路由 | 按 RN-Server `AGENTS.md` 表设计原则调整存储位置；**RN-Admin 尚无对应界面**，目前只能调接口，界面另行补 |
| A3-2（N33） | 入库用新增的 `objectstore.Stat` 记录真实 ETag，下发前再 `Stat` 比对大小与 ETag；OTA 资源同样处理；manifest 由 `manifest_sha256` 全文校验不再另记 ETag；存储不可达 502、元数据损坏 500、路径不在对象表 404，审计与 error 日志每 (租户, id, 维度) 10 分钟去重 | 独立评审发现首版把 `Head` 的 Content-Type 当成了 ETag，比对形同虚设；已改为结构化 `Stat` 并补 fake 对象存储测试。CopyObject / 存储类变更会改 ETag，需重新入库 |
| A3-3（N34） | `apkinspect` 一次读出内嵌 `runtimeVersion` 与 `extra.applicationId` 入库（内嵌配置非法 JSON 拒绝 `RELEASE_EMBEDDED_CONFIG_INVALID`）；Android 基线的 OTA 上传时比对；旧基线首次 OTA 时回读 APK 回填并写审计 | **窄于表述**：服务端没有租户级 applicationId 配置，只绑基线 APK；iOS 基线服务端不解析 IPA，iOS OTA 不做绑定，只记 warning；租户级 applicationId 可作为 `release.android` pin 的可选字段补齐，待决策 |
| 死代码 | 移除 vault 中从未可达的 scrypt 口令分支（主评审 §0.3）；`runtime-context` 的设备语言判断抽到 `core/config/system-locale.ts` 与弹窗文案共用 | 清理 |
| A1-2（N7） | 只对解析不出来的文件归档（`wipeAll`、`archiveAndReset`、`recoverStorage`）；`remove`/`markBackedUp` 覆写健康文件不备份 | **窄于表述**："任何 write() 前备份"对健康文件没有意义，只在数据可能丢失处归档 |
| A2-2（N1） | fail-closed 发生在 `expo prebuild` 执行 mods 时（`withAppBuildGradle`），`expo config` 不触发；`build-android-release.mjs` 在构建前另做前置检查并要求 keystore 为绝对路径 | 与表述"`expo config` 直接抛错"不同：config 阶段不执行 mods。EAS 的 staging/android-direct profile 同样需要四个签名变量 |
| A2-3 | 权限只做禁用列表（`SYSTEM_ALERT_WINDOW`），未做完整允许列表 diff；`uses-permission-sdk-23:` 行也纳入；v3.1 轮换链（多个签名者）一律拒绝 | 收窄：允许列表待 E-04 取证后建立；直发渠道当前只接受单一生产密钥，轮换需先改门禁 |
| A2-4（N20） | 唯一性校验 `androidPackage`、`iosBundleId`、`scheme`；开发身份放在 `tenants/development-identity.json`，`app.config.ts` 与检查脚本共用 | **不校验 `applicationId`**：它是产品身份（`X-Application-ID`），同一产品的多个租户可以共用，与安装包身份无关 |
| A2-5（N28） | `android-release-gate` 只在 push main 与手动触发时运行 | **PR 上不跑**：生产 keystore 不能暴露给来自 fork 的 PR 构建；PR 靠门禁脚本与插件的单测。密钥登记前 main 上该 job 会失败，是预期状态 |
| N12 补充 | 内置字典拆到 `core/config/builtin-messages.ts`（不依赖网络/运行时模块），`fallback-config.ts` 与 seed 导出脚本改读它；`builtinPromptText` 对未知 key 抛错而非换通用文案；`prompt-text.spec` 静态扫描全部调用方：只能传 key，且 key 必须在内置字典 | 复审发现 `app-lock → fallback-config → api-client` 依赖链让 5 个既有测试失败、两处调用方仍传翻译文案，均已修正 |
| N2 补充 | 冷启动摘要不符与下载后不符同样进入失败态并上报；同一被拒目标只告警、上报一次 | 复审发现的不一致 |

已知未实现：`KeystoreVault.remove/wipeAll` 在生产 UI 仍无调用方（主评审 §6 早已指出，删除工作流属范围 C）。

未做且保持未做：N10 `unavailable` 放行（范围 B 决策项）、`DEFAULT_UNLOCK_TTL_MS`、剪贴板复制入口去留、未备份软门禁、`x-admin-key` 旁路去留。范围 C 全部未动。
