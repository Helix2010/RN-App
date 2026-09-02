# App Web3 钱包底座方案（注册 + 外部钱包导入）

日期：2026-09-01　范围：RN-App（Expo 57 / RN 0.86 / Hermes）+ RN-Server　参照：`~/fy/work/reverse` 对 Robinhood Wallet `com.robinhood.gateway` 2026.35.0 的静态逆向结论

## 0. 目标与现状

**要什么**：给 App 一个**真实**的 web3 钱包底座，支持

1. **用户注册** = 应用内生成自托管钱包（无需任何外部 App，助记词 + 私钥在本机产生）；
2. **外部钱包导入** = 两条：(a) 用助记词/私钥导入到本机保管；(b) 连接外部钱包 App（MetaMask/OKX/Trust）签名，私钥不进本应用。

**现状（已就位的"缝"）**：

- 会话层已是 SIWE 形态：`SessionGateway.challenge()` 造 SIWE 消息、`verify()` 用签名换 `Session`（`src/features/session/api/gateway.ts`）；一期是 Mock，只校验 `0x` 前缀。
- 钱包层 `WalletGateway` 已定义 `connect/signMessage/send/getBalances/listConnectors…`（`src/features/wallet/api/gateway.ts`），一期是内存账本 Mock。
- 连接器模型已含 `embedded | metamask | okx | trust | walletconnect`，分 `embedded/external` 两类。
- 备份页 `backup-screen.tsx` 已存在，助记词是硬编码 Mock，注释写明"真实实现由钱包服务派生，绝不落盘明文"。
- 安全底座已经是**真的**：`src/core/security/app-lock.ts` + `AppLockGate`（冷启动/离开超时锁）+ `useRequireVerification()`（下单/兑换/转账/发送前生物识别，大额强制）+ `expo-local-authentication`（用 `getEnrolledLevelAsync` 兼容 PIN-only 机型）。
- 链集合当前是 **EVM only**：`bsc | eth | base`（`src/core/gateways/types.ts`）。
- 依赖只有 `expo-crypto / expo-local-authentication / expo-secure-store`，**没有**任何 web3 密码学库。
- 网关装配 `mode: "mock" | "live"`，计划由 `bootstrap.services.mode` 切换（`gateway-context.tsx`）。
- RN-Server **还没有**任何 auth 路由。

结论：接口层已经预留好，缺的是**真实密钥底座 + 真实 SIWE 服务端 + 三种托管路径的实现 + 钱包级安全加固**。

## 1. 从 Robinhood 逆向里抄什么（每条→我们的对应实现）

| Robinhood 做法（证据）                                                                                                                                                                                                                                                   | 安全属性                   | 我们在 RN/Expo 的对应                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 种子/密钥在 **native trezor-crypto**（BIP-39 + secp256k1 + ed25519），Java 只是壳（E-005/E-012, EXP-D3）                                                                                                                                                                 | 密钥不在通用 JS/Java 面    | 用**审计过的库**做 keygen/派生/签名，集中在一个 `signer` 模块（见 §3）。RN 里等价物：`@noble/curves`+`@scure/bip32`+`@scure/bip39`（同作者、被审计），或 `ethers v6` 自带的等价实现 |
| 静止态：**Android Keystore（user-auth-required）+ 生物识别 + Tink/EncryptedSharedPreferences + SQLCipher**（E-011, F-005）                                                                                                                                               | 落盘密文、解密需本人       | `expo-secure-store`（底层就是 Keystore/Keychain）存**包裹密钥**，生物识别用现有 `app-lock` 那套 `expo-local-authentication` 门控；助记词/私钥只存**密文**，明文永不落盘（见 §4）    |
| 每链签名隔离在 **能力沙箱 WASM（microgram）**，import 只有"消息总线 + 安全 RNG"，无网络/文件/eval（E-018/E-020, EXP-D5）                                                                                                                                                 | 单个签名器 bug 影响面最小  | 我们不上 WASM 沙箱（成本过高），但**复刻能力边界**：`signer` 模块是**唯一**能碰私钥的代码，无网络 import；业务层只经网关拿签名，永远看不到私钥（见 §3）                             |
| 审计库 + **确定性 nonce**（RFC6979 / ed25519 RFC8032），无自研签名（E-020, EXP-D6）                                                                                                                                                                                      | 签名正确性                 | 只用 `@noble/*` / `ethers` / `@solana/web3.js`，绝不自研；随机数走 `react-native-get-random-values`（CSPRNG，对应 Robinhood 的"secure RNG only"）                                   |
| 加固：**TLS 证书 pinning**（OkHttp CertificatePinner, E-007）、**Play Integrity + RootBeer 根检测**（E-013）、`allowBackup=false`、无 `debuggable`、无明文（E-002）、中央 **`ScreenProtectManager` 给敏感流加 `FLAG_SECURE`**（种子导出/转账/卡号/WebView, E-019/F-002） | 传输、设备、录屏防护       | §6：`expo-screen-capture` 复刻 ScreenProtect；`allowBackup=false` 已在 `app.config.ts`；RN-Server 证书 pinning；可选根/越狱与 Play Integrity 门控在签名前                           |
| 外部钱包经 **WalletConnect（`wc://` deeplink）+ 中央 DeeplinkResolver**（E-003）                                                                                                                                                                                         | 外部钱包不暴露私钥给本应用 | §5：Reown/WalletConnect v2，`wc://` 深链交给现有深链层（预测式返回那次已建原生深链）                                                                                                |
| **无硬编码密钥/端点**；Firebase key 靠 package+SHA-1 限制（E-020, F-003）                                                                                                                                                                                                | 无泄露                     | 助记词/私钥不进任何 bundle、日志、埋点；沿用 AGENTS 的"敏感信息不入日志/埋点/截图"红线                                                                                              |

