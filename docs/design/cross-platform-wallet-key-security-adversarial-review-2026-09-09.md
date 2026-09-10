# 跨平台钱包密钥安全对抗性评审

状态：Design review / Release blocked for embedded real-funds wallet **and for the current Android direct-distribution artifact**  
日期：2026-09-10（修订 3，codex 独立复审并经主审逐行源码二次核对后；修订 2 为 2026-09-09）  
适用范围：RN-App 的 iOS、Android、多租户构建、bootstrap 配置通道、OTA、APK 直发自更新、外部钱包与嵌入式钱包  
不适用范围：本文不替代第三方渗透测试、密码学实现审计、Apple/Google 真机认证，也不承诺在 root/jailbreak 后保持绝对机密性。

修订记录：

| 修订 | 日期       | 内容                                                                                                                                                                                  |
| ---- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | 2026-09-09 | 初稿：静态存储、JS 密钥边界、认证绑定、OTA 签名、剪贴板、删除语义、四方案比较、目标模块设计                                                                                            |
| 2    | 2026-09-09 | 专家组四路对抗验证（密钥生命周期、发布链/供应链、UI/平台/外部钱包、原生可行性）。新增 3 项排在 OTA 之前的 P0，修正 9 处不准确陈述，补 15 项遗漏，重排门禁与阶段 0，修订工程量估算 |
| 3    | 2026-09-10 | codex 三路独立复审（密钥/认证/WalletConnect、发布链/bootstrap/OTA、交易/恢复/深链），主审对其全部结论逐行源码核对并复跑 focused Jest。修正修订 2 的 10 处陈述（0.4），新增 N33–N38，扩写 N2/N6/N9/N11/N17/N18/N20/N22/N26/N27/N28，signingConfig 修复补 prebuild 约束，门禁与阶段 0 同步；P0 排序不变 |

## 0. 修订 2 与修订 3：对抗验证结论

### 0.1 验证方法

主审重新执行了修订 1 声称的全部复现命令，并对四路专家的每一条 P0/P1 结论在源码或产物上做了二次核对。专家只提供了“源码支持”而主审未逐行复核的条目，在本文中标注为 `源码支持`，不标 `已验证`。

| 复现项                                                                                                  | 结果                                                                                            |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| focused Jest：vault、signer、capability boundary、app lock gate、screen protect                          | 5 suite / 31 test 通过（修订 3 于 2026-09-10 工作树复跑，仍为 5/31）                            |
| Go OTA：`TestValidateOTAManifestPackage*`、`TestApplyManifestStrategy*`                                 | 3/3 通过                                                                                        |
| `aapt dump xmltree` build25 APK                                                                          | `allowBackup=false`、`fullBackupContent`、`dataExtractionRules` 均存在；minSdk 24、target 36     |
| **`apksigner verify --print-certs`** 对 `artifacts/` 全部 5 个 release APK（1.2.4 → 1.2.11）             | 签名者一律 `CN=Android Debug`，SHA-256 `fac61745…1033b9c`，与 prebuild 生成的 `android/app/debug.keystore`（RN 模板公开密钥，不入库）一致 |
| `assets/index.android.bundle` 魔数                                                                       | `c61fbc03`：Hermes 字节码。属混淆而非边界                                                       |
| 工具可用性                                                                                              | node、pnpm、go、aapt、java、apksigner（`~/android-sdk/build-tools`）可用；adb、xcodebuild、gradle、frida 不可用 |

### 0.2 结论变化

修订 1 把“OTA 无端到端签名”列为发布链第一优先级。对抗验证证明有三条**更短、更少前置条件**的路径先于它：

1. **Release APK 用 React Native 模板的公开 debug 密钥签名**。Android 安装器对“同包名 + 同签名 + versionCode 递增”的 APK 视为合法升级并保留应用数据。任何人都持有这把密钥。这使系统安装器提供的完整性保证归零，也使第 2 条无法靠“安装器会校验签名”兜底。
2. **应用内 APK 自更新不校验内容**。bootstrap 已下发 `update.full.sha256`，客户端目标结构把它丢掉，只比大小，随后把文件直接交给系统安装器。
3. **未签名的 bootstrap 是一条完整的安全控制通道**。它决定 RPC 端点、WalletConnect projectId、预测平台域名与 scopeId、OTA 是否静默下载与是否强制立即重载、APK 下载地址、以及系统生物识别弹窗里显示的文案。预测平台的合约地址再由该域名的 `public-info` 下发，用户随后为这些地址签署无限授权。

同时，现状中存在一条修订 1 未点明的 P0：**助记词展示复用签名的 5 分钟解锁缓存**，且认证“不可用”时放行。

因此修订 2 的排序是：先修复发布产物身份与 APK 通道，再让 bootstrap 中的安全相关字段获得真实性（签名或编译期固化），OTA 签名与原生签名器并行推进。修订 1 的目标架构（外部钱包默认 + 原生签名器深模块）不变，但补齐了它缺失的决策项（见第 8 节）。

### 0.3 修订 1 中被修正的陈述

| 修订 1 陈述                                                        | 核对结果                                                                                                                                                                       |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| §4.2 “使用 scrypt/HKDF”                                            | `deriveEntryKey` 的 scrypt 分支只在传入 passphrase 时触发，两个调用点均未传。实际只有 HKDF(WK, salt)。属死代码，不构成弱化，但描述不实                                          |
| §4.4 “包装密钥缓存 5 分钟”                                         | TTL 到期只是恢复弹窗，不擦除；重新解锁时旧引用被覆盖而非清零；`lock()` 仅在应用锁启用、设备已录入且已登录时由闸门调用。准确说法是“5 分钟免弹窗、进程内无限驻留”               |
| §4.4 “存在 TOCTOU”                                                 | JS 单线程下不存在竞态。真实问题是“一次认证授予后续任意操作的环境权限”，以及认证结果可被同信任域 JS 伪造                                                                        |
| §1 “由 Keychain/Keystore 约束的密钥执行签名”                       | Secure Enclave 与 StrongBox 不支持 secp256k1。硬件只能保护包装密钥；签名密钥永远是软件密钥，只能缩短其明文窗口                                                                 |
| §9 “租户 A 能读取 B 的 Keychain”                                   | iOS 默认 access group 为 `TeamID.bundleId`，不同 Bundle ID 且无共享 access group 即隔离。per-tenant `keychainService` 是纵深防御而非边界。真正被违反的是“包名与默认构建相同”     |
| §9 暗示租户是 JS 参数                                              | 服务端按 `Host` 解析租户（`tenant_resolver.go`），`x-application-id` 不参与。租户路由已由编译期 API origin 决定，缺的是签名，不是路由                                          |
| §4.5 “导航持久化扩大暴露面”                                        | `NavigationContainer` 无 `initialState/onStateChange`，仓库无 `persistNavigationState`。属假设性风险，已标注                                                                     |
| §7.1 “connector 已覆盖链协商”                                      | 仅在 optionalNamespaces 中声明支持 `chainChanged/accountsChanged`，全仓库没有任何 `client.on(...)` 监听，`session_delete` 从未出现；签名请求固定取 `chains[0]`。恢复存在，协商言过其实。修订 2 写成“已订阅”亦不准确，修订 3 已改 |
| §1 第 6 点 “APK 已做静态检查”                                      | 检查了 Manifest，未检查签名者证书。修订 2 补上                                                                                                                                 |
| §4.8 只写“无 SCA/SBOM”                                             | 漏记已成立的正向基线：`packageManager: pnpm@10.28.1`（默认阻断依赖生命周期脚本）、无 postinstall、lockfile 1230/1230 条 integrity、`engines` 限定 node 22–24                    |

### 0.4 修订 2 中被修正的陈述（修订 3）

以下由 codex 复审提出、主审在源码上逐条确认后修改；文件与行号以 2026-09-10 工作树为准。未被采纳或被降级的 codex 结论及理由见 0.6。

| 修订 2 陈述                                                        | 核对结果                                                                                                                                                                       |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| §4.7/N11 “转出表单调用时不带 `usdValue`，永不触发大额判定”         | `send-screen.tsx:340` 传入 `usdValue: usd`，转出页会触发大额判定。无参数调用的是预测划转 `transfer-form.tsx:112,281`、下单 `order-sheet.tsx:353`、开通 `predict-enable-screen.tsx:167`、兑换 `swap-screen.tsx:219`、争议 `dispute-sheet.tsx:93` |
| §4.11/N26 “`accountsChanged/chainChanged/session_delete` 已订阅但没有 handler” | 仅在 optionalNamespaces 声明支持，无任何 `client.on(...)`，`session_delete` 未出现。另：`refresh()` 会用服务端返回值覆盖本地会话地址（`http-session-gateway.ts:160-163`）    |
| §4.10/N17 “静态 `ADMIN_API_KEY` + 自报 `x-admin-id` 即为审计主体”  | 浏览器主路径是 `rn_admin_session` cookie + 用户名密码（`server.go:326-345`）；API key 是 `ADMIN_API_KEY` 配置时才开启的自动化旁路（`:346-352`），actor 自报。单账号、无 RBAC/双人审批的结论不变 |
| §4.2/N20 “任何开发者机器上的 dev 构建可直接覆盖安装生产应用”       | 无租户默认构建 versionCode 为 1（`app.config.ts:74`），需提高才能覆盖；但任何设置 `EXPO_PUBLIC_TENANT=anyfun` 的构建即为同包名、同签名、同 versionCode 25，Android 允许同 versionCode 替换安装。风险实质不变，措辞收窄 |
| §4.2 “指向仓库内 `android/app/debug.keystore`”                     | `.gitignore:16-18` 忽略 `/android` 与 `/artifacts`，密钥与产物不入库；它是 `expo prebuild` 从 RN 模板生成的公开密钥。安全结论不变                                              |
| §4.2/§13 “`build.gradle` 的 release 必须引用外部注入的 signingConfig” | `build-android-release.mjs:112` 每次执行 `expo prebuild --clean`，直接编辑 `android/app/build.gradle` 会被覆盖；修复必须落在 config plugin 或构建期注入                        |
| §4.1 “服务端会校验 runtime、asset hash、applicationId”             | `ota.go:530-531` 对 `applicationId` 仅校验非空，`ota.go:416` 把 manifest 自带值写回最终 manifest。应写为“仅校验存在性”（N34）                                                    |
| §4.4/§4.10 “每次 bootstrap 成功后静默 `checkForUpdateAsync` + `fetchUpdateAsync`” | `runtime-context.tsx:338` 对同一配置 key 15 分钟内不重复。静默、无用户同意的性质不变                                                                                             |
| §4.12 “swap 路径 unlimited approve 无确认页、无 `requireVerification`” | `swap-screen.tsx:215,219` 对 swap 本身有确认弹层与验证；`:204-216` 的 unlimited approve 在主按钮点击时直接 mutate，先于两者。收窄为“approve 步骤无确认无验证”（主审补充，codex 未提出） |
| §4.5/N9 “`signTransaction` 有 ethers 的 from 校验兜底”             | 仅嵌入式签名器的 `Wallet.signTransaction` 有此校验；外部 `eth_sendTransaction` 原样发送 `transaction.from ?? connection.address`（`walletconnect-connector.ts:436`），本地无等价校验（N37） |

### 0.5 发现登记表

编号在后续章节与第 11 节实验、第 12 节门禁中引用。“状态”仅指本次评审的证据等级，不指修复状态。修订 3 新增 N33–N38，并按 0.4 改写了 N2/N6/N9/N11/N17/N18/N20/N22/N26/N27/N28 的描述。

| 编号 | 级别 | 发现                                                                                          | 状态     | 章节  |
| ---- | ---- | --------------------------------------------------------------------------------------------- | -------- | ----- |
| N1   | P0   | Release APK 由公开 debug 密钥签名；已装机用户无法安全轮换                                      | 已验证   | 4.2   |
| N2   | P0   | APK 自更新（仅 `direct` 分发路径）丢弃 sha256、不 pin 签名者，直接交安装器；store/mdm 分支打开外部 URL | 已验证   | 4.3   |
| N3   | P0   | bootstrap 未签名却控制 RPC、平台域名、更新策略、弹窗文案；合约地址运行时下发后被无限授权      | 已验证   | 4.4   |
| N4   | P0   | `revealMnemonic` 共享 5 分钟解锁缓存；认证不可用放行                                          | 已验证   | 4.7   |
| N5   | P0   | 私钥、根种子、助记词进入 JS；`withPrivateKey` 可原样返回                                       | 已验证   | 4.6   |
| N6   | P0   | 认证是可注入的 DI 端口，`KeystoreVault`/`expoSecureStore` 导出，同信任域内任意 JS（OTA、依赖）可零弹窗构造 vault | 源码支持 | 4.6   |
| N7   | P1   | vault 文件损坏或版本不符时读为空，随后写入整体覆盖；UI 引导用户“创建钱包”                     | 已验证   | 4.5   |
| N8   | P1   | SecureStore 无包装密钥时静默铸新，旧条目仍列出但不可解；同一 vault 混用两把 WK                | 已验证   | 4.5   |
| N9   | P1   | AES-GCM 无 AAD，address/kind/path 未认证；`signMessage/signTypedData` 无 from 校验；ethers from 校验仅嵌入式签名器 | 源码支持 | 4.5   |
| N10  | P1   | 生物识别默认接受 Class 2；`isDeviceEnrolled` 异常即“不可用”即放行                              | 已验证   | 4.7   |
| N11  | P1   | `smart` 策略下任一认证为后续任意操作背书；SIWE 登录不经 `useRequireVerification`；预测划转/下单/开通、兑换、争议路径不传 `usdValue`（转出页传） | 源码支持 | 4.7   |
| N12  | P1   | 系统生物识别弹窗文案由调用方与服务端字典决定；两处 reason 是未翻译的 i18n key                 | 已验证   | 4.7   |
| N13  | P1   | 外部钱包深链使用可抢注的自定义 scheme；回跳 `anyfun://` 同理                                    | 已验证   | 4.11  |
| N14  | P1   | WalletConnect `SignClient` 未注入存储，会话对称密钥明文落 AsyncStorage                          | 源码支持 | 4.11  |
| N15  | P1   | 导入页文本框无自动填充/IME/词库学习防护                                                        | 源码支持 | 4.8   |
| N16  | P1   | `SYSTEM_ALERT_WINDOW` 来自 Expo 模板，未用 `blockedPermissions` 移除                            | 已验证   | 4.9   |
| N17  | P1   | 管理端为单账号 session 登录，另保留 `x-admin-key` + 自报 `x-admin-id` 的弱身份自动化旁路；无 RBAC/双人审批 | 已验证   | 4.10  |
| N18  | P1   | 服务端入库只记录 `signerSha256` 与 `packageName`，只比对 versionName/versionCode；不按租户 pin 签名者，也不校验包名 | 已验证   | 4.2   |
| N19  | P1   | `rollBackToEmbedded` 指令与 `ON_ERROR_RECOVERY` 原生路径均无签名                               | 源码支持 | 4.10  |
| N20  | P1   | 生产租户包名与无租户默认构建相同 `com.anyfun.foundation`；无跨租户 package/bundle/scheme 唯一性门禁 | 已验证   | 9     |
| N21  | P1   | 预测平台 JWT/CLOB HMAC secret 与会话 token 存于同一无认证 SecureStore                           | 已验证   | 4.5   |
| N22  | P1   | 交易守卫不解码 calldata、费率表仅 4 条链；`signTypedData` 零策略；Safe relay 目标任意；swap 的 unlimited approve 先于确认与验证 | 源码支持 | 4.12  |
| N23  | P2   | expo-clipboard 无 `localOnly/expiration`；60 秒清理不取消且会清掉用户随后复制的内容             | 已验证   | 4.8   |
| N24  | P2   | 截屏保护只在两页；WC 二维码未保护；`FLAG_SECURE` 首帧竞态；iOS 切换器快照落盘                   | 源码支持 | 4.9   |
| N25  | P2   | 备份验证固定 seed 只考同 3 个位置、无限重试、可跳过                                            | 已验证   | 4.8   |
| N26  | P2   | SIWE 消息客户端零校验；会话地址采用服务端返回值且 `refresh()` 会覆盖；WalletConnect 事件仅声明未监听 | 源码支持 | 4.11  |
| N27  | P2   | 远程语言包 SHA-256 来自同一未签名 bootstrap：完整性 ≠ 真实性；语言包 `tenantId` 未与当前租户比对 | 已验证   | 4.13  |
| N28  | P2   | CI action 以 tag 固定、无 `permissions:`；CI 不构建/验证 release 产物；Gradle 无依赖校验并引入 jitpack，wrapper 无 `distributionSha256Sum`；iOS 无 Podfile.lock | 源码支持 | 4.13  |
| N29  | P2   | 助记词固定 128 位；不支持 BIP-39 passphrase；每次签名重派生使根种子进入 JS 堆                   | 已验证   | 4.6   |
| N30  | P2   | 外部 Adapter 的 EIP-712 载荷缺 `primaryType`/`EIP712Domain`                                     | 源码支持 | 8     |
| N31  | Info | 无任何 root/越狱/调试信号采集                                                                  | 源码支持 | 10    |
| N32  | Info | `gateway-context` 硬编码 `mode: "mock"`，无法承担演示/真实隔离标记                              | 已验证   | 1     |
| N33  | P1   | 发布后对象存储中的 APK 被同大小替换时，服务端下载不重算 hash（DB sha 仅作 ETag），客户端亦不校验 | 源码支持 | 4.3   |
| N34  | P2   | OTA manifest `applicationId` 服务端仅校验非空并原样写回；客户端只比对 version/buildNumber       | 源码支持 | 4.10  |
| N35  | P2   | vault `putSecret` 的读、取 WK、写三步无串行化；并发写入可丢条目或产生两把 WK                   | 源码支持 | 4.5   |
| N36  | P2   | 助记词以 navigation 参数进入路由状态与 React state，首次展示不要求独立认证；无导航持久化，属假设性 | 源码支持 | 4.8   |
| N37  | P2   | WalletConnect `parseAccounts` 取首地址却合并全部账户的链；`submitTransaction` 不断言 `from`；会话外 chainId 由 SDK 拦截 | 源码支持 | 4.11  |
| N38  | Info | 账户 registry 损坏或版本不符时静默清空（标签/当前账户丢失，密钥不受影响）                       | 源码支持 | 4.5   |

### 0.6 修订 3：codex 独立复审与主审二次核对

2026-09-10 由 codex 以只读方式分三路复审本文（密钥/认证/WalletConnect；发布链/bootstrap/OTA；交易/恢复/深链），主审随后对 codex 的每一条结论在源码上逐行核对，并在当前工作树复跑 focused Jest。本节记录采纳、降级与补充；文档其余章节已按采纳结果改写。

| 复现项                                                                  | 结果                                                                                                   |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| focused Jest（2026-09-10 工作树，含未提交的 predict 改动）              | 5 suite / 31 test 通过                                                                                 |
| `@walletconnect/sign-client@2.24.0` `Engine.isValidRequest`             | 调用 `isValidNamespacesChainId(namespaces, chainId)`，会话外 chainId 抛 `MISSING_OR_INVALID`           |
| `predict.sign.reason` / `wallet.sign.transfer` 在 `i18n/seed/*.json`   | 0 命中，N12 仍成立                                                                                     |
| 附录 A 平台事实（expo-secure-store、expo-local-authentication）        | 在 node_modules 复核成立                                                                               |

**codex 结论被采纳**：0.4 表中除第 9 项外的 9 项；新增 N33–N38；N2/N6/N9/N18/N20/N22/N27/N28 扩写；§4.2 与 §13 的 signingConfig 修复改为 config plugin 或构建期注入。

**codex 结论被降级或合并，理由如下**：

- “`chainRef(chainId)` 接受任意正整数，未确认属于当前会话”：SDK 层已拦截（见上表）。这是纵深防御缺口而非可利用路径，并入 N37 P2。
- “`parseAccounts` 取首地址”“`submitTransaction` 不断言 `from`”：成立，但外部钱包只为自身账户签名，错误 `from` 会被钱包拒绝，多地址 EIP-155 会话罕见。签名器边界应自校验，登记 N37 P2。
- “会话地址不变量缺失（P1）”：`verify()` 部分修订 2 的 N26 已写，新增点只有 `refresh()` 覆盖。后果是签名器按错误地址查找失败，属身份混淆与拒绝服务，不是资产路径。并入 N26，保持 P2。
- “发布后对象替换（codex 一处写 P0）”：它是 A4 攻击者路径，且 N2 的客户端 sha256 校验（期望值来自数据库）本身即覆盖此路径。登记 N33 P1，不单列 P0。
- “OTA `applicationId` 未绑定（P1）”：租户由 Host 解析，`applicationId` 只影响 `X-Application-ID` 头，登记 N34 P2。
- “vault 并发竞态（P1/P2）”：导入页有 single-flight 守卫（`wallet-import-screen.tsx:50,78`），创建为单次操作，现有 UI 触发面窄，登记 N35 P2。
- “N20：任何开发包不能直接覆盖生产”：技术上成立，但带租户配置的构建即为同 versionCode，风险实质不变，仅收窄措辞。
- “`approvedSafe` 本地永久信任、不再读链”（`http-predict-account-gateway.ts:314-329`）：成立，但代码注释说明为有意设计，属状态陈旧而非密钥安全，不登记。
- “助记词进 navigation 参数应单独编号（P1）”：采纳编号为 N36，但定为 P2：仓库无导航持久化与遥测依赖，当前是回归护栏问题而非可利用路径；§12.1 对应门禁仍保留。

**主审补充（codex 未提出）**：§4.12 swap 描述错误（0.4 第 9 项）；N12 与附录 A 在当前工作树重新核实；N37 的 SDK 拦截事实。修订 3 没有改变 P0 集合与排序。

## 1. 结论

当前实现具备一个有价值的静态数据保护基线：钱包条目以 AES-256-GCM 加密保存在 AsyncStorage，包装密钥交给 Expo SecureStore；Android 当前 APK 关闭了 `allowBackup`，iOS 使用 `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`；转出确认页展示完整收款地址、链名与代币合约并带仿冒告警；pnpm 10 默认阻断依赖生命周期脚本，lockfile 全量 integrity；服务端按 Host 解析租户，租户 API origin 在编译期固化。这些能明显提高“只拿到应用沙箱文件”的攻击成本。

但该实现**不足以承载生产真实资产的嵌入式自托管钱包**，并且**当前 Android 直发产物本身不应继续分发**。原因按可利用性排序：

1. **发布产物身份失效（N1）**。全部 release APK 由 React Native 模板附带的公开 debug 密钥签名。Android 安装器把“同包名、同签名、versionCode 更大”的任何 APK 视为合法升级并保留应用数据，因此任何人都能制造一个能读取本应用 SecureStore 与 AsyncStorage 的“升级包”。更严重的是这把密钥无法安全轮换：APK v3 密钥轮换的授权链必须由旧密钥签发，而旧密钥是公开的。
2. **APK 自更新不校验内容（N2、N33）**。客户端只检查 `https://` 前缀与文件大小，丢弃 bootstrap 提供的 sha256，直接把文件交给系统安装器；而系统安装器的签名校验已因第 1 条失效。服务端下载也不重算对象 hash，对象存储中的同大小替换不会被任何一方发现。
3. **bootstrap 是一条未签名的安全控制通道（N3）**。它决定 RPC 端点、WalletConnect projectId、预测平台域名与 scopeId、OTA 是否静默下载与是否强制立即重载、APK 下载地址、以及系统生物识别弹窗里的文案；预测平台的合约地址由该域名返回，用户随后为它们签署 `approve(MAX)` 与 `setApprovalForAll`。控制 API、数据库或 TLS 终结点的攻击者不需要碰 OTA 就能完成资产转移。
4. **密钥使用边界仍在 JavaScript 内（N4、N5、N6）**。私钥、根种子和助记词以不可清零的 JS 字符串进入 JS；`withPrivateKey` 泛型回调允许调用方原样返回私钥；助记词展示复用签名的 5 分钟解锁缓存；认证是可注入的依赖端口，任何同信任域 JS 都能构造一个“永远认证成功”的 vault。
5. **认证既不绑定密钥使用也不绑定操作（N10、N11、N12）**。生物识别默认接受 Class 2；认证能力异常即视为“不可用”并放行；`smart` 策略下任一次认证为后续任意操作背书；系统弹窗文案由调用方与服务端字典决定，两处 reason 是未翻译的 key。
6. **OTA 无端到端真实性（N17、N19、N34）**。生产配置有更新 URL 却没有 `codeSigningCertificate`；服务端在 hash 校验后改写 manifest 且不输出 `expo-signature`；`rollBackToEmbedded` 与 `ON_ERROR_RECOVERY` 路径同样无签名；OTA manifest 的 `applicationId` 只校验非空；管理端为单账号 session 登录并保留可自报身份的 API key 旁路。
7. **恢复材料的暴露面比修订 1 描述的更宽（N7、N8、N13、N15、N23、N25）**。vault 文件损坏会被静默清空并引导用户新建；包装密钥丢失时静默铸新；外部钱包深链走可抢注的自定义 scheme；导入页无 IME 防护；剪贴板清理会误删用户后续复制的内容；备份验证固定考同 3 个位置。
8. **现有证据主要来自源码、单元测试、resolved config 与产物静态检查**。当前环境没有 `adb`、emulator 或 `xcodebuild`，iOS 从未构建（无 `ios/` 目录、无 Podfile.lock），不得把任何 iOS 结论描述为已验证。

因此建议采用分层路径，顺序与修订 1 不同：

- **立即（阶段 0a，阻断分发）**：生成 KMS/HSM 托管的生产签名密钥并重新发布；服务端按租户 pin `signerSha256`；客户端在安装前校验 sha256 与签名者证书；因旧密钥公开，已装机用户必须在引导备份后卸载重装，这一点要如实写进用户沟通。
- **立即（阶段 0b，收敛控制通道）**：对 bootstrap 中影响签名与资金的字段做编译期固化（合约地址、链、平台域名）或服务端签名 + 客户端嵌入信任根；安全关键 i18n key 只用内置字典；OTA 由“静默下载 + 服务端可强制重载”改为签名后才允许应用。
- **近期真实资产默认外部钱包**，复用已有 WalletConnect Adapter，但先修复自定义 scheme 深链、会话存储与 SIWE 校验，再完成双平台真实钱包 E2E。
- **嵌入式本地钱包改成原生签名器深模块**：日常调用者只能提交结构化签名请求；用户在独立原生窗口核对规范化交易；包装密钥由 Keychain/Keystore 绑定认证，secp256k1 签名在原生缓冲区内完成。必须明确：硬件不能持有 secp256k1 密钥，原生化缩短的是明文窗口，不是消除。
- **P-256/passkey + ERC-4337** 是唯一密钥真正不可导出的路线，作为单链试点独立立项；**MPC/TSS** 仅在业务明确需要托管式恢复后再评估。

在第 12 节 P0 门禁全部满足前，保持“嵌入式真实资金钱包”发布阻断，并**同时阻断当前 debug 签名 APK 的继续分发**。演示网络或零余额开发钱包必须在 UI、环境和后端策略上明确隔离；`gateway-context.tsx` 中硬编码的 `mode: "mock"` 不能承担这一标记（N32）。

## 2. 评审问题与判定标准

本评审回答五个问题：

1. 设备丢失、沙箱文件泄漏、备份迁移、root/jailbreak、后台驻留时，攻击者能得到什么？
2. 一个通过合法发布权限进入应用的恶意 OTA、恶意 APK 升级或被投毒依赖，是否能调用现有接口导出密钥或诱导签名？
3. 一个控制了 API 域名、数据库或 CDN、但没有任何客户端代码发布权限的攻击者，能否让用户签出资产转移？
4. 外部钱包、原生本地钱包、MPC、智能账户哪个方案对当前最常见调用者最小且可执行？
5. 哪些结论已经实证，哪些必须通过真机、双租户、破坏性恢复实验后才能上线？