一句话：Robinhood = **非托管 + native 密钥 + 沙箱签名 + 纵深防御**。我们照抄"非托管 + 隔离签名 + 纵深防御"，密钥实现用 RN 生态里被审计的纯 JS/原生桥库替代 native trezor-crypto。

## 2. 三种托管路径（对应用户的两个诉求）

| 路径                          | 诉求              | 私钥在哪           | 说明                                                                                              |
| ----------------------------- | ----------------- | ------------------ | ------------------------------------------------------------------------------------------------- |
| **A. 内置自托管钱包（注册）** | "用户注册"        | 本机加密保管       | 应用内 `generateMnemonic()` → 派生 → 存密文。用户无需任何外部 App 就有钱包。默认新用户走这条      |
| **B1. 导入到本机**            | "外部钱包导入"(a) | 本机加密保管       | 用户输入助记词/私钥 → 校验 → 存进同一 Vault，之后与 A 无差别                                      |
| **B2. 连接外部钱包**          | "外部钱包导入"(b) | **永远在外部 App** | WalletConnect v2 连 MetaMask/OKX/Trust；我们只拿地址 + 让对方签名。最安全，但依赖用户已装外部钱包 |

三条都产出同一个 `Session`（地址即身份），上层业务（Predict/DEX/资产）无感知差异——差异只在 `Signer` 的实现与 `connector` 字段。

## 3. 架构：新增 `src/core/wallet/`

```
src/core/wallet/
  signer/
    types.ts            # Signer 接口：getAddress / signMessage / signTypedData / signTransaction
    embedded-signer.ts   # A/B1：从 Vault 取私钥，用 ethers/@noble 签名（唯一碰私钥处）
    walletconnect-signer.ts  # B2：把签名请求转发给外部钱包
  vault/
    keystore-vault.ts    # 助记词/私钥的加密保管（§4）
    kdf.ts               # scrypt/pbkdf2 包裹密钥派生
  keygen/
    mnemonic.ts          # BIP-39 生成/校验；BIP-32/44 派生（EVM: m/44'/60'/0'/0/0）
  chains/evm.ts          # EVM 交易组装（ethers Provider/JsonRpc）
```

- **能力边界**：`signer/` 与 `vault/` **不 import 任何网络模块**（复刻 microgram 的 import 白名单）。业务代码只通过 `WalletGateway` 拿签名，拿不到私钥对象。
- **网关实现**替换 Mock：
  - `EmbeddedWalletGateway`（A/B1）：`connect` = 从 Vault 解锁；`signMessage/send` = `EmbeddedSigner`。
  - `WalletConnectGateway`（B2）：`connect` = 发起 WC 配对；`signMessage/send` = 经 WC session 转发。
  - 组合网关按 `WalletAccount.connector` 选实现（一个账户列表里可同时有内置账户和 WC 账户）。
- **会话**：`HttpSessionGateway` 打 RN-Server 真 SIWE（§7）。`signMessage` 由上面的 signer 提供 → SIWE 签名闭环。
- `backup-screen`：`WORDS` 换成 `vault.revealMnemonic(address)`，生物识别 + FLAG_SECURE 后短暂显示、离屏即清。

### 依赖选型（对齐 Robinhood 的"审计库 + CSPRNG"）

| 用途                   | 选                                     | 为什么                                                                                          |
| ---------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 随机数                 | `react-native-get-random-values`       | Hermes 无 `crypto.getRandomValues`，必须首行 import 的 CSPRNG polyfill（= 逆向里的 secure RNG） |
| 助记词/派生            | `@scure/bip39` + `@scure/bip32`        | paulmillr 审计库，trezor-crypto 的 JS 对位                                                      |
| EVM 签名/交易/Provider | **`ethers v6`**（或 `viem`）           | EVM 是当前唯一链集合；自带审计过的 secp256k1（RFC6979 确定性）、EIP-712、EIP-155                |
| KDF（包裹密钥）        | `react-native-quick-crypto` 的 scrypt  | 原生 OpenSSL 后端，比纯 JS 快很多；给 Vault 加密用                                              |
| 外部钱包               | `@reown/appkit`（WalletConnect v2 RN） | `wc://` 深链 + 会话，官方维护                                                                   |
| 录屏防护               | `expo-screen-capture`                  | FLAG_SECURE（Android）/ 截屏拦截（iOS），复刻 ScreenProtectManager                              |
| Solana（后续）         | `@solana/web3.js` + ed25519            | 仅当链集合扩到 Solana 时引入                                                                    |

> 都是 OTA 不可下发的原生/ABI 变更（`react-native-get-random-values`、`quick-crypto`、`reown`、`screen-capture` 含原生模块），必须走全量包，`runtimeVersion` 递增——已在 AGENTS/RUNBOOK 的红线内。

## 4. 静止态密钥保管（KeystoreVault，对应 E-011）

分层，明文永不落盘：

1. **助记词/私钥** → 用一个随机 **数据密钥 DK** 做 AES-256-GCM 加密，密文存 `expo-secure-store`（底层 Keystore/Keychain）或加密 SQLite。
2. **DK** 本身用一个 **包裹密钥 WK** 加密；WK 存 `expo-secure-store`，`keychainAccessible: AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`（沿用 installation-service 的写法），**且**读取前必须过 `expo-local-authentication`（BiometricPrompt）——这正是 Robinhood 的 Keystore(user-auth-required) + BiometricPrompt 组合。
3. 复用现有 `app-lock` / `useRequireVerification`：解锁钱包、签名、导出助记词 = 高敏动作，统一走已有的生物识别门控（大额还有阈值二次确认）。
4. 可选口令加固：用户设一个 wallet 密码 → scrypt(密码) 参与 WK 派生，做到"设备被解锁也需知道钱包密码"。默认关，作为高级项。

**安全护栏**（沿用 app-lock 已踩过的坑）：设备**无任何生物识别且无锁屏**时不得把密钥门控绑死，否则永久锁死——用 `getEnrolledLevelAsync()` 判定，降级为口令。

## 5. 外部钱包连接（B2，对应 E-003 的 `wc://`）

- Reown AppKit RN 起 WC v2 配对：出二维码/深链 `wc://…`，用户在 MetaMask/OKX/Trust 里批准。
- `wc://` 深链交给现有深链层（预测式返回那次已重建原生深链路由），补一条 resolver（对位 Robinhood 的 `GatewayDeeplinkResolverActivity`）。
- 连上后 `WalletAccount{connector:"walletconnect", backedUp:true}`（外部钱包视为已备份，模型已如此）；`signMessage/send` 全部转发给外部钱包，本应用无私钥。
- SIWE：`challenge` 消息发给 WC 让外部钱包签，`verify` 换会话——与内置钱包同一条服务端路径。

## 6. 加固清单（对应 F-001…F-006）

- **录屏/截屏**：`expo-screen-capture` 在助记词导出、私钥导入、发送确认、SIWE 签名页 `preventScreenCaptureAsync()`（= ScreenProtectManager 的 `VIEW_EXPORTED_WALLET`/`CRYPTO_TRANSFER`）。
- **Manifest**：`allowBackup=false` 已在 `app.config.ts`；release 无 `debuggable`；targetSdk 35 默认禁明文——保持。
- **根/越狱 + 完整性**：可选 `jail-monkey` 或 Play Integrity，在**签名前**对高风险设备提示/阻断（Robinhood 是 RootBeer + Play Integrity，E-013）。建议一期只提示不阻断。
- **TLS pinning**：RN-Server（`api.anyfun.win`）证书 pin（`react-native-ssl-pinning` 或 expo 配置），对位 E-007；注意与我们自己的证书轮换配套。
- **无泄露**：助记词/私钥/签名原文不进日志、埋点、崩溃附件、截图——AGENTS 已有红线，Vault/Signer 加 lint 约束或 code review 检查项。
- **深链校验**：外部传入深链参数在边界校验（AGENTS 已要求），resolver 对非本域 URL 采白名单（对位 Robinhood 的 `redirect` interstitial，F-001）。