判定以 OWASP MASVS 的存储、密码学、认证、平台交互、代码质量与弹性要求为下限。MASVS-STORAGE-1 要求安全存储敏感数据；MASVS-AUTH-2 要求对敏感操作执行本地认证并绑定到平台机制；MASVS-CODE-2 要求应用只接受经签名的更新；MASVS-CODE-3 要求应用只依赖没有已知漏洞的组件；MASVS-PLATFORM-3 要求应用使用安全的 IPC 与深链机制。参考 [OWASP MASVS](https://mas.owasp.org/MASVS/)、[MASVS-STORAGE-1](https://mas.owasp.org/MASVS/controls/MASVS-STORAGE-1/)、[MASVS-AUTH-2](https://mas.owasp.org/MASVS/controls/MASVS-AUTH-2/)、[MASVS-CODE-2](https://mas.owasp.org/MASVS/controls/MASVS-CODE-2/)、[MASVS-CODE-3](https://mas.owasp.org/MASVS/controls/MASVS-CODE-3/) 与 [MASVS-PLATFORM-3](https://mas.owasp.org/MASVS/controls/MASVS-PLATFORM-3/)。

“安全”在本文中不是二元属性：

- `已验证`：在当前仓库或产物上复现，并记录了命令和结果。
- `源码支持`：能从实现推出，但尚未经过真实系统行为验证。
- `待验证`：设计目标或平台预期，必须通过第 11 节实验取证。
- `不保证`：平台或威胁模型决定无法给出绝对保证，例如已完全控制进程的 root/jailbreak 攻击者。

## 3. 威胁模型

### 3.1 受保护资产

- BIP-39 助记词、根种子、EOA 私钥、包装密钥和恢复材料；
- 签名授权的真实语义：链、账户、收款地址、金额、方法、calldata 中的 spender/operator、typed-data 域与 primaryType；
- 客户端信任的配置事实：链 ID、RPC 端点、平台域名、合约地址、代币目录、更新策略与下载地址；
- WalletConnect pairing URI、会话对称密钥和活跃会话；
- 预测平台 JWT、CLOB HMAC 凭证、Safe 地址与业务会话 token（它们能在不经钱包签名的情况下下单、撤单或冒用会话）；
- 每个租户的应用身份、**APK 签名密钥**、Keychain/Keystore 命名空间、OTA 信任根和发布签名私钥；
- 删除、迁移、恢复和签名的不可抵赖审计结果，审计中不得包含秘密。

### 3.2 攻击者

| 编号 | 攻击者能力                                                         | 本评审要求                                                                                     |
| ---- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| A1   | 获得锁定或短暂解锁的设备                                           | 密钥使用绑定最新用户在场；后台立即失效；助记词展示不复用签名缓存                              |
| A2   | 同设备恶意应用、剪贴板读取、第三方 IME、overlay/accessibility 欺骗  | 不把恢复材料放入全局剪贴板或第三方输入法；可信确认 UI 不可被覆盖                              |
| A3   | root/jailbreak、调试器、内存抓取                                   | 缩短明文生命周期、禁止进入 JS；检测仅作风险信号，不宣称绝对防御                                |
| A4   | 控制 API 域名、数据库、CDN 或 TLS 终结点，但没有客户端代码发布权限  | **bootstrap 中影响签名与资金的字段必须有客户端可验证的真实性**；合约地址与链事实编译期固化    |
| A5   | 持有合法 OTA 发布权限或 OTA 签名私钥                               | 每租户客户端信任根、最终载荷签名、双人审批、可撤回；原生签名器仍逐笔核对                       |
| A6   | 能向用户投递 APK（钓鱼链接、被篡改的下载源、或本应用更新流程）      | **生产签名密钥私有且托管**；服务端按租户 pin 签名者；客户端安装前校验 sha256 与签名者证书       |
| A7   | npm/Gradle/CocoaPods/GitHub Action 依赖或构建链被投毒              | 锁文件、SCA、SBOM、来源证明、敏感边界负向测试                                                  |
| A8   | 备份、D2D 迁移、卸载重装、旧设备转卖、生物信息变更                  | fail closed；恢复语义明确；卸载不等于删除；密钥失效不静默铸新                                  |
| A9   | 同一设备或发布系统上的租户 A 尝试读取/更新租户 B                    | 原生身份、包名/Bundle ID 唯一、密钥命名空间和 OTA 信任域全部独立                              |
| A10  | 注册了 `metamask://`、`trust://`、`anyfun://` 等 scheme 的恶意应用  | 外部钱包深链走 App Links/Universal Links 或显式 package；自身回跳用已验证的 App Link            |
| A11  | 外部钱包钓鱼、错误链、请求替换、恶意 dApp 元数据                    | 外部钱包核对、域验证、规范化请求与拒绝路径；SIWE 字段客户端断言                               |
| A12  | 逻辑删除后恢复 SQLite/WAL/free page 或残留 Keychain 项              | 每账户密码学擦除或全库包装密钥销毁，并验证不可解密                                             |

不在单一移动应用可承诺的范围：设备 OS、TEE/Secure Enclave 固件和芯片供应链已被完全攻破；用户主动把助记词交给攻击者；智能合约或目标链共识失效。应用仍需限制这些事件的影响半径，并为用户提供明确告警和迁移路径。

## 4. 当前实现证据

### 4.1 已验证的正向基线

| 证据                                   | 结果                                                                                                        | 能证明什么                                                                        | 不能证明什么                                                 |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| focused Jest 主审运行                   | 5 suite / 31 test 通过                                                                                      | vault、signer、capability boundary、app lock、screen protect 当前实现相互一致       | 测试通过不等于设计安全；其中包含对风险行为的回归证明（见 4.5、4.6） |
| focused Go OTA 复核                     | 3/3 通过                                                                                                    | 服务端会校验 runtime、asset hash，`applicationId` 仅校验非空（N34），并会改写已存 manifest | 不证明客户端真实性；测试和响应中都没有 OTA 签名验证          |
| resolved Expo production config         | `updates.url=https://api.anyfun.win/v1/ota/manifest`、runtime `1.2.11`，无 `codeSigningCertificate`        | 当前生产解析配置确实有 OTA URL 且未配置客户端代码签名信任根                        | 不证明服务器或网络不能被攻破                                 |
| `aapt` 检查 release APK                 | `com.anyfun.foundation`，version `1.2.11`，build 25，`allowBackup=false`，`dataExtractionRules` 存在        | 当前这个 APK 的二进制 Manifest 关闭 Android backup                                 | 不代表所有未来租户/构建；不证明 OEM D2D 或恢复行为           |
| **`apksigner verify --print-certs`**    | 5 个 release APK 签名者均为 `CN=Android Debug`，SHA-256 `fac61745…1033b9c`                                   | **产物身份失效（N1）**                                                             | —                                                            |
| Hermes 字节码                           | `index.android.bundle` 魔数 `c61fbc03`                                                                       | JS 以字节码分发，逆向成本略高                                                       | 不是安全边界，不阻止 OTA 替换                                 |
| 依赖基线                                | `packageManager: pnpm@10.28.1`，无 postinstall，lockfile 1230/1230 integrity，`engines` node 22–24            | 依赖解析可复现，生命周期脚本默认阻断                                                | 漏洞状态未验证（`pnpm audit` 因 DNS 未完成）                 |
| 转出确认页（`send-screen.tsx`）源码      | 显示完整 `to`、链名 + chainId、代币完整合约地址与仿冒告警、精确金额、原生币手续费                            | 转出路径的确认信息基线良好                                                          | 无法币手续费；无地址簿；swap 与预测开通路径不具备同等展示     |
| RNG 与 polyfill 顺序                    | `index.ts` 首行导入 `react-native-get-random-values`，ethers 浏览器 shim 在加载时捕获 `globalThis.crypto`    | 生产构建随机数来自 CSPRNG                                                           | —                                                            |
| 工具可用性检查                          | node、pnpm、go、aapt、java、apksigner 可用；`adb`、emulator、`xcodebuild`、gradle、frida 不可用；无 `ios/` 目录 | 明确本次证据上限                                                                    | 不得据此声称真机安全性已验证；iOS 所有结论均无产物支撑        |

复现命令：

```bash
cd RN-App
pnpm test -- --runInBand \
  src/core/wallet/vault/keystore-vault.spec.ts \
  src/core/wallet/signer/embedded-signer.spec.ts \
  src/core/wallet/capability-boundary.spec.ts \
  src/features/security/app-lock-gate.spec.tsx \
  src/core/security/screen-protect.spec.ts

cd RN-Server
GOWORK=off GOCACHE=/tmp/go-build GOMODCACHE=/tmp/go-mod-cache \
  go test ./internal/api \
  -run 'TestValidateOTAManifestPackage|TestApplyManifestStrategy' \
  -count=1 -v

cd RN-App
aapt dump badging artifacts/anyfun-1.2.11-build25-release.apk
aapt dump xmltree artifacts/anyfun-1.2.11-build25-release.apk AndroidManifest.xml
~/android-sdk/build-tools/36.0.0/apksigner verify --print-certs \
  artifacts/anyfun-1.2.11-build25-release.apk
keytool -list -v -keystore android/app/debug.keystore -storepass android \
  -alias androiddebugkey
unzip -p artifacts/anyfun-1.2.11-build25-release.apk assets/index.android.bundle | head -c 8 | xxd

env EXPO_NO_DOTENV=1 EXPO_PUBLIC_TENANT=anyfun EXPO_OS=android \
  EXPO_PUBLIC_DISTRIBUTION_CHANNEL=store EXPO_PUBLIC_OTA_CHANNEL=production \
  pnpm exec expo config --type public --json
```

### 4.2 P0：发布产物身份——Release APK 由公开 debug 密钥签名（N1、N18、N20）

`android/app/build.gradle` 的 `release` buildType 直接写着 `signingConfig signingConfigs.debug`，而 `signingConfigs.debug` 指向 `android/app/debug.keystore`（口令 `android`，别名 `androiddebugkey`）。该文件由 `expo prebuild` 从 React Native 模板生成，`.gitignore` 忽略 `/android` 与 `/artifacts`，因此不在 git 仓库内；但它是模板附带的公开密钥，任何人都能从模板取得。`apksigner` 对 `artifacts/` 下 1.2.4 到 1.2.11 全部 5 个 release APK 的输出一致：签名者 `CN=Android Debug, OU=Android, O=Unknown`，SHA-256 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`，与 `keytool` 读取 `debug.keystore` 的指纹相同。

`docs/SAAS_TENANT_BUILD_RUNBOOK.md` 写明“生产签名不是 Debug Keystore”“APK 必须另外执行签名”，但 `scripts/build-android-release.mjs` 之后没有重签步骤，grep 全仓库也没有任何 `storeFile`/`keyAlias` 覆盖。服务端入库时 `apkinspect` 只验证签名有效并记录 `signerSha256` 与 `packageName`，随后只比对 versionName/versionCode（`RN-Server/internal/api/simplified_releases.go:263-273`），既不按租户 pin 签名者也不校验包名，错误包名或任意有效签名的 APK 都能进入 `verified`（N18），因此发布链也不会拦住。

后果：

- Android 对同包名、同签名、versionCode 更大的 APK 视为合法升级，升级保留 `/data/data/<pkg>`，即 SecureStore 的 SharedPreferences、Keystore alias 的使用权与 AsyncStorage 数据库。攻击者构建 `com.anyfun.foundation` versionCode 26 的 APK，写一段读取 `foundation.wallet.wrap-key.v1` 与 `foundation.wallet.vault.v1` 的代码即可导出全部钱包。投递渠道可以是任意钓鱼链接、被篡改的下载源，或本应用自己的更新流程（见 4.3）。
- 生产租户 anyfun 的包名与 `app.config.ts` 无租户时的默认值相同（N20）。无租户默认构建的 versionCode 为 1（`app.config.ts:74`），需提高后才能覆盖；但任何设置了 `EXPO_PUBLIC_TENANT=anyfun` 的构建产出的就是同包名、同签名、同 versionCode 25 的 APK，Android 允许同 versionCode 替换安装，因此任何开发机都能产出可覆盖生产数据的安装包。`scripts/check-build-profiles.mjs` 只逐租户校验，没有跨租户 package/bundle/scheme/applicationId 唯一性检查，新增租户时同样可能重复。
- **无法安全轮换**。APK Signature Scheme v3 的密钥轮换依赖旧密钥签发的 proof-of-rotation；旧密钥公开，攻击者能签出同样的轮换证明。唯一诚实的修复是：新密钥重新发布 → 引导用户备份助记词 → 卸载重装。参考 [Android：Sign your app](https://developer.android.com/studio/publish/app-signing) 与 [APK Signature Scheme v3](https://source.android.com/docs/security/features/apksigning/v3)。

目标控制：

1. 生产签名密钥由 KMS/HSM 或 Play App Signing 托管，构建机只获得签名调用权限；release signingConfig 由 config plugin 或构建期注入提供，缺失即构建失败。不能直接编辑 `android/app/build.gradle`：`build-android-release.mjs:112` 每次执行 `expo prebuild --clean`，会整体重生成 `android/` 工程并覆盖手工修改。
2. `tenant.json` 记录期望 `signerSha256`；服务端入库时不匹配拒绝；`build-android-release.mjs` 与 CI 用 `apksigner verify --print-certs` 做门禁。
3. 每个租户使用独立包名、独立签名密钥；默认无租户构建的包名不得与任何生产租户相同；`check-build-profiles.mjs` 增加跨租户 package/bundle/scheme/applicationId 唯一性检查。
4. 把“已装机用户迁移到新签名”作为一次正式的安全事件处理：发布说明、备份引导、旧版本强制提示、下载页说明。

### 4.3 P0：应用内 APK 自更新不校验内容（N2、N33）

anyfun 租户 `distributionChannel: "direct"`，APK 由应用自己下载并调起系统安装器（`REQUEST_INSTALL_PACKAGES`）。bootstrap schema 在 `update.full` 中包含 `sha256`（`src/core/config/bootstrap.schema.ts`），但 `runtime-context.tsx` 构造的 `ApkReleaseTarget` 只有 `releaseId/url/size`（`src/core/updates/apk-download-manager.ts`），下载完成后只比对大小，随后 `apk-download.ts` 直接 `getContentUriAsync` 并以 `ACTION_VIEW` 交给安装器。URL 校验只有 `https://` 前缀，无同源要求，无签名者 pin。`docs/design/apk-update-flow-2026-09-09.md` 把完整性全部寄托在“系统安装器会校验签名”，而 4.2 使该校验形同虚设。该路径仅在 `distribution === "direct"` 时启用（`runtime-context.tsx:287`）；store/mdm 分支打开外部 URL，不经下载管理器。

服务端侧同样没有第二道校验（N33）：`simplified_releases.go` 只在上传时计算 sha256 并入库，`publicReleaseDownload`（`:456` 起）直接从对象存储流式返回，数据库中的 sha256 只用作 ETag，不重算内容。对象存储中的 APK 被同大小恶意包替换后，服务端、bootstrap 与客户端三方都不会发现；叠加 N1，系统安装器仍视其为合法升级。这是 A4 攻击者（控制对象存储或 CDN）的路径，客户端按 bootstrap `sha256` 校验即可覆盖。

缓存目录本身是应用私有目录，FileProvider content URI 带 `FLAG_GRANT_READ_URI_PERMISSION`，非 root 设备上没有跨应用替换窗口；真正的组合风险是：未签名 OTA 中的恶意 JS 可以自己写一个 APK 到缓存目录并调起安装器，用户点一次“安装”即完成原生接管。

目标控制：

1. 下载完成后原生分块计算 SHA-256 并与 bootstrap 的 `sha256` 比对；bootstrap 缺 sha256 时拒绝进入安装。这一条同时覆盖 N33；服务端另应在下载时比对对象存储 ETag/hash 与入库值。
2. 安装前用 `PackageManager.getPackageArchiveInfo(..., GET_SIGNING_CERTIFICATES)` 读取 APK 签名者证书，必须等于编译期 pin 的 `signerSha256`。
3. 下载 URL 必须与租户 API origin 同源；`decision=required` 只能加强提示，不能绕过以上校验。
4. 这些校验本身位于 JS 时仍可被 OTA 篡改；因此 OTA 签名（4.10）是它们的前置条件，而签名密钥私有（4.2）又是 OTA 签名有意义的前置条件。

### 4.4 P0：未签名的 bootstrap 是安全控制通道；合约地址运行时下发后被无限授权（N3）

`src/core/config/bootstrap-repository.ts` 通过 HTTPS 拉取 `/v1/mobile/bootstrap`，只做 zod 结构校验，缓存 7 天。它携带：

| 字段                                             | 被谁消费                                                       | 被篡改的后果                                                                                          |
| ------------------------------------------------ | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `wallet.networks[].rpcUrls`                      | 链层                                                           | 假余额、错误 nonce、费用诱导（费率红线已限损，但仅覆盖 4 条链）                                       |
| `wallet.walletConnectProjectId`                  | WalletConnect                                                  | relay 切换到攻击者控制的 project                                                                       |
| `services.predict.{domain,scopeId,chain}`        | `public-info.ts` → 合约地址                                    | **用户在“开通”步骤对攻击者合约签署 `USDW.approve(MAX)×4 + CTF.setApprovalForAll×3`**（Safe MultiSend） |
| `update.ota.applyStrategy`、`update.decision`    | `update-service.ts`                                            | bootstrap 成功后静默 `checkForUpdateAsync` + `fetchUpdateAsync`（同配置 key 15 分钟内不重复）；`immediate` 触发全屏遮罩并 `reloadAsync` |
| `update.full.actionUrl`                          | APK 自更新                                                     | 见 4.3                                                                                                |
| `localization.messages` 与远程语言包             | `t()` → `LocalAuthentication.authenticateAsync({promptMessage})` | 系统生物识别弹窗文案、转出页标签可被替换（N12、N27）                                                  |

客户端对 `public-info` 只断言 scopeId 与 chainId，而这两个值本身来自 bootstrap，因此不构成独立信任根。仓库已经为 chainId 建立了“协议事实编译期固化”的原则（`wallet-runtime-config.ts` 的 `PROTOCOL` 表）并为代币 `verified` 建立了客户端白名单（`token-allowlist.ts`），但没有把同一原则用于 spender/operator 合约地址与平台域名。

这条路径的攻击者不需要任何代码发布权限，也不需要碰 OTA：控制 API 域名、数据库、CDN 或 TLS 终结点即可。修订 1 把 A4 局限在“OTA 服务被攻破”，低估了范围。

目标控制：

1. **合约地址与平台域名编译期固化**：每租户每链的 `PlatformContracts` 进入 `tenant.json` 并编译进原生常量；`public-info` 返回值必须与之一致，否则拒绝开通。这是最小改动、与现有 `PROTOCOL` 表一致的方案。
2. **或**（需要动态性时）服务端对 bootstrap 中的安全相关子对象签名（Ed25519 或与 OTA 同一 RSA 根），客户端嵌入租户公钥校验；语言包 sha256 随之获得真实性。
3. 任何 `approve/setApprovalForAll/permit` 的 spender、operator 必须在确认 UI 展示并对照白名单；不在白名单的地址真实资金档默认拒绝。
4. `security.*`、`send.*`、`wallet.*`、`backup.*` 等安全关键 i18n key 只使用内置字典，禁止远程覆盖；系统认证弹窗的 `promptMessage` 由原生按请求类型生成。（阶段 0 已实现其中“系统认证弹窗文案只取内置字典”这一半：`core/security/prompt-text.ts`；命名空间级禁止远程覆盖会让其它语言的合法翻译失效，确认页文案的真实性改由本条方案 2 的签名解决，见执行范围文档 §6。）
5. OTA 由“静默下载、下次启动自动生效、服务端可强制立即重载”改为“签名校验通过才允许下载与应用”，`immediate` 与 rollback 指令同样需签名（4.10）。

### 4.5 静态存储：有保护，但保护停在“静态文件”边界，且存在数据丢失路径（N7、N8、N9、N21、N35、N38）

`src/core/wallet/vault/keystore-vault.ts` 使用 HKDF-SHA256 从包装密钥 WK 与每条目随机 salt 派生条目密钥，AES-256-GCM 加密后写入 AsyncStorage；WK 经 `expo-ports.ts` 写入 SecureStore，参数 `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`，无 `requireAuthentication`，无显式 `keychainService`。`deriveEntryKey` 的 scrypt 分支需要 passphrase，两个调用点均未传，属死代码；修订 1 的“scrypt/HKDF”描述已修正。

该方案对“只取得 AsyncStorage 数据库、拿不到 WK”的攻击者有效。但对抗验证发现四个现状缺陷：

- **文件损坏 fail-open 覆盖（N7）**。`read()` 在 JSON 解析失败或 `version !== 1` 时返回空 vault，随后任何 `write()` 整体覆盖原文件。UI 路径：`connect("embedded")` 见 0 条目抛 `WalletNotProvisionedError` → `use-session.ts` 进入 `needs-wallet` → 用户点“创建钱包” → 旧密文永久丢失。`keystore-vault.spec.ts` 中 “survives a corrupted vault file instead of crashing the app” 把这一行为固化为规格。OTA 回滚到旧 JS 遇到未来的 v2 文件会重演同一过程，直接威胁第 8 节的迁移。
- **WK 丢失时静默铸新（N8）**。`wrapKey()` 在 SecureStore 无值时无条件生成并写入新 WK，不检查是否已有条目。Android 重装、`ThisDeviceOnly` 项未随备份迁移、Keystore 密钥失效都会触发。旧条目仍出现在 `list()` 中但解密报错；再导入新钱包后同一 vault 里的条目分属两把 WK，且没有任何校验值能检测。修订 1 只把“不静默生成新 key”列为目标，未指出现状正相反。
- **GCM 无 AAD（N9，源码支持）**。address/kind/path 未绑入 AAD；可写 AsyncStorage 者能改 path 索引或交换条目密文。嵌入式签名器的 `signTransaction` 有 ethers `Wallet.signTransaction` 的 from 校验兜底，`signMessage/signTypedData` 没有，会用另一把派生密钥为声称的地址签名；外部钱包路径的 `eth_sendTransaction` 没有本地等价校验（N37）。
- **WK 生命周期（N9）**。TTL 到期只是恢复弹窗，不擦除；重新解锁时旧引用被覆盖而非清零；`putSecret` 中 `wrapKey()` 返回的数组从不 wipe；SecureStore 返回的 base64 字符串本身不可清零。
- **写入无串行化（N35，源码支持）**。`putSecret` 的 `read()` → `wrapKey()` → `write()` 三步之间没有锁（`keystore-vault.ts:221-243`）。两个并发的创建/导入会各自读到同一份文件、各自 push 后整体写回，后写者覆盖前者的条目；若此时 SecureStore 尚无 WK，两者还会各生成一把 WK，后写入者胜出，另一条目永久不可解。导入页有 single-flight 守卫（`wallet-import-screen.tsx:50,78`），创建为单次操作，现有 UI 触发面窄，但边界本身不保证。
- **registry 损坏静默清空（N38，Info）**。`embedded-wallet-gateway.ts:626-636` 的 `readRegistry()` 在 JSON 损坏或 `version !== 1` 时返回空 registry，随后写入覆盖。丢的是账户标签、外部账户元数据与“当前账户”，密钥材料不受影响，但与 N7 同属 fail-open 覆盖模式。

同一无认证 SecureStore 端口还保存预测平台 JWT、CLOB HMAC apiKey/secret/passphrase、Safe 地址（`src/core/predict-platform/credentials.ts`）与安装凭证。CLOB L2 secret 可在不经钱包签名的情况下下单、撤单，应按“会话签名密钥”对待（N21）。

平台事实（本地源码核对，见附录 A）：

- Expo SecureStore Android 在 `requireAuthentication` 时确实用 `BiometricPrompt.CryptoObject(cipher)` 绑定密钥使用，库内无 TOCTOU；但 `KeyGenParameterSpec` 只调用 `setUserAuthenticationRequired`，没有 `setUserAuthenticationParameters`、`setInvalidatedByBiometricEnrollment`、`setIsStrongBoxBacked`；只接受 `BIOMETRIC_STRONG`，PIN-only 设备直接抛错；密钥失效时静默返回 null，写入时会**删除该 keychainService 下全部已认证条目**。叠加 N8，用户新录一枚指纹即等于钱包不可解且被静默替换。
- Expo SecureStore iOS 硬编码 `SecAccessControlCreateWithFlags(..., .biometryCurrentSet)`，无 `.userPresence`/`.devicePasscode`；可选 `WhenPasscodeSetThisDeviceOnly`。因此“WhenPasscodeSet + userPresence”用现有库不可达。

结论：现有库最多能把认证绑到 WK 的读取，且带来 PIN-only 与生物变更两类可用性问题；第 10 节的目标控制需要自定义 Expo Module。

### 4.6 P0：私钥、根种子和助记词进入 JavaScript；认证端口可注入（N5、N6、N29）

`keystore-vault.ts` 的 `createWallet()` 和 `revealMnemonic()` 返回 JS 字符串；`withPrivateKey<T>(..., consume)` 解密后把私钥字符串交给调用方。`keystore-vault.spec.ts:139-140` 执行等价于：

```ts
await expect(
  vault.withPrivateKey(entry.address, "sign", (value) => value),
).resolves.toBe(key);
```

这是可执行证据：当前 Interface 允许任何持有该能力的 JS 调用者把私钥原样返回并外传。`EmbeddedSigner` 在 JS 中用该字符串创建 ethers `Wallet`；对 mnemonic 条目，每次签名都重新 `deriveAccount`，即 BIP-39 种子、BIP-32 主密钥与整条派生路径都在 JS 堆中出现（N29）。Hermes 没有字符串清零 API，字符串不可变且可能被驻留，`TextDecoder().decode()` 之后再 `wipe(plaintext)` 对已产生的字符串无效。参考 [OWASP：Android 内存注意事项](https://mas.owasp.org/MASTG/knowledge/android/MASVS-STORAGE/MASTG-KNOW-0047/)。

更根本的是，`authenticate` 是构造参数里的依赖端口，`KeystoreVault` 类与 `expoSecureStore` 都是导出符号（N6）。同信任域的任意 JS（OTA、依赖）可以：

```ts
new KeystoreVault({
  storage: AsyncStorage,
  secureStore: expoSecureStore,
  authenticate: async () => "success",
});
```

零弹窗读出全部条目。`noteVerified()` 同样导出可调。修订 1 只说“恶意 JS 可绕过前一步”，未指出边界内的认证本身可以被替换。`capability-boundary.spec.ts` 只扫描 `vault/signer/keygen` 三个目录的 import 黑名单，`embedded-wallet-gateway.ts` 中 `revealMnemonic` 的直通不在覆盖范围。

真正的安全边界必须是原生模块不提供任何导出接口，且不接受 JS 传入的认证结果。这就是第 8 节的目标。

### 4.7 P0：认证既不绑定密钥使用，也不绑定操作（N4、N10、N11、N12）

- **助记词展示复用签名缓存（N4）**。`backup-screen.tsx` → `revealMnemonic` → `decrypt` → `unlock`：若 `cachedWrapKey` 未过期直接返回，不弹认证。用户刚完成一笔转账后手机被短暂拿走，钱包页“未备份”角标一路点进去即可看到完整助记词。这是现状中最直接的 A1 路径。
- **认证强度与 fail-open（N10）**。`app-lock.ts` 的 `authenticate()` 使用 `biometricsSecurityLevel: "weak"`（Class 2）直到连续失败 3 次才升为 strong，`disableDeviceFallback: false` 始终允许设备密码；本地源码核对 expo-local-authentication 的映射为 `BIOMETRIC_WEAK | DEVICE_CREDENTIAL`，且不带 CryptoObject，本质上只是界面门。`isDeviceEnrolled()` 捕获任何异常返回 false → `authenticate` 返回 `unavailable` → vault 与 `useRequireVerification` 均放行。Class 2 生物识别根本不能配 CryptoObject，因此 LocalAuthentication 路径永远只能做 UI 锁，不能承担签名认证。
- **一次认证为后续任意操作背书（N11，源码支持）**。默认偏好 `txVerification: "smart"`、阈值 1000 USD、autoLock 5 分钟；`verifiedWithin` 依赖模块全局 `lastVerifiedAt`，应用锁解锁或任何一次 authenticate 都会写入，与具体操作无关。SIWE 登录路径（`use-session.ts:194` 直接 `wallet.signMessage`）不经 `useRequireVerification`，只剩 vault 自身的解锁缓存；转出页 `send-screen.tsx:340` 传入 `usdValue: usd` 并会触发大额判定，但预测划转 `transfer-form.tsx:112,281`、下单 `order-sheet.tsx:353`、开通 `predict-enable-screen.tsx:167`、兑换 `swap-screen.tsx:219`、争议 `dispute-sheet.tsx:93` 均无参数调用，未知/大额策略对这些路径不生效。`off` 策略加缓存温热 → 全程无认证。修订 1 称之为 TOCTOU 并不准确：JS 单线程没有竞态，问题是环境权限。
- **弹窗文案由调用方与服务端决定（N12）**。`promptMessage: reason` 直传，`reason` 由 gateway 调用者提供并对所有调用者开放；`predict.sign.reason` 与 `wallet.sign.transfer` 两处 reason 是原始 i18n key，不在内置字典中，用户看到的就是这串 key。经 `t()` 的 reason 则来自可被服务端覆盖的字典（4.4）。唯一由 OS 渲染的可信 UI 显示的是任意字符串，且从不包含金额、收款人、链。
- **后台驻留**。`app-lock-gate.tsx` 在进入 `inactive/background` 时只记时间，回到前台且超过自动锁时长才 `lockKeys()`；`lock()` 还要求应用锁已启用、设备已录入、已登录。用户关闭应用锁或设备未录入时，WK 在进程内无限驻留。

目标必须把认证约束绑定到 Keychain/Keystore 的密钥使用、并绑定到单次操作：

- iOS：`SecAccessControl` 使用 `WhenPasscodeSetThisDeviceOnly` + `.userPresence`（或 `.biometryCurrentSet | .or | .devicePasscode`），`kSecUseAuthenticationContext` 把确认 UI 的 `LAContext` 绑到读取，`touchIDAuthenticationAllowableReuseDuration = 0`。参考 [Apple：Accessing keychain items with Face ID or Touch ID](https://developer.apple.com/documentation/localauthentication/accessing-keychain-items-with-face-id-or-touch-id)。
- Android：`setUserAuthenticationParameters(0, BIOMETRIC_STRONG | DEVICE_CREDENTIAL)`（API 30+；28–29 回退 biometric-only 并记录），`setInvalidatedByBiometricEnrollment` 按策略显式决定，`setIsStrongBoxBacked(true)` 并处理 `StrongBoxUnavailableException`，`setUnlockedDeviceRequired(true)`；`BiometricPrompt + CryptoObject` 从确认 Activity 内发起。参考 [KeyGenParameterSpec.Builder](https://developer.android.com/reference/android/security/keystore/KeyGenParameterSpec.Builder.html)。
- 两端：助记词展示、删除、导入使用独立认证，不共享签名缓存；`unavailable` 对真实资金档 fail closed；进入 `inactive/background` 立即失效句柄与明文；`requireConfirmation: true`；弹窗文案由原生按请求类型生成，不接受调用方字符串。
- app-lock 保留 LocalAuthentication 仅作界面锁，代码中不再把它当成签名认证。

### 4.8 助记词经过路由状态、剪贴板、第三方输入法与可跳过的备份验证（N15、N23、N25、N36）

创建钱包后（N36），`wallet-setup-screen.tsx:43` 把 mnemonic 作为 `WalletBackup` navigation 参数；`navigation/types.ts` 把 `phrase?: string` 放入路由契约；`backup-screen.tsx` 再保存到 React state。导入页也把 mnemonic/private key 放在 React state。仓库中不存在导航状态持久化（无 `initialState/onStateChange/persistNavigationState`），也没有 Sentry/Bugsnag/analytics 依赖，因此“落盘”与“遥测误采集”目前是假设性风险；但缺少防回归护栏（例如 ESLint 禁止 `console.*` 输出 `route.params`）。首次展示走的是 `route.params.phrase`（`backup-screen.tsx:84-85`），不经过 `revealMnemonic`，因此不要求任何独立认证；用户刚创建钱包时这与意图一致，但意味着 `WalletBackup` 路由本身就是一条不受认证保护的助记词展示入口。

剪贴板（N23）：expo-clipboard 57 的 `setStringAsync` 只有 `inputFormat` 选项；iOS 实现是 `UIPasteboard.general.string = content`，无 `localOnly/expirationDate`；Android 是 `ClipData.newPlainText` + `setPrimaryClip`，无 `EXTRA_IS_SENSITIVE`。`backup-screen.tsx` 复制后以 60 秒 `setTimeout` 写空串：无 ref、无 cleanup、卸载不取消，也不检查当前内容是否仍是助记词，会清掉用户随后复制的任意内容（例如 60 秒内复制的收款地址）。OEM 剪贴板历史（Gboard、三星）与 iOS Universal Clipboard 在写入瞬间即已同步，清空 primary clip 不删除历史。`walletconnect-sheet.tsx` 允许复制 pairing URI 且完全不清理。参考 [Apple UIPasteboard](https://developer.apple.com/documentation/uikit/uipasteboard/)、[Android Copy and paste](https://developer.android.com/develop/ui/views/touch-and-input/copy-paste) 与 [OWASP iOS Pasteboard](https://mas.owasp.org/MASTG/knowledge/ios/MASVS-STORAGE/MASTG-KNOW-0083/)。

导入页输入框（N15，源码支持）：`wallet-import-screen.tsx` 仅设置 `autoCorrect={false}`、`autoCapitalize="none"`，没有 `autoComplete="off"`、`importantForAutofill="no"`、`textContentType`、`spellCheck={false}`、`keyboardType="visible-password"`、`contextMenuHidden`。第三方输入法可见全部按键并具备网络能力；Gboard/三星词库学习会云同步；iOS QuickType 会学习。截屏保护对此无效。

备份验证（N25）：`shuffle([...12], 7)` 使用固定 seed 的线性同余，每次考同 3 个位置，干扰词同样确定性；错误无次数限制；“稍后备份”可跳过，除钱包页角标外没有任何收款或入金门禁。

上线默认策略：恢复材料不得复制；仅在受保护的原生恢复界面短时显示，离开/后台立即销毁；导入改为逐词输入 + 本地 BIP-39 候选网格，禁用自动填充与学习，检测非系统 IME 时告警；备份验证随机化并限制错误次数，未备份账户对入金与大额设置软门禁。若业务坚持允许复制，应作为明确风险接受项并自写原生模块（iOS `setItems(options: [.localOnly, .expirationDate])`，Android `EXTRA_IS_SENSITIVE`），清理前比对内容。

### 4.9 截图、录屏、任务切换器与 overlay 权限（N16、N24）

`screen-protect.ts` 在敏感页面调用 `preventScreenCaptureAsync`，这是正向基线；但只有 `backup-screen.tsx` 与 `wallet-import-screen.tsx` 两处使用。**未保护**：`walletconnect-sheet.tsx` 的 pairing URI 二维码（被截图或录屏即可完成配对劫持）、登录确认 sheet、转出确认 sheet。机制上 Android `FLAG_SECURE` 由 JS `useEffect` 异步添加，首帧之后才生效，而 `BackupScreen` 在 `phrase` 参数存在时首帧即渲染全部单词，存在竞态；iOS 使用 secure-textfield 层技巧，未调用 `enableAppSwitcherProtectionAsync`，切换器快照会持久化到磁盘。`screen-protect.ts` 吞掉错误，`screen-protect.spec.ts` 把 fail-open 固化为规格。参考 [Expo ScreenCapture](https://docs.expo.dev/versions/latest/sdk/screen-capture/)。

release APK 声明了 `SYSTEM_ALERT_WINDOW`（N16）。来源是 Expo 裸模板的 `AndroidManifest.xml`，prebuild 原样拷入；`app.config.ts` 的 `permissions` 只会追加，移除需要 `android.blockedPermissions`，项目未设置。声明该权限不会让本应用更易被覆盖；真实风险是被劫持的 JS 可引导用户开启“显示在其他应用上层”后，去覆盖**外部钱包的确认页**（配合 4.11），以及触发 Play 政策审查与安全扫描器告警。`android/app/src/debugOptimized/AndroidManifest.xml` 另含 `usesCleartextTraffic=true`，该变体不得发布。

目标控制：`blockedPermissions: ["android.permission.SYSTEM_ALERT_WINDOW"]`；MainActivity 原生常驻 `FLAG_SECURE`（或至少整个钱包流程），根视图 `filterTouchesWhenObscured`，API 31+ `setHideOverlayWindows(true)`；启动即开 app-switcher 保护；`prevent` resolve 后再渲染助记词；保护失败显式告警；E-04 增加 release APK 权限清单 diff。

### 4.10 P0：OTA 更新当前没有端到端真实性，且由服务端静默驱动（N17、N19、N34）

生产 resolved Expo config 存在 OTA URL，但没有 `codeSigningCertificate`。`app.config.ts` 只在环境变量存在时添加代码签名配置，`build-android-release.mjs` 的产物校验也不检查该字段，生产配置没有 fail closed。

服务端 `RN-Server/internal/api/ota.go` 的 SHA-256 检查只证明读取的对象与数据库记录一致；随后 `applyManifestStrategy` 改写 manifest，响应没有 `expo-signature`（全仓库仅 `server.go` 的 CORS 白名单提到 `expo-expect-signature`，服务端从不读取）。`rollBackToEmbedded` 指令同样直接输出。资产 URL 由请求 `Host` 与 `x-forwarded-proto` 派生并在发布时烘焙进 manifest：Host 必须命中活跃租户域名，任意注入被阻断，但租户任一已映射域名都会成为资产源，且代理未设 `x-forwarded-proto` 时会生成 `http://` 资产 URL，客户端对 OTA 资产没有 https 校验。

客户端侧：bootstrap 成功后 `runtime-context.tsx` 静默调用 `checkForUpdateAsync` + `fetchUpdateAsync`（同一配置 key 15 分钟内不重复，`:338`），无用户同意；`next_launch` 下次冷启动自动加载；bootstrap 的 `update.ota.applyStrategy` 优先于 manifest，`immediate` 触发全屏遮罩并 `reloadAsync`。`ON_ERROR_RECOVERY` 由原生拉取并启动，绕过 ADR-0005 的 JS 侧身份校验，且该校验只比对 version/buildNumber，不比对 `scopeKey/apiBaseUrl/applicationId`。

服务端对 `applicationId` 也只校验非空（N34）：`ota.go:530-531` 在 `validateOTAManifestPackage` 里只要求 `extra.applicationId` 存在，`ota.go:416` 随后把 manifest 自带的值原样写回最终 manifest，不与租户配置或基线 APK 比对。修订 2 在 4.1 表中写的“服务端会校验 applicationId”应读作“仅校验存在性”。租户本身由 Host 解析，因此该字段错误不会跨租户，只会让应用发出错误的 `X-Application-ID`，影响有限。

管理端（N17）：浏览器主路径是 `rn_admin_session` cookie + 用户名密码（`server.go:326-345`），RN-Admin 前端只使用该路径；服务端另保留一条自动化旁路，`ADMIN_API_KEY` 配置时只要 `x-admin-key` 匹配且 `x-admin-id` 非空即通过（`server.go:346-352`），审计主体由请求方自报。只有一个 `ADMIN_USERNAME`；publish 只需 `reason` + `confirm`；`ADMIN_COOKIE_SECURE` 默认 false。没有 RBAC、双人审批或按租户的发布权限。修订 2 把 API key 写成唯一认证方式并不准确，但“单账号、弱身份旁路、无双人审批”的结论不变。

平台事实（本地源码核对）：expo-updates 配置证书后，缺少 `expo-signature` 即抛错（`allowUnsignedManifests` 默认 false），directive（含 rollback）同样验签，签名覆盖 manifest part 原字节，asset 由 manifest 内 hash 传递保护；算法仅 `rsa-v1_5-sha256`，keyid 不匹配抛错。`includeManifestResponseCertificateChain` 在原生层支持，但 `@expo/config-plugins` 与 `@expo/config-types` 未暴露，需要自写 config plugin，服务端需输出 `certificate_chain` part。参考 [Expo：Code signing](https://docs.expo.dev/eas-update/code-signing/) 与 [Expo Updates protocol specification](https://docs.expo.dev/technical-specs/expo-updates-1/)。

目标链路必须是：

```text
immutable JS/assets
  -> generate final manifest/directive
  -> apply all tenant/channel/URL rewriting
  -> sign exact final bytes with tenant-scoped private key
  -> emit expo-signature (manifest and directive parts; plain and multipart responses)
  -> client verifies against embedded tenant trust root
  -> load or reject and fall back to embedded bundle
```

禁止在签名后改写任何受签字段。每个生产租户的签名私钥置于独立 KMS/HSM 权限域，构建/发布服务只获得最小签名权限；发布需要真实登录会话、按租户 RBAC、双人审批、不可变审计、撤回和信任根轮换演练；根证书轮换等于原生发版，叶/中间证书轮换可 OTA 但需自定义 plugin。OTA 签名能防传输和发布链中的未授权篡改，不能防签名私钥或已授权发布者本身作恶，所以原生签名器仍必须逐笔验证并展示可信确认 UI。

### 4.11 外部钱包路径：深链、会话存储与 SIWE（N13、N14、N26、N30、N37）

外部钱包是近期真实资产的默认路径，因此它自身的缺口必须先修：

- **自定义 scheme 深链（N13）**。`wallet-deep-links.ts` 使用 `metamask://wc?uri=`、`trust://wc?uri=`、`okx://…`、`okxwallet://…`，`walletconnect-client.ts` 直接 `Linking.openURL`，无 package 绑定。Android 上任何声明同 scheme 的应用都能接收（`<queries>` 只影响探测，不影响路由）。恶意应用注册 `metamask://` 即拿到含 symKey 的 pairing URI，以“钱包”身份完成配对并返回攻击者地址，用户 SIWE 登录到攻击者账户；每次签名前的 `openWallet` 都会把恶意应用拉到前台，正是用户预期钱包确认页出现的时刻。WalletConnect `redirect.native: "anyfun://"` 同样可被抢注。目标：使用各钱包的 Universal/App Links（`https://metamask.app.link/wc?uri=`、`https://link.trustwallet.com/wc?uri=`），Android 用显式 package intent；自身回跳用 `autoVerify` App Links。参考 [Android App Links](https://developer.android.com/training/app-links) 与 [OWASP：Deep links](https://mas.owasp.org/MASTG/knowledge/android/MASVS-PLATFORM/MASTG-KNOW-0021/)。
- **会话密钥明文（N14，源码支持）**。`SignClient.init` 未传 `storage`，`@walletconnect/keyvaluestorage` 的 RN 实现落 AsyncStorage。会话 symKey/topic 可被 root 设备或 iOS 备份提取，攻击者即可以 “AnyFun” 名义向用户钱包推送请求。目标：注入 SecureStore 背书的 storage 适配器；断开时确认 SDK 侧会话清理。
- **SIWE 与会话（N26，源码支持）**。客户端原样签服务端构造的 `challenge.message`，不按 EIP-4361 断言 domain、address、nonce、chainId、expiry；确认 sheet 展示的是本地算的域名与静态文案而非消息内容；`verify()` 用服务端 `response.address` 建会话而不与所签地址比对，`refresh()` 也会无条件用远端地址覆盖本地会话（`http-session-gateway.ts:112-114,160-163`），服务端错误响应即可切换本地身份，后果是签名器按错误地址查找失败，属身份混淆而非资产路径；`chainChanged/accountsChanged` 只在 optionalNamespaces 中声明支持（`walletconnect-connector.ts:258`），全仓库没有任何 `client.on(...)` 监听，`session_delete` 从未出现，钱包侧切链、切账户、断开都不会反映到本地状态；签名请求固定取 `chains[0]`。目标：客户端解析并断言 SIWE 字段后再签；服务端返回地址必须等于所签地址，`refresh()` 不得改写地址；真正监听并处理会话事件；请求携带明确链。
- **EIP-712 载荷（N30，源码支持）**。外部 Adapter 发送的 typed data 为 `JSON.stringify({domain, types, message})`，缺 `primaryType` 与 `EIP712Domain`；主流钱包的 v4 实现要求 primaryType，可能拒签或算出不同哈希。这证明两条 Adapter 目前没有共同的规范化格式（见 8.1）。
- **账户与链建模（N37，源码支持）**。`parseAccounts()` 取第一个 CAIP-10 地址，却把所有账户对应的链合并到该地址上（`walletconnect-connector.ts:133-142`）；`submitTransaction` 原样发送 `transaction.from ?? connection.address`（`:436`），`assertSubmittable` 不检查 `from`；`chainRef(chainId)` 接受调用方任意 chainId（`:353-354`）。后两条由外层兜底：`@walletconnect/sign-client@2.24.0` 的 `Engine.isValidRequest` 会拒绝不在会话 namespaces 内的 chainId，外部钱包也只为自身账户签名。因此这是签名器边界不自校验的纵深防御缺口，不是可利用路径。目标：按 `(address, chain)` 建模会话账户、要求所有批准账户地址一致、signer 内断言 `from === address` 且 chain 属于会话。

残余风险仍包括错误链/地址、钓鱼元数据、盲签、外部钱包自身供应链和 relay 可用性。必须让外部钱包展示最终链、to、value、method 和 typed-data domain；App 自己的预览不能替代钱包确认。WalletConnect Verify API 只提供风险信号。参考 [WalletConnect Verify API](https://docs.walletconnect.network/wallet-sdk/web/verify)。

### 4.12 交易语义策略：calldata、typed data 与授权（N22）

`transaction-guard.ts` 是正向基线：它拒绝缺 nonce/gasLimit/费用的交易，防止 ethers 用默认值签出可重放交易，并按链设置绝对费率红线。但它只覆盖字段完整性与费率：

- `data` 不解码，`to` 任意；费率表仅 4 条链，其余走 10000 Gwei 兜底。
- `signTypedData` 零策略：预测平台开通的 Safe MultiSend 内含 `approve(spender, MAX_UINT256)×4 + setApprovalForAll×3`，`relaySafe` 目标任意，CLOB 订单亦为 typed data；spender/operator 来自运行时下发（4.4）。UI 只显示步骤名，一次 `requireVerification` 后签署全部。
- `signMessage` 接受任意 32 字节 hex，可用于对 EIP-712 摘要或交易哈希伪装成消息的盲签。
- swap 的 approve 步骤对 quote 下发的 `spender` 做 unlimited approve：`swap-screen.tsx:204-216` 在主按钮点击时直接 `approve.mutate`，先于确认弹层（`:215`）与 `requireVerification`（`:219`），后两者只保护随后的 swap 本身。修订 2 写成“swap 路径无确认页、无验证”过宽，准确说法是 approve 步骤无确认无验证（DEX 目前仅 mock gateway，属上线前必须补的设计债）。
- 转出确认页基线良好（4.1），但缺首次收款地址提示与地址簿。

目标：原生签名器内置已知 selector 解码（`transfer/approve/setApprovalForAll/permit/Permit2/Safe execTransaction + MultiSend 展开/CTF 订单域`），spender/operator/verifyingContract 对照编译期白名单；未知 calldata、未知 EIP-712 domain、`{hash: bytes32}` 单字段结构以及 `signMessage` 的裸 hex 在真实资金档默认拒绝，演示档降级为醒目告警。

### 4.13 依赖供应链（N27、N28）

正向基线：`packageManager: pnpm@10.28.1`（pnpm 10 默认阻断依赖生命周期脚本），无 postinstall/prepare 脚本，无 `.npmrc`，lockfile 1230/1230 条 integrity，0 条 tarball/git 依赖，`engines` 限定 node 22–24，CI 使用 `pnpm install --frozen-lockfile`，config plugins 为一方代码。

缺口：`.github/workflows/app-quality.yml` 三个 action 以 tag（`@v4`）而非 commit SHA 固定，无 `permissions:` 块；无 dependency review、JS/Gradle/CocoaPods SCA、SBOM、构建来源证明；`android/build.gradle` 引入 jitpack 且无 `gradle/verification-metadata.xml`；无 `ios/Podfile.lock`（iOS 从未构建）。CI 只执行 `pnpm install --frozen-lockfile`、`pnpm check` 与 expo doctor，从不构建或验证任何 release 产物，因此 N1 这类签名事故在 CI 里没有任何被发现的机会；`android/gradle/wrapper/gradle-wrapper.properties` 无 `distributionSha256Sum`。`pnpm audit --prod --audit-level=high` 因 DNS `EAI_AGAIN` 未完成，结论只能是“漏洞状态未验证”。

远程语言包（N27）：`bootstrap-repository.ts` 校验大小、`x-content-sha256` 头与 SHA-256，但期望 hash 来自同一份未签名 bootstrap，语言包也走同源 `apiClient`。这是“与指针一致”的完整性，不是真实性；ADR-0002 的措辞会误导为已防篡改。远程串覆盖内置串并流入生物识别弹窗与转出页文案（4.4、4.7）。语言包 schema 含 `tenantId`（`bootstrap-repository.ts:23`），但 `applyRemoteLanguagePackage` 只比对 `languageCode` 与 `version`，从不与当前租户比对；缓存键含 apiBaseUrl 与 applicationId，跨租户误用的窗口有限，但字段既已存在就应校验。

参考 [OWASP build-time SCA](https://mas.owasp.org/MASTG/tests/android/MASVS-CODE/MASTG-TEST-0272/)、[GitHub dependency review](https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/reviewing-dependency-changes-in-a-pull-request) 与 [Gradle dependency verification](https://docs.gradle.org/current/userguide/dependency_verification.html)。

## 5. 备份、设备迁移与卸载重装

### 5.1 当前语义

- Android 当前 APK 的 `allowBackup=false` 与 `dataExtractionRules` 已由 `aapt` 证实。Expo SecureStore 配置生成的 backup 规则也排除其 SharedPreferences。
- Android 12+ 允许 OEM 对 device-to-device transfer 采用不同策略，`allowBackup=false` 不能替代 `dataExtractionRules` 和 OEM 真机实验。参考 [Android Auto Backup](https://developer.android.com/identity/data/autobackup) 与 [Android 12 behavior changes](https://developer.android.com/about/versions/12/behavior-changes-12)。
- iOS `ThisDeviceOnly` wrapping key 不应迁移到另一台设备；即使密文被备份，目标设备也应 fail closed。另一方面，iOS Keychain 项可能在同 bundle ID 卸载重装后继续存在。
- **现状与目标相反（N8）**：目标设备上只有密文、没有 WK 时，当前代码会静默铸新 WK，把不可解的旧条目继续列为账户；预测凭证有 `INSTALL_MARKER_KEY` 检测重装并清理，钱包 vault 没有等价的 generation marker。
- Android 生物信息变更：一旦 WK 改为 `requireAuthentication`，现有库会在密钥失效时静默返回 null 并清空整个 keychainService；叠加 N8 即“换一枚指纹 = 钱包丢失”。这必须在迁移前决定 `setInvalidatedByBiometricEnrollment` 策略（见 8.5）。

### 5.2 必须形成产品契约

1. **换新设备**：不自动迁移本地 EOA 私钥。用户通过已验证助记词、外部钱包或智能账户恢复流程重新获得控制权；只有密文没有密钥时必须明确提示“需从备份恢复”，不能生成新 key 后误认成原账户。
2. **同设备重装**：用安装 generation marker 检测全新安装；清理不匹配的 tenant/service/key generation 孤儿项，不能把旧 Keychain 内容静默关联给新的本地用户。
3. **设备丢失**：本地 EOA 只能依赖用户持有的恢复材料；如果产品不能接受这种丢失语义，应选择外部钱包、MPC 或智能账户恢复，而不是降低本地密钥保护。
4. **生物信息变更 / 移除密码**：明确策略并告知用户。iOS `WhenPasscodeSetThisDeviceOnly` 条目在移除密码时被系统删除；Android 是否随录入变更失效由 `setInvalidatedByBiometricEnrollment` 决定。任何失效都必须表现为可见的恢复流程，而不是静默替换。
5. **迁移提示**：在旧设备仍可用时先验证恢复能力，再允许用户执行销毁。日志只记录结果与 generation ID，不记录地址之外的恢复材料。
6. **签名密钥更换（N1 的后果）**：从 debug 密钥切换到生产密钥时，Android 不允许覆盖安装。产品必须提供“备份 → 卸载 → 安装新版 → 恢复”的引导，并在旧版本内以强制提示告知。

## 6. 删除语义：当前不完整

产品和代码必须区分四个动作：

| 动作                 | 会话                   | 本地钱包密钥                               | 远端账户/会话                   | 用户可见承诺                 |
| -------------------- | ---------------------- | ------------------------------------------ | ------------------------------- | ---------------------------- |
| Disconnect 外部钱包  | 断开 connector/session | 不适用；不得影响嵌入式钱包                 | 撤销对应 WalletConnect 会话     | “断开连接”，不是删除账户     |
| Sign out             | 清认证与业务缓存       | 当前实现明确保留嵌入式 key                 | 撤销 session/predict credential | 必须明确“钱包仍保存在此设备” |
| Delete local account | 清指定账户             | 必须销毁该账户密钥材料并验证不可签名       | 注销该账户关联/会话             | 指定钱包在本设备不可恢复     |
| Wipe app vault       | 清全部钱包             | 销毁 tenant vault 根或所有 per-account key | 撤销全部关联会话                | 不可逆，要求强认证和明确确认 |

当前 `EmbeddedWalletGateway.disconnect()` 明确保留嵌入式 key；`use-session.ts` 登出不调用 vault 删除；gateway 没有暴露生产删除接口。`keystore-vault.ts` 虽有 `remove()`/`wipeAll()`，两者都不要求认证，现有生产 UI 未形成可验证工作流；结合 N6，恶意 JS 可直接构造 vault 无声销毁未备份的密钥。

`remove()` 只重写 AsyncStorage 中的 vault JSON。AsyncStorage 的 SQLite/WAL/free page 可能保留已删除密文；SQLite 的 `secure_delete` 默认通常关闭。参考 [SQLite PRAGMA secure_delete](https://www.sqlite.org/pragma.html#pragma_secure_delete)。更关键的是，当前所有账户由仍存在的共同 WK 派生保护：若恢复了已删账户的密文与 salt，该共同 key 仍可能解密它。因此逐条删除不能只依赖数据库物理覆盖。

目标删除策略：

- 若只需要“一键清空所有本地钱包”，KISS 方案是删除 vault 根 wrapping key，并验证再次读取/解密失败；密文随后异步清理。根 key 销毁构成密码学擦除。
- 若业务确实需要逐账户删除，则每账户必须拥有独立 native key alias/material；删除时先删除 Keychain/Keystore 项并检查返回值，再清密文、registry、会话和缓存，最后用已恢复的旧密文做负向解密验证。
- 删除 API 返回不含秘密的 `DeletionReceipt`，步骤幂等；在 native delete 与验证完成前不能向用户显示成功；删除本身要求独立认证。
- 外部账户的 lifecycle（WalletConnect 会话清理、registry 元数据）纳入同一 `WalletLifecycle`，避免孤儿会话（N29）。
- iOS 使用 `SecItemDelete` 并校验结果，参考 [Apple SecItemDelete](<https://developer.apple.com/documentation/security/secitemdelete(_:)>)。卸载应用不是调用该 API，所以产品不得宣称“卸载即删除钱包”。

## 7. 以最常见调用者为中心的方案比较

最常见调用者是日常签名路径：登录/SIWE、Predict、DEX/send、typed data 和交易。它们只需要“对一个已验证的规范化请求签名”，不需要读取私钥、导出助记词、理解 Keychain/Keystore，也不应拥有删除和恢复权限。

| 方案 / Adapter                      | 秘密进入 RN JS                    | 离线签名               | 恢复模型                               | 新可信依赖                           | 对现有链/EOA 兼容             | 当前可执行性                     | 建议                           |
| ----------------------------------- | --------------------------------- | ---------------------- | -------------------------------------- | ------------------------------------ | ----------------------------- | -------------------------------- | ------------------------------ |
| 外部钱包 / `ExternalWalletAdapter`  | 否；但 pairing/session URI 仍敏感 | 取决于外部钱包         | 由外部钱包负责                         | 钱包 App、WalletConnect relay/SDK    | 高                            | 中：已有实现，缺深链加固与双端 E2E | 真实资产近期默认               |
| 原生本地钱包 / `NativeVaultAdapter` | 目标态否；当前实现是              | 是                     | 用户离线助记词；需高风险导出流程       | 自有 iOS/Android native 模块         | 高；继续 secp256k1 EOA        | 当前低，完成 P0 后中高           | 可选高级能力                   |
| MPC/TSS / `MpcSignerAdapter`        | 不应有完整 key                    | 通常否或受限           | 服务端/vendor 参与 resharing/recovery  | MPC 服务、在线 SLA、管理与合规       | 取决于 vendor/协议            | 低：当前无基础设施               | 暂不实施；有明确托管需求再 ADR |
| 智能账户 / `SmartAccountAdapter`    | P-256/passkey key 可不进入 JS     | 视 signer/bundler 设计 | passkey 同步、guardian/social recovery | 合约、bundler、paymaster、索引与审计 | 需逐链部署；服务端需 ERC-1271 | 低：非 drop-in                   | 单目标链试点                   |

### 7.1 外部钱包

优势是把密钥生成、存储和签名移出本 App 进程；一次被签名的 RN OTA 不能直接读取外部钱包私钥。现有 WalletConnect connector 已覆盖 session 恢复、链声明、消息/typed-data/交易请求，但未监听任何会话事件（N26、N37）。对抗验证表明它上线前必须先修复 4.11 的五个缺口（自定义 scheme 深链、会话密钥明文、SIWE 客户端零校验、EIP-712 载荷不规范、账户/链建模与事件监听），否则它把信任转移给外部钱包的同时又自带一条钓鱼与冒用通道。

残余风险包括错误链/地址、钓鱼元数据、盲签、pairing URI 泄漏、外部钱包自身供应链和 relay 可用性。必须让外部钱包展示最终链、to、value、method 和 typed-data domain；App 自己的预览不能替代钱包确认。WalletConnect Verify API 可给钱包提供 `VALID/INVALID/UNKNOWN` 域信号，是风险信号而非绝对真伪证明。

### 7.2 原生本地钱包

**平台事实修正**：iOS Secure Enclave 和 Android Keystore 不能生成或持有跨 EVM 通用的 secp256k1 非导出签名密钥（它们只支持 P-256/EC）。因此“由 Keychain/Keystore 约束的密钥执行签名”对 secp256k1 不成立。可执行目标是：硬件保护一个需用户认证的对称包装密钥或 RSA/EC 包裹密钥，把 secp256k1 私钥的解密和签名限制在短生命周期 native 缓冲区，不通过 TurboModule/JSI/Promise 返回秘密。JVM 上 `Cipher.doFinal` 必然产生一份 `byte[]` 副本，ART 是移动式 GC，`fill(0)` 只是尽力；因此“限制在短生命周期 native 内存”应表述为“JS 堆内不出现，native 层尽力清零”，不是绝对保证。硬件级别必须在运行时用 `KeyInfo`/attestation 取证；不支持时按资产等级降级或阻断。

原生化降低 JS heap 和普通 OTA 直接导出的风险，但不是自动安全：如果 native Interface 允许任意 bytes 静默签名，恶意 JS 仍可诱导签名。因此 native 模块必须验证链/账户/方法/金额策略与 calldata 语义（4.12），并用独立原生窗口展示规范化请求，在用户认证后才签名。

### 7.3 智能账户与 P-256/passkey

P-256 与 Apple Secure Enclave、Android Keystore、FIDO/passkey 生态更匹配，是**唯一密钥真正不可导出**的路线；EIP-7951 的 P-256 precompile 目标包含这些平台签名器，但目标链是否部署/启用必须逐链验证。参考 [EIP-7951](https://eips.ethereum.org/EIPS/eip-7951)。

ERC-4337 引入 UserOperation、EntryPoint、bundler/paymaster；签名包含链和 EntryPoint 域，有利于智能账户策略，但增加合约与基础设施风险。参考 [EIP-4337](https://eips.ethereum.org/EIPS/eip-4337)。现有后端验证若只接受 EOA 恢复地址，必须增加 ERC-1271 `isValidSignature` 合约签名验证，参考 [EIP-1271](https://eips.ethereum.org/EIPS/eip-1271)。因此该方案必须以“一条目标链 + 一个经审计 account implementation + 一套恢复/故障实验”试点，不与当前 EOA 本地钱包重构捆绑交付。

### 7.4 MPC/TSS

MPC 能避免任一参与方单独持有完整私钥，也可提供受控恢复；但会引入设备 share + 服务 share 串谋、认证 resharing、服务中断、管理员越权、地域合规、供应商退出和密钥轮换问题。若没有明确的托管/恢复 SLA，它违背 YAGNI，并不能仅凭“MPC”名称消除 JS 请求欺骗和供应链风险。立项前至少需要独立 ADR 明确参与方与门限、share 生成/备份/恢复、设备更换、服务端 HSM/KMS、串谋边界、离线能力、出口与灾备、审计/保险/监管责任。本文不为尚不存在的 MPC Adapter 预留代码层。

### 7.5 三套 Interface 设计的对抗比较

| 设计                               | 核心 Interface                                    | 最强点                                              | 红队反例 / 成本                                                                       | 判定                                 |
| ---------------------------------- | ------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------ |
| A：最小原生 signer                 | `provision`、`authorizeAndSign`、`manage`         | 接口最窄；secret 不进入 JS；适合 EOA 和离线签名     | 仍需双端 native secp256k1、可信确认 UI、迁移和真机实验；原生进程完全失陷仍可 Hook     | **目标架构主体**                     |
| B：通用原生 `PolicyVault`          | `posture`、`prepare`、`execute`、`cancel`、`lock` | 可表达 digest 绑定、单次执行、风险升级和设备姿态    | 若金额、tenant、auth mode 或风险等级来自 JS，就会成为可绕过的浅层策略框架；实现面最大 | 只吸收必要不变量，不建设万能策略引擎 |
| C：外部钱包默认，智能账户/MPC 后置 | 统一公开账户和规范化签名请求，由不同 Adapter 执行 | 最快把完整私钥移出本 App；现有 WalletConnect 可复用 | 把信任转移给钱包/relay/用户确认；仍有盲签、配对 URI、错链风险；MPC/AA 不是 drop-in    | **近期生产默认**，MPC 暂不实现       |

最终选择是“C 立即收敛风险 + A 作为本地钱包目标”，并从 B 仅吸收四个不能省略的不变量：native policy floor、不可变 request digest、single-flight/one-shot execution、后台立即失效。没有真实第二种策略消费者前，不引入通用规则 DSL、动态 provider registry 或服务端可下调的政策，符合 KISS/YAGNI；签名、恢复、删除保持窄 Interface，符合 Interface Segregation。

## 8. 目标模块设计：Interface / Adapter / Depth / Locality

### 8.1 Seam 与 Interface

在最常见调用者和平台/钱包实现之间建立一个 `WalletSigner` Module：

```ts
type SignRequest =
  | { kind: "siwe"; accountId: string; chainId: string; siwe: CanonicalSiweFields }
  | { kind: "typedData"; accountId: string; chainId: string; typedData: CanonicalTypedData }
  | { kind: "transaction"; accountId: string; chainId: string; tx: CanonicalTransaction };

interface WalletSigner {
  getPublicAccount(): Promise<PublicAccount>;
  authorizeAndSign(request: SignRequest): Promise<{
    requestHash: string;
    signature?: string;
    signedTransaction?: string;
  }>;
}
```

`WalletSigner` 的 Interface 是安全边界和主要测试面。它明确不提供 `getPrivateKey()`、`revealMnemonic()`、接收 key 的 callback、任意字节盲签或租户字符串，也不接受 JS 传入的认证结果。对 `NativeVaultAdapter`，schema 校验、canonicalization、账户/链/方法/金额政策、可信摘要展示、系统认证和签名必须在同一个 native operation 内完成；JS 预览只能改善体验，不能成为安全输入。返回的 `requestHash` 用于把预览、审计和签名结果关联起来，但不得允许调用方提交一个裸 hash 要求盲签。

对抗验证补充的关键决策（修订 1 未定）：

- **`CanonicalTypedData` 采用 EIP-712 v4 JSON 形态**（含 `primaryType` 与 `EIP712Domain`），这样 External Adapter 可直传主流钱包（同时修复 N30），Native Adapter 也按同一结构做原生 hashStruct，两条 Adapter 共用一个规范化格式。
- **`kind: "siwe"` 传结构化字段而非整串**：当前服务端下发整串 `challenge.message`，客户端不解析。必须决定由服务端改发字段、或由客户端解析 EIP-4361 并做域绑定后再交给签名器（4.11、N26）。
- **`CanonicalTransaction.data` 任意即等于盲签**：必须配套一个原生解码器集合与地址白名单策略（4.12），并明确 typed data 中 `{hash: bytes32}` 单字段结构等价裸 hash，一并拒绝。

恢复与删除不是日常调用者职责，拆成更窄、只由专门流程持有的 Interface：

```ts
interface WalletRecovery {
  exportRecovery(accountId: string, ceremony: RecoveryCeremony): Promise<RecoveryDisplayHandle>;
}
interface WalletLifecycle {
  deleteAccount(accountId: string, ceremony: DestructiveCeremony): Promise<DeletionReceipt>;
  wipeTenantVault(ceremony: DestructiveCeremony): Promise<DeletionReceipt>;
  disconnectExternal(accountId: string): Promise<void>;
}
```

`RecoveryDisplayHandle` 只能驱动 native 保护视图，不返回 JS mnemonic。`RecoveryCeremony`/`DestructiveCeremony`/`DeletionReceipt` 的具体形态（认证等级、二次确认、幂等 token、审计字段）需在阶段 1 定稿，修订 1 只给了名字。

### 8.2 Adapter

- `ExternalWalletAdapter`：把规范化请求映射到 WalletConnect provider/session，并承担深链加固与会话安全存储。
- `NativeVaultAdapter`：把同一请求映射到 iOS/Android native signer 和可信确认流程。
- `InMemorySignerAdapter`：仅测试环境，使用固定测试 key，生产构建树摇/编译阻断，并替换 `gateway-context.tsx` 中硬编码的 `mode: "mock"`（N32）作为真正的演示/真实隔离标记。

只有当智能账户试点或 MPC 被正式批准并有真实第二端点时，才增加对应 Adapter。不要提前创建空的 `MpcSignerAdapter` 或万能 provider registry。

### 8.3 Depth

这是一个应当很深的 Module：小 Interface 后隐藏平台 ACL、硬件等级、用户认证、native 内存生命周期、链规范化、重放域、WalletConnect session、错误归一化和审计结果。删除该 Module 会迫使每个 DEX/send/SIWE/Predict 调用者分别理解这些细节，造成安全策略分散。对外只暴露少量稳定结果；不能把 `SecureStore` options、Keychain status、Keystore alias、WalletConnect topic、MPC share 等 Implementation 细节泄漏到业务层。

### 8.4 Locality

- secret 生命周期、平台认证、确认 UI 和删除验证与 native Adapter 共址；涉及同一安全决策的代码、测试和策略放在一个目录/原生 package。
- navigation 只接收 account ID 和流程结果，不承载 mnemonic/private key。
- OTA、tenant 和 build 配置只生成原生只读身份；业务 feature 不拼接 key alias 或选择信任根，也不拼接合约地址（4.4）。
- signer policy、canonical transaction renderer、audit redaction 的更改在一个 Module 内即可完成。

### 8.5 v1 → per-account 迁移（修订 1 遗漏的设计）

现状 v1：单个 WK 存 SecureStore `foundation.wallet.wrap-key.v1`（`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`，无 requireAuthentication），密文在 AsyncStorage `foundation.wallet.vault.v1`，entryKey = HKDF(WK, salt)。目标 v2：per-account native alias 或“租户级认证 key + per-account HKDF”。迁移必须原子、可断点续跑、崩溃安全，且在提交前绝不修改 v1。状态机：

1. `detect`：v1 存在且 v2 缺失才进入；v1+v2 并存只做收尾删除。
2. `begin`：native 在私有目录写 `{state:"migrating", done:[]}`，临时文件 rename 保证原子。
3. `read-legacy`：**决策 A（待定）**——native 直接按 expo-secure-store 内部格式读旧 WK（秘密不再过 JS，但耦合库内部布局），或 JS 最后一次读 WK+密文交给 native `importLegacy()`。
4. `re-wrap`：逐条解密、校验地址、按新 alias 加密。**决策 C（待定）**——Android 若用按-use 认证的对称 key，连加密都要弹认证（N 账户 N 次弹窗），可改用 RSA-OAEP 非对称包裹（公钥加密免认证、私钥解密需认证）或“租户级单一认证 key + per-account HKDF”。iOS 写入不弹认证，无此问题。
5. `verify`：内层 GCM 往返 + 地址一致；外层认证只在迁移末做一次。
6. `commit`：v2 置 `state:"ready"`，原子 rename。
7. `cleanup`：删除旧 WK item 与 AsyncStorage key；崩溃后凭 tombstone 重入。
8. 前置：必须先修 N7（损坏不覆盖、覆盖前备份）与 N8（缺 WK 报恢复而非铸新）；迁移完成后提升 `runtimeVersion` 并配合 OTA 签名，禁止回滚到会清空 v2 的旧 JS。

待定决策还包括：录入变更策略（`setInvalidatedByBiometricEnrollment` / iOS `.userPresence` 而非 `.biometryCurrentSet`，否则 v2 重演“换指纹丢钱包”）、iOS 移除密码时 `WhenPasscodeSetThisDeviceOnly` 条目被删的用户告知、v2 按 wallet(seed) 还是按 account 存储、多租户 alias 前缀变更后仍能读旧默认 alias。

## 9. 多租户隔离是原生信任域，不是 JS 参数

每个上架租户必须是独立应用身份和独立发布/密钥域：

| 层               | 每租户必须独立                                                                                           | 门禁                                                 |
| ---------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| iOS 应用身份     | bundle ID、App ID/entitlements、签名/provisioning                                                        | 构建产物解析值与 `tenant.json` 一致                  |
| Android 应用身份 | **applicationId/package name、独立签名 key（非 debug、非共享）、Play app**                                | APK/AAB manifest 与 `signerSha256` 取证；默认构建包名不得等于任何生产租户；`check-build-profiles.mjs` 跨租户唯一性检查（当前无） |
| 本地秘密         | 显式 SecureStore `keychainService`、iOS access group（如使用）、Android Keystore alias、vault generation | alias/service 含编译期 tenant identity               |
| 合约与平台事实   | **每链 `PlatformContracts`、平台域名、chainId 编译期固化**                                                | `public-info` 返回值与之一致，否则拒绝开通           |
| OTA              | 客户端嵌入的 trust root/certificate、签名私钥、channel/runtime namespace                                 | A 签名更新在 B 客户端必须失败                        |
| 服务端发布       | tenant release namespace、KMS/HSM key、按租户 RBAC、双人审批与审计                                        | 发布角色只能调用所属 tenant key                      |
| 缓存/深链/API    | URL scheme/universal link/app link、缓存和 installation namespace                                        | 双应用同机互不覆盖、深链不串租户                     |

**平台事实修正**：iOS 的租户隔离在“不同 Bundle ID 且无共享 access group”时已经成立（默认 access group = `TeamID.bundleId`），per-tenant `keychainService` 是纵深防御而非边界；修订 1 “A 能读取 B”的表述被夸大。当前真正被违反的是 Android 侧“独立签名密钥”与“默认构建包名不等于生产租户”（N1、N20）。服务端租户解析已按 `Host` 进行（编译期 API origin），`x-application-id` 不参与，因此租户路由不是 JS 参数问题，缺的是签名与产物身份。

禁止把 `tenant`、合约地址或信任根仅作为运行时 JS/JSON 参数下发给同一个 vault、Keystore alias、OTA 验证器或授权流程。建议生成不可变的 `TenantWalletIdentity` 原生常量：

```text
bundleOrPackageId
apkSignerSha256                    // 服务端 pin、客户端自更新校验
secureStoreService / keystoreAliasPrefix
otaTrustRootFingerprint
otaSigningKeyId                    // server-side reference only
platformContractsByChain          // spender/operator/verifyingContract 白名单
vaultGeneration
```

OTA 私钥与 APK 签名私钥永不进入 App、`.env`、tenant config 或 JS bundle。租户 A/B 同机交叉读取、交叉签名、交叉 OTA、交叉合约授权必须成为每次生产构建的自动负向测试。

## 10. 平台目标控制

### 10.1 iOS Adapter

- wrapping key 使用 Keychain `WhenPasscodeSetThisDeviceOnly` + `.userPresence`（或 `.biometryCurrentSet | .or | .devicePasscode`），由系统在读取/使用时要求 Face ID、Touch ID 或设备密码；`kSecUseAuthenticationContext` 把确认窗口的 `LAContext` 绑到读取，`reuseDuration = 0`。现有 expo-secure-store 硬编码 `.biometryCurrentSet` 无法满足，需自定义 Expo Module（附录 A）。
- 原生模块内 CryptoKit AES-GCM 解包 + libsecp256k1 签名，使用可变 buffer 与 `memset_s` 清零；不桥接秘密字符串。
- 进入 inactive/background 立即清 handle 和明文；不保留跨后台认证窗口。
- 恢复材料只进入独立 `UIWindow`（level > .alert）的原生保护视图；启用 screen capture 和 app-switcher protection，离开立即销毁。
- 用安装 generation 清理同 bundle ID 重装后的孤儿 Keychain 项；迁移到另一设备必须 fail closed；移除密码导致条目被删时明确告知用户。
- App Attest 可让服务端评估请求是否来自真实 App 实例，由服务端验证，key 在重装/备份/迁移后不存续；它是风险信号，不是钱包 vault。参考 [Apple App Attest](https://developer.apple.com/documentation/devicecheck/establishing-your-app-s-integrity)。

### 10.2 Android Adapter

- 自定义模块用 Keystore 生成 per-account key，`setUserAuthenticationRequired(true)` + `setUserAuthenticationParameters(0, BIOMETRIC_STRONG | DEVICE_CREDENTIAL)`（API 30+；28–29 回退 biometric-only 并记录），覆盖 PIN-only 设备。现有 expo-secure-store 只请求 `BIOMETRIC_STRONG`、PIN-only 抛错、无 StrongBox，需替换。
- 优先 StrongBox；不可用时读取 `KeyInfo` 确认 TEE/软件级，并按资产等级决定降级提示或阻断。不能因请求 StrongBox 就宣称已获得 StrongBox。
- 明确 `setInvalidatedByBiometricEnrollment` 策略并处理 `KeyPermanentlyInvalidatedException`、`UserNotAuthenticatedException`；密钥失效走可见恢复流程，不自动静默生成新 key 覆盖旧钱包（修复 N8）。
- native 内存完成 secp256k1 解密/签名（JVM 侧承认瞬时 `byte[]` 副本，尽力清零）；后台立即失效；可信确认页放在独立 Activity（`FLAG_SECURE`、API 31+ `setHideOverlayWindows(true)`、`filterTouchesWhenObscured`、`excludeFromRecents`），BiometricPrompt + CryptoObject 从该 Activity 内发起。
- 保持 `allowBackup=false` 与明确的 `dataExtractionRules`；用 `blockedPermissions` 移除 `SYSTEM_ALERT_WINDOW`；分别验证 Android 11 cloud backup、Android 12+ cloud/D2D、至少一个 OEM 迁移。
- Play Integrity 由服务端用于风险分层，不能替代 Keystore 或直接把单一 verdict 当封禁真相。参考 [Google Play Integrity](https://developer.android.com/google/play/integrity/overview)。

### 10.3 可信确认 UI 的最小不变量

无论 iOS/Android，独立原生窗口必须满足：(1) 严格 schema，未知字段拒绝；(2) 展示的摘要与签名的 digest 来自同一份 native 解析对象；(3) 链名/代币小数/符号来自 native 表，金额与 EIP-55 校验和 native 计算，已知 selector native 解码，其余显示“合约调用 + selector + data 长度”；(4) JS 字符串（reason、dapp 名）不展示或放在标注“未验证”的截断框并过滤 RTL/零宽/同形字；(5) single-flight + 限频 + 超时，抵御请求疲劳；(6) 不向 JS 暴露 cancel/approve/dismiss；(7) 只返回签名；(8) 审计记录 requestHash。

### 10.4 root/jailbreak/完整性信号（N31）

当前没有任何 root/越狱/调试/emulator 检测，连威胁模型 A3 要求的“风险信号”都不存在。目标：接入 Play Integrity / App Attest 作为服务端侧风险信号，支持灰度、观测与申诉；客户端可选轻量 root 提示。明确这是信号而非密钥安全保证。

## 11. 可复现实验计划

每个实验都必须保存：源码 commit、tenant、app version/build/runtime、设备型号/OS、安全硬件等级、步骤、原始日志/截图/视频、预期和实际结果。真实助记词/私钥不得进入证据系统，只使用明确的测试资产。

| ID   | 攻击假设与步骤                                                                                                 | 当前预期                                             | 目标通过条件                                                         | 证据环境                         |
| ---- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------- |
| E-01 | 运行第 4.1 节 focused tests                                                                                    | 5 suite / 31 test 通过                              | 持续回归；测试名称明确区分“允许行为”和“安全拒绝”                     | 已验证，本机                     |
| E-02 | `withPrivateKey(key => key)` 原样返回；构造 `new KeystoreVault({authenticate: async()=>"success"})` 读全部密钥；再由测试依赖发起外传 canary | 当前均可 | 生产 Interface 无返回/回调秘密路径，认证不可注入，编译与运行负测均失败 | 第一段已验证；目标待实现         |
| E-03 | 解析每租户 production Expo config，检查证书；代理篡改 manifest/asset/directive；缺 https 的资产 URL              | 当前无证书、无签名                                    | 缺失/错误/跨租户签名、rollback、未签 directive 全部拒绝并回落 embedded bundle | 配置已验证；MITM 待真机构建      |
| E-04 | 检查每个 release APK 的 `signerSha256` 与权限清单 diff；替换对象存储中同大小 APK 后经公开下载接口拉取           | 当前为公开 debug key、含 SYSTEM_ALERT_WINDOW；对象替换不被发现（N33） | 签名者 = 租户 pin 的生产密钥；权限清单符合设计；每产物取证；服务端下载校验对象 hash | 已验证当前为 debug key（反例）    |
| E-05 | 不先做 JS LocalAuthentication，直接调用 native sign；PIN-only、生物变更、移除密码分别执行                      | 当前 vault 可被 JS 直接调用且认证可注入              | 系统层拒绝；PIN-only 按策略可用；变更后显式恢复而非静默换 key        | iPhone + Android 真机            |
| E-06 | 签名一次后后台 10 秒再签/读 handle；关闭应用锁后测同项                                                          | 当前包装 key 仍缓存且可无限驻留                       | 进入 inactive 即清理，回前台再次用户认证；reveal 不复用签名缓存      | 双平台真机                       |
| E-07 | 测试 build 在 sign/recovery 后用 Instruments/LLDB 与 Frida/rooted lab 搜索 canary key，触发 GC、后台、崩溃    | JS heap 可见字符串与根种子                            | JS heap 永不出现；native buffer 仅在界定窗口出现                     | 越狱/root 实验机；不外推绝对安全 |
| E-08 | iOS Universal Clipboard 第二设备读取；Android 13/14 第二 App/系统预览与剪贴板历史读取 seed 与 pairing URI；第三方 IME 抓取导入 | 当前 seed/pairing URI 可进入全局 clipboard 与 IME | seed 无复制入口、逐词输入禁学习；例外路径按平台设置过期/敏感         | 双设备/第二测试 App/第三方 IME   |
| E-09 | 截图、录屏、后台任务卡片（含 WC 二维码页、登录/转出确认页）；FLAG_SECURE 首帧竞态；进程杀死和错误注入          | 当前仅两页保护、无 app-switcher 保护、首帧竞态        | 支持矩阵全部符合设计，失败不可静默                                   | 真机 OS 矩阵                     |
| E-10 | Android `bmgr` cloud restore、Android 12+ OEM D2D；iOS encrypted backup、同机重装、新机 restore；生物变更/移除密码 | 静态推断 fail closed，未实测；WK 丢失会静默铸新 | 新机无 silent key；同机 orphan 可清；密钥失效走恢复而非铸新；用户恢复路径可完成 | Android 11/12+/OEM、iOS 两设备   |
| E-11 | 创建已知测试账户，逐账户删除；导出 SQLite/WAL/free page 与旧密文，尝试解密/签名；损坏 vault 文件观察是否被覆盖  | 当前可能恢复密文且共同 WK 仍在；损坏文件会被清空覆盖  | per-account key 删除后旧密文不可解；全 wipe 删根 key；损坏不覆盖；receipt 准确 | rooted 测试机 + iOS dev device   |
| E-12 | 修改 CDN/源站/DB manifest，签名后再改 URL；用 A tenant 包加载 B tenant update；未签 directive；演练 root rotation | 当前 hash 不是客户端认证                              | 所有篡改和跨租户更新、未签 directive 被拒；合法轮换成功且可回滚      | 自托管 OTA staging               |
| E-13 | 篡改 bootstrap：换 RPC、换平台域名（换合约地址）、下发 immediate 更新、替换生物识别文案；观察是否需用户交互与是否被拒 | 当前 bootstrap 未签名，合约地址运行时采纳            | 安全相关字段被拒或需签名；合约地址与固化白名单不符即拒绝开通；文案只用内置串 | 自托管 API staging               |
| E-14 | 在测试依赖中加入调用 signer/export/自更新的 canary；对 lockfile、Gradle、Pods、Actions 运行 SCA/SBOM          | 当前静态测试不足，audit 未完成                        | 依赖不能取 secret 或触发安装；high/critical 阻断；SBOM/provenance 绑定 artifact | CI 隔离环境                      |
| E-15 | 恶意应用注册 `metamask://`/`trust://`/`anyfun://` 抢配对 URI 与回跳；篡改 APK 下载源投递同 versionCode 包       | 当前自定义 scheme 无绑定、APK 不校验 sha256/签名者    | 深链走 App Link/显式 package；APK 安装前校验 sha256 与签名者证书     | 双真机 + 恶意测试 App            |
| E-16 | MetaMask/OKX/Trust 在 iOS/Android：首次配对、冷启动恢复、拒绝、过期、错链、恶意元数据、relay 故障、SIWE 字段篡改；多账户/多链会话；钱包侧切链、切账户、断开；服务端 `verify/session` 返回异地址 | 实现存在，完整真实钱包流程未验证；SIWE 客户端不校验；会话事件未监听；`refresh()` 接受地址改写 | 钱包显示规范化请求；错链/域/过期/地址不符 fail closed；无 pairing URI 泄漏；会话密钥不落明文；会话事件被处理；本地地址不被服务端改写 | 至少 2 iOS + 2 Android 钱包      |
| E-17 | 双租户 App 同机创建账户，枚举 service/alias，交叉读、交叉删除、交叉 OTA、交叉合约授权                          | 当前只有 anyfun 产物证据，且包名 = 默认构建           | 包/bundle、签名者、key namespace、trust root、KMS 权限、合约白名单全部隔离 | A/B production-like builds       |
| E-18 | 智能账户试点：ERC-1271 登录、UserOperation replay、bundler/paymaster 故障、guardian recovery                   | 未实现                                               | 单链合约审计通过；故障可恢复；跨链/EntryPoint 重放失败               | 专用 testnet/staging             |

真机测试前不得关闭 E-05 至 E-11。Expo 也明确指出模拟器对认证 SecureStore 的执行不同，必须使用真实设备。最低真机矩阵：Android 至少覆盖 API 24/29、30、34、36，包含 StrongBox、TEE、PIN-only/Class 2 和 root 实验设备，逐台记录 `KeyInfo.getSecurityLevel()`、认证是否由安全硬件执行、StrongBox 请求结果和 key invalidation 异常；iOS 至少覆盖 Face ID、Touch ID、PIN-only、最低支持版本与当前稳定版本，验证新增/删除生物信息、移除密码、重启、后台、卸载重装和跨设备恢复。设备型号只用于追踪，验收依据是运行时取证结果。

## 12. 上线门禁

### 12.1 P0：阻断真实资产发布，并阻断当前 Android 直发产物

- [ ] **（N1/N18/N20）生产签名密钥由 KMS/HSM 或 Play App Signing 托管**；release signingConfig 由 config plugin/构建期注入提供且经 `prebuild --clean` 后仍生效，缺失即构建失败；服务端按租户 pin `signerSha256` 并校验 `packageName`（N18）；默认构建包名不等于任何生产租户；已装机用户的迁移方案（备份→卸载→重装）已发布。E-04 通过。
- [ ] **（N2/N15 深链除外）APK 自更新**在安装前原生校验 sha256 与签名者证书、URL 同源；bootstrap 缺 sha256 拒绝安装；服务端下载校验对象 hash 与入库值一致（N33）。E-04、E-15 通过。
- [ ] **（N3）bootstrap 中影响签名与资金的字段**（合约地址、链、平台域名、更新策略、安全 i18n）编译期固化或服务端签名 + 客户端信任根校验；`approve/setApprovalForAll/permit` 的 spender 在确认 UI 展示并对照白名单。E-13 通过。
- [ ] `WalletSigner` 生产 Interface 不返回、回调或桥接私钥/助记词，且不接受 JS 注入的认证结果；`keystore-vault.spec.ts:139-140` 改为编译失败或运行拒绝。E-02 通过。
- [ ] 本地 signer 在 native 内完成解密/签名；每笔高价值操作由 Keychain/Keystore 强制用户在场，PIN-only 和生物变更语义已在真机验证；密钥失效走恢复而非静默铸新（N8）。E-05、E-10 通过。
- [ ] `inactive/background` 立即清除应用内密钥 handle/明文，不保留后台窗口；**助记词展示不复用签名缓存**（N4），`unavailable` 对真实资金档 fail closed（N10）。E-06 通过。
- [ ] seed 不经过 navigation 参数、React state、JS logger/crash report、系统 clipboard 或第三方 IME；恢复界面为受保护的专用 native 流程；剪贴板若保留须原生实现且不误清用户内容（N23、N15）。E-08 通过。
- [ ] 每租户 production Expo config 必须有独立 trust root；最终 manifest/directive 签名并返回 `expo-signature`；缺失、篡改、跨租户、rollback、未签 directive 负测全通过（N17、N19）。E-03、E-12 通过。
- [ ] 独立 package/applicationId、bundle ID、SecureStore service/Keystore alias、OTA 签名私钥/KMS 权限、合约白名单均由 `tenant.json` 生成并在产物上取证。E-17 通过。
- [ ] delete account、wipe vault、sign out、disconnect 的语义和 UI 分开；删除要求独立认证；密码学擦除与恢复旧密文负测通过；损坏 vault 不覆盖（N7）；卸载不宣称删除。E-11 通过。
- [ ] 外部钱包作为默认路径时：自定义 scheme 深链改 App Link/显式 package（N13），会话密钥不落明文（N14），SIWE 字段客户端断言、会话地址与所签地址比对且 `refresh()` 不改写（N26），signer 断言 `from`/chain 并处理会话事件（N37）；iOS/Android 至少各两款真实钱包完成配对、恢复、拒绝、错链、交易核对和 relay 故障测试。E-16 通过。
- [ ] 至少两类 iPhone（Face ID、Touch ID）和五类 Android 测试位（API 24/29、30、34、36，覆盖 StrongBox、TEE、PIN-only/Class 2）完成 E-05 至 E-11；root/jailbreak 设备只用于残余风险实验。当前无 `adb`/emulator/`xcodebuild` 的环境不能签署该门禁。

### 12.2 P1：生产晋级门禁

- [ ] `SYSTEM_ALERT_WINDOW` 用 `blockedPermissions` 移除；MainActivity 常驻 `FLAG_SECURE` + `filterTouchesWhenObscured`；WC 二维码页与登录/转出确认页启用截屏与 app-switcher 保护（N16、N24）。E-09 通过。
- [ ] AES-GCM 增加 AAD（version‖address‖kind‖path），registry 加完整性；`signMessage/signTypedData` 有 from/地址校验，外部签名器同样校验 `from`（N9、N37）。
- [ ] vault 写入串行化（单飞队列），并发创建/导入不丢条目、不铸第二把 WK；registry 损坏不覆盖（N35、N38）。
- [ ] OTA manifest `applicationId` 与租户配置及基线 APK 绑定，客户端比对 `applicationId/scopeKey`（N34）。
- [ ] 交易守卫扩展 calldata 解码与 spender 白名单；swap 的 unlimited approve 有确认与验证；未知 calldata/typed-data 真实资金档默认拒绝（N22）。
- [ ] 管理端强制 session 登录、按租户 RBAC、发布/上线双人分离、`ADMIN_COOKIE_SECURE` 默认 true；移除 `x-admin-key` 旁路或将其绑定到真实身份（N17）。
- [ ] 预测平台 JWT/CLOB secret 存储加认证或迁入独立命名空间；明确其“会话签名密钥”等级（N21）。
- [ ] JS、Gradle、CocoaPods 和 CI Action 依赖 SCA；high/critical 有 SLA 和阻断规则；CI action 固定完整 commit SHA 并加 `permissions:`；Gradle 加 `verification-metadata.xml`，wrapper 加 `distributionSha256Sum`；CI 构建 release 产物并运行 `apksigner` 与权限清单 diff；网络失败时 CI fail closed（N28）。
- [ ] 每个 artifact 生成 SBOM、签名、hash、source map/native symbols 与构建 provenance。
- [ ] 安全关键 i18n key 只用内置字典；语言包 `tenantId` 与当前租户比对；ADR-0002 措辞更正为“完整性而非真实性”（N27）。
- [ ] recovery/delete/background/clipboard/screenshot/backup/OTA/bootstrap/APK tamper 证据与 app version/build/runtime/tenant 一一绑定。
- [ ] App Attest/Play Integrity 仅作服务端风险信号，支持灰度/观测/申诉（N31）。
- [ ] 日志、崩溃、分析和客服采集做 canary secret 扫描；发现 mnemonic/private key/pairing URI 即阻断；ESLint 禁止 `console.*` 输出 route params/secret。

### 12.3 P2：运营与持续验证

- [ ] 委托移动端与密码学边界的独立渗透测试，范围包含 root/jailbreak、JSI/TurboModule、动态插桩、overlay、深链、OTA 与 bootstrap。
- [ ] 建立漏洞响应与 bug bounty/安全邮箱；高价值钱包依赖变更触发专项审计。
- [ ] 每季度做 OTA/APK key compromise、租户交叉发布、设备丢失与钱包恢复演练；结果进入发布 SLO。

门禁关闭条件不是“代码已合并”，而是对应实验产物可复查。安全负责人、移动端负责人和发布负责人分别签署；任何一方不能用单元测试替代平台证据。

## 13. 可执行实施顺序

### 阶段 0：立即风险收敛（可并行，均为止血非终态）

**0a 发布产物身份（最高优先，阻断分发）**
1. 生成 KMS/HSM 或 Play App Signing 托管的生产签名密钥；release signingConfig 通过 config plugin 或构建期注入提供，缺失即失败。不要直接改 `android/app/build.gradle`，`prebuild --clean` 会覆盖它。
2. 服务端入库按租户 pin `signerSha256` 并校验 `packageName`；CI 构建 release 产物并用 `apksigner` 门禁（N18、N28）。
3. 制定并发布“已装机用户备份→卸载→重装”迁移说明，旧版本内强制提示。

**0b 控制通道真实性**
1. 合约地址、链事实、平台域名进 `tenant.json` 并编译进原生常量；`public-info` 不符即拒绝开通。
2. 生产构建缺 per-tenant `codeSigningCertificate` 时失败；Go 服务端对所有改写完成后的最终 Expo 响应（manifest 与 directive、plain 与 multipart）签名并输出 `expo-signature`。
3. APK 自更新增加 sha256 + 签名者证书校验（先落在原生下载器）；服务端下载时校验对象 hash（N33）。
4. 安全关键 i18n key 只用内置字典；语言包校验 `tenantId`（N27）。

**0c 纯 JS 减损**
1. 真实资产入口默认切换到外部钱包；嵌入式钱包保持开发/测试资产或受控 feature flag。
2. 禁用 seed clipboard；不再把 phrase 放入 navigation；`DEFAULT_UNLOCK_TTL_MS` 降为 0；应用进入 background/inactive 立即 `vault.lock()`。
3. 修 `wrapKey()` 静默铸新（缺 WK 且有条目时报“需从备份恢复”）与 `read()` 损坏覆盖（损坏抛错、覆盖前备份）。
4. `revealMnemonic` 与删除/导入使用独立认证，不复用签名缓存；`unavailable` 对真实资金档 fail closed。
5. 明确 UI 文案：sign out/disconnect 不删除嵌入式钱包，卸载不等于 iOS Keychain 删除。
6. 外部钱包深链改 App Link/显式 package；WalletConnect 注入 SecureStore 背书存储、监听会话事件、signer 断言 `from`/chain；SIWE 客户端断言字段，`verify()`/`refresh()` 不接受地址改写。
7. vault `putSecret` 加单飞队列；registry 损坏不覆盖（N35、N38）。

**0d 过渡性 WK 认证绑定**（可选，明确不签署 P0 门禁）
- WK 改 `requireAuthentication: true` + `WHEN_PASSCODE_SET_THIS_DEVICE_ONLY` + 租户级 `keychainService`，把“录入变更 → WK 失效”变成可见恢复流程。这只关闭“认证不绑定密钥使用”的一半，秘密仍进入 JS，因此是过渡而非终态。

### 阶段 1：建立深模块

1. 引入窄 `WalletSigner`、`WalletRecovery`、`WalletLifecycle` Interface（含 EIP-712 v4 canonical、SIWE 结构化字段决策），把现有 caller 逐个迁移到结构化请求。
2. 先落地 `ExternalWalletAdapter`，完成真实钱包矩阵；同时开发 iOS/Android 自定义 Expo Module 与 `NativeVaultAdapter`（libsecp256k1、BIP-32/39 原生化、RLP/EIP-712/SIWE 规范化、可信确认窗口、per-account alias）。
3. native signer 实现平台 ACL、可信交易确认、内存边界、per-account alias/delete receipt、calldata 白名单；移除生产 JS `withPrivateKey`/`revealMnemonic`，authenticate 不可注入。
4. 落地 8.5 的 v1→v2 迁移状态机（先修 N7/N8），提升 runtimeVersion 并禁止回滚清空 v2。
5. 建立 A/B 租户 production-like build，将 package/bundle、`signerSha256`、service/alias、OTA cert/KMS policy、合约白名单纳入自动检查。

### 阶段 2：验证与晋级

1. 完成 E-05 至 E-17，补齐 SCA/SBOM/provenance 和独立渗透测试。
2. 只在证据对应的 tenant/build/runtime 上小流量开启本地钱包；异常自动暂停 OTA/feature，不通过 OTA 降低 native policy。
3. 若产品数据证明无助记词恢复是核心需求，再开智能账户单链 ADR/试点（E-18）；若监管/托管需求证明必须有服务端共同控制，再单独评估 MPC。

### 粗略工程量与职责（对抗验证后修正）

以下是排期与采购真机/外部测试的量级估算，不是承诺工期；完成条件仍以第 11、12 节证据为准。修正主要来自原生密码学栈与可信 UI 的真实工作量、迁移状态机、以及缺失的 iOS 工具链脚手架。

| 工作包                                                        | 修订 1 | 修订 2（修正） | 主责                          |
| ------------------------------------------------------------- | ------ | -------------- | ----------------------------- |
| 阶段 0a/0b/0c 止血、发布身份、OTA/APK/bootstrap fail closed   | 3–5    | 7–12           | RN + 发布后端 + 平台          |
| Interface、错误模型、公开向量与属性测试                       | 4–6    | 4–6            | 移动架构/安全                 |
| Android Keystore/StrongBox/CryptoObject 自定义模块           | 9–14   | 10–15          | Android                       |
| iOS Keychain ACL/Secure Enclave 自定义模块                    | 7–11   | 7–10           | iOS                           |
| native secp256k1 + BIP-32/39 + RLP/EIP-712/SIWE + 可信 UI ×2 | 9–14   | **24–36**      | 双端 native + 密码学 reviewer |
| v1 迁移、恢复、删除与崩溃一致性                              | 6–9    | 8–12           | 双端 native                   |
| 多租户身份、OTA trust root、自定义 plugin、KMS/CI 门禁        | 5–8    | 6–10           | 发布平台/后端                 |
| iOS 工程 + 本地模块脚手架 + CI 原生构建                       | —      | 3–5            | iOS/平台                      |
| 真机、Frida、OTA、bootstrap、双租户对抗矩阵                   | 9–14   | 10–16          | 安全测试                      |

去重后总量约 **76–117 人日**；现实配置是两名移动工程师（至少一名熟悉移动密码学）约 10–14 周，再预留约 1 周独立安全测试。前三大风险：双端原生密码学栈（libsecp256k1 构建/JNI、EIP-712 与 ethers 向量对齐）；Android 认证绑定的包裹方式与录入失效策略未决，阻塞迁移设计；无 iOS 工具链且 expo-updates 证书链需自定义 plugin + 服务端签名的跨团队协作。若缺少 iOS/Android native 能力、测试设备或 KMS 所有者，项目应保持阻断而不是用 JS 补丁签署门禁。

## 14. 残余风险与决策记录

- **发布产物身份是当前最高优先级**：在生产签名密钥托管并完成用户迁移前，Android 直发产物本身不可信；这不是设计缺陷而是配置事故，但后果等同于把钱包数据交给任何能投递升级包的人。
- 原生 signer 不能使已 root/jailbreak 的设备变成可信设备；它的目标是减少 JS/普通 OTA/文件泄漏的攻击面、绑定用户在场并提高取证成本。secp256k1 不能进硬件，硬件只保护包装密钥。
- 代码签名不能防持有合法 OTA/APK 私钥的内部攻击者；最小权限、双人审批、审计与 native transaction policy 同时需要。
- bootstrap 与 OTA 是两条独立的服务端信任通道；给 OTA 签名不会自动保护 bootstrap，反之亦然。
- 外部钱包把密钥风险转移到钱包供应商和用户确认流程，不会消除钓鱼/盲签；深链与会话安全是其前置条件。
- 本地 EOA 的恢复与“删除后不可恢复”天然冲突：只要用户另有助记词，删除本设备 key 不等于销毁链上控制权。UI 必须表述为“从此设备删除”。
- 智能账户和 MPC 解决的是不同恢复/控制问题，不能用营销术语替代目标链、运营与合规验证。
- 本次 `pnpm audit` 未成功、没有 Apple/Android 真机工具、iOS 从未构建，因此依赖漏洞状态、Secure Enclave/StrongBox 实际等级、备份迁移、删除取证和一切 iOS 行为仍是明确未关闭项。
- 修订 3 的复审说明：独立静态复审能有效发现措辞过强与证据等级错标（0.4 共 10 处），但本轮采纳的新增项均为 P1/P2，未改变 P0 集合与排序；再做一轮静态阅读的边际收益已低，下一轮复审应以第 11 节的真机实验产物为对象。

最终接受标准：普通 DEX/send/SIWE/Predict 代码只能看到公开账户、规范化请求和签名结果；租户、平台、合约地址和钱包实现细节留在深模块后方或编译期固化；任何秘密导出、跨租户更新、后台复用、逻辑删除可恢复、未签名控制通道、公开密钥签名产物都由自动或真机负向实验可靠失败。

## 附录 A：本地核对的平台事实

以下事实由主审在 `node_modules` 源码上直接核对，用于支撑第 4、7、8、10 节，不依赖外部文档：

- **expo-secure-store（Android）** `AESEncryptor.kt`：`KeyGenParameterSpec` 仅 `setUserAuthenticationRequired(options.requireAuthentication)`，无 `setUserAuthenticationParameters`、`setInvalidatedByBiometricEnrollment`、`setIsStrongBoxBacked`；`AuthenticationHelper.kt`/`AuthenticationPrompt.kt` 使用 `BiometricPrompt.CryptoObject(cipher)` 且 `canAuthenticate(BIOMETRIC_STRONG)`；`SecureStoreModule.kt` 在 `KeyPermanentlyInvalidatedException` 时静默返回 null 并 `removeAllEntriesUnderKeychainService`。
- **expo-secure-store（iOS）** `SecureStoreModule.swift`：`SecAccessControlCreateWithFlags(..., .biometryCurrentSet)` 硬编码，读取用 `kSecUseOperationPrompt`；支持 `keychainService`/`accessGroup`。
- **expo-updates** `CodeSigningConfiguration.kt`：无 `expo-signature` 且 `!allowUnsignedManifests`（默认 false）即抛错；directive 验签；`CodeSigningAlgorithm.kt` 仅 `rsa-v1_5-sha256`；`UpdatesConfiguration.kt` 支持 `CODE_SIGNING_INCLUDE_MANIFEST_RESPONSE_CERTIFICATE_CHAIN`，但 `@expo/config-plugins`/`@expo/config-types` 未暴露，需自写 plugin。
- **产物签名**：`apksigner verify --print-certs` 对 5 个 release APK 输出签名者 SHA-256 `fac61745…1033b9c`，与 prebuild 生成的 `android/app/debug.keystore`（RN 模板公开密钥，`.gitignore` 忽略 `/android`，不入库）的 `keytool` 指纹一致。
- **RN 新架构**：`android/gradle.properties` `newArchEnabled=true`、`hermesEnabled=true`；`expo-modules-core ~57.0.16`；无 `ios/` 目录（CNG，iOS 值未能本地验证）。
- **@walletconnect/sign-client 2.24.0**（修订 3 核对）`Engine.isValidRequest`：`isValidSessionTopic` 后调用 `isValidNamespacesChainId(session.namespaces, chainId)`，不在会话内的 chainId 抛 `MISSING_OR_INVALID`，再校验 method 属于该链的 namespace。这是 N37 定为纵深防御缺口而非可利用路径的依据。
- **expo-local-authentication**（修订 3 核对）`LocalAuthenticationModule.kt:212`：`setAllowedAuthenticators(options.biometricsSecurityLevel.toNativeBiometricSecurityLevel() or DEVICE_CREDENTIAL)`，`weak` 即 `BIOMETRIC_WEAK | DEVICE_CREDENTIAL`，无 CryptoObject。
- **构建脚本与忽略规则**（修订 3 核对）`scripts/build-android-release.mjs:112`：`expo prebuild --platform android --clean` 后 `./gradlew assembleRelease`，无签名者/包名门禁；`.gitignore:16-18` 忽略 `/ios`、`/android`、`/artifacts`。