## 7. RN-Server 侧（真 SIWE，非托管）

服务端**永不**接触私钥，只做地址身份与会话签发：

- `POST /v1/mobile/auth/nonce` → 按 `address+domain` 下发一次性 nonce（防重放；当前 Mock 是本地随机，真做要服务端持有并核销）。
- `POST /v1/mobile/auth/verify` → 校验 SIWE：`ecrecover(signature) == address`、nonce 有效且未用、domain = 当前租户、时间窗内 → 建/取 `wallet_user`（地址即主键，按 `tenant_id` 隔离）→ 签发会话令牌（复用现有 installation 凭证 + 域名租户作用域机制）。
- 这就是"用户注册"的服务端：**无邮箱、无密码**，地址即账号；首次 verify 即注册。
- 复用现有中间件：`domainTenantScope()` 已按域名解析租户；auth 令牌可挂在同一套 `Authorization` 头风格上。
- Go 侧用 `go-ethereum` 的 `crypto`/`accounts` 做 ecrecover + EIP-191/4361 解析。

## 8. 分期交付

| 阶段                       | 内容                                                                                                                   | 产出                                           |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| **P0 密钥底座**            | `keygen` + `KeystoreVault` + `EmbeddedSigner`；RNG polyfill；单测（派生向量、加解密、门控降级）                        | 能生成/导入/加密保管/签名，纯逻辑可测，不动 UI |
| **P1 注册 + 导入（A/B1）** | 创建钱包流程页（助记词展示/校验/确认）、导入页（助记词/私钥）；`EmbeddedWalletGateway` 替换 Mock；`backup-screen` 接真 | 模拟器可注册/导入/备份/签名登录                |
| **P2 真 SIWE**             | RN-Server `auth/nonce`+`auth/verify` + `wallet_user` 表；`HttpSessionGateway`；`bootstrap.services.mode` 切 live       | 地址登录端到端（内置钱包）                     |
| **P3 外部钱包（B2）**      | Reown AppKit + `wc://` resolver + `WalletConnectGateway`                                                               | 连 MetaMask/OKX/Trust 登录与签名               |
| **P4 加固**                | `expo-screen-capture` 敏感页、TLS pin、可选根检测/Play Integrity                                                       | 达到 Robinhood 同级纵深防御                    |
| **P5 多链签名（可选）**    | 链集合扩 Solana/BTC 时再引 ed25519/UTXO 签名，signer 按链分派（对位 microgram 三签名器）                               | 按业务需要                                     |

每阶段都在 `rn_smoke` 模拟器验证；密钥/签名相关必须有确定性测试向量（BIP-39/BIP-44 官方向量、EIP-712 已知签名）。

## 9. 待你拍板的决策

1. **托管默认**：新用户默认走 **A 内置自托管**（推荐，无外部依赖），还是优先引导连外部钱包（B2）？影响首屏引导与 P1/P3 优先级。
2. **WalletConnect 供应商**：用 Reown AppKit（需在 Reown/WalletConnect 后台建 projectId，每租户或平台级一个）——接受这个外部依赖吗？国内网络对 WC relay 的可达性也要评估。
3. **链范围**：一期仅 EVM（bsc/eth/base，与现状一致）确认？Solana/BTC 是否近期要（决定是否 P5）。
4. **钱包口令**：除生物识别外是否要可选的钱包密码层（§4.4）？多一层安全，多一步体验。
5. **恢复策略**：纯本地助记词（丢设备+没备份=资产丢失，非托管本质），还是要做**社交恢复/云加密备份**（iCloud/Drive 存密文，用户口令解密）？后者体验好但复杂，且触及合规。

## 10. 风险与边界

- **非托管的本质**：私钥/助记词丢失=资产不可恢复，产品文案与备份强提醒必须到位（Robinhood 用 FLAG_SECURE + 强制备份校验）。
- **Hermes/RN 加密性能**：scrypt/派生放 `quick-crypto` 原生侧，避免 JS 线程卡顿；大额签名前的 KDF 要压测。
- **合规**：非托管钱包 + DEX 在部分地区涉牌照/制裁名单（OFAC）筛查，属产品/法务范围，本方案不含。
- **不做的**：WASM 签名沙箱（Robinhood 级隔离，投入产出比对我们不划算，用模块能力边界替代）；服务端托管私钥（与非托管定位冲突，坚决不做）。
