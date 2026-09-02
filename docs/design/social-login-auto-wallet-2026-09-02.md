# 社会化登录 + 自动创建钱包：接入方案（提案）

- 状态：提案，待产品决策（2026-09-02）
- 关联：`docs/ARCHITECTURE.md` §认证（OAuth 2.1 / OIDC + PKCE）、RN-Server `docs/ARCHITECTURE.md`（本服务只做 token 验证与会话映射）、ADR 0003（设备标识）、`interaction-spec.md` §登录（"创建钱包（内置，后续接自有钱包服务）"）、`wallet-onchain-security-2026-09-01.md`

## 1. 现状

| 层         | 现在的形态                                                                                                                                     | 对本方案的意义                                                               |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 账号       | **地址即账号**：`wallet_user(tenant_id, address)`，首次 SIWE 验签即注册                                                                        | 社会化身份必须映射到地址，不能另起一套用户体系，否则下单 / 持仓 / 资产全要改 |
| 会话       | 服务端发 SIWE 挑战 → 钱包签名 → `wallet_session` 令牌                                                                                          | 社会化登录只解决"你是谁"，"你持有这把钥匙"仍由 SIWE 证明                     |
| 内置钱包   | 助记词本机生成，AES-GCM 密文存普通存储，包裹密钥在 Keystore / Keychain，签名前生物验证；`vault / signer / keygen` 有静态导入白名单，不许碰网络 | 自动创建钱包 = 静默走这条路，不改密钥边界                                    |
| 备份       | `WalletBackup` 页展示助记词，`backedUpAt` 记录                                                                                                 | "自动创建"意味着用户没抄助记词，恢复必须另有出路                             |
| 多租户     | 域名定租户；配置在管理端声明、bootstrap 下发、App 严格解析                                                                                     | 每个租户的登录方式和第三方 client id 是租户配置，不是构建常量                |
| 服务端密文 | `secretbox`（STORAGE_MASTER_KEY 信封加密，AAD 绑定租户）已在用                                                                                 | 存用户备份密文有现成的落点                                                   |

## 2. 目标与不做

目标：

1. 用户用 Google / Apple（后续 Telegram）登录，**第一次登录即有地址**，不抄助记词。
2. 换手机后用同一个社会化账号登录，**钱包回来**。
3. 平台与租户**拿不到能动钱的东西**——延续"平台不为租户兜底"的立场，不做托管。
4. 登录方式与凭据按租户在管理端配置，随 bootstrap 下发，缺则不显示入口（不写内置默认）。

不做：

- 不在 WebView 里收第三方密码（ARCHITECTURE 已定，用系统浏览器 + PKCE）。
- 不引入 MPC 厂商 SDK（Web3Auth / Privy / Particle）：按 MAU 计费、每个租户要单独开厂商项目、密钥安全依赖厂商、又是一次原生依赖。留作 §7 的备选。
- 不做服务端代签（托管）：平台成为资金保管人，法律和安全责任都不在"不兜底"的范围内。

## 3. 路线对比

| 路线                                                | 换机恢复                 | 谁能动钱                         | 引入的依赖      | 结论         |
| --------------------------------------------------- | ------------------------ | -------------------------------- | --------------- | ------------ |
| A. 社会化登录只做身份，钱包照旧本机生成             | 不能，除非用户抄了助记词 | 只有用户                         | 无              | 达不到目标 2 |
| B. 身份 + 本机生成 + **用户口令加密的备份**存服务端 | 能：登录 + 口令          | 只有用户；平台持有密文但没有口令 | 无第三方        | **推荐**     |
| C. MPC 厂商（2-of-3 分片）                          | 能                       | 用户 + 厂商共同                  | 厂商 SDK + 计费 | 备选         |
| D. 服务端托管签名                                   | 能                       | 平台                             | KMS / HSM       | 否决         |

B 的本质就是 Coinbase Wallet / Trust 的"云备份"：密文的保管人换成了本平台而不是用户的 Google Drive / iCloud。选平台服务端而不是用户云盘，是因为两端云盘各要一套 entitlement 与授权范围，每个租户包还要各自申请；平台服务端一处实现两端通用，且 `secretbox` 已在。§6 写明这个选择的残余风险。

## 4. 登录流程（推荐方案）

```
社会化登录按钮
  → 系统浏览器 / 系统弹窗（Google: PKCE；Apple: 原生 Sign in with Apple）
  → 拿到 ID Token（nonce 由服务端签发，防重放）
  → POST /v1/mobile/auth/social/verify { provider, idToken }
      服务端：验签（JWKS）、iss / aud / exp / nonce 核对
      → 找或建 wallet_identity(tenant, provider, subject)
      → 返回 identityToken（5 分钟）+ hasBackup + linkedAddresses
  → App 判断本机钱包：
      a. 本机已有该身份关联的钱包 → 直接走 SIWE
      b. 本机没有、服务端 hasBackup → 输入恢复口令 → 拉密文 → 本机解密 → 导入 vault → SIWE
      c. 本机没有、服务端也没备份 → 静默 createWallet → SIWE
  → SIWE 挑战 → 内置钱包签名 → POST /v1/mobile/auth/verify { …, identityToken }
      服务端：首次把 address 绑到 wallet_identity；签发 wallet_session
```

要点：

- **identityToken 不是会话**，只是把"这次社会化登录"带进 SIWE 验签的桥。会话仍然是地址级的 `wallet_session`，其它功能一行不用改。
- `Session` 增加 `identity?: { provider, subject 脱敏, displayName }` 供界面显示；`connector` 仍是 `"embedded"`——签名的确实是内置钱包。
- 一个身份可以绑多个地址（用户后来导入了别的钱包）；自动创建的那把是"主钱包"，备份只针对它。用户显式导入的钱包不自动上传备份。
- Telegram 不是 OIDC：登录组件回调带 HMAC 签名的载荷，服务端用 bot token 验签。放进同一个 provider adapter 接口，不影响流程。

## 5. 钱包创建与恢复

### 5.1 自动创建

第一次社会化登录（流程 c）静默调用 `vault.createWallet()`，不展示助记词，直接进 SIWE。用户看到的是"已为你创建钱包 0x…"，再引导备份（5.2）。

### 5.2 备份 = 恢复口令 + 密文上传

- 用户设置**恢复口令**（最短 8 位，不允许纯重复；给强度提示）。
- 本机：`entropy`（助记词的熵，16 / 32 字节）用 AES-256-GCM 加密，密钥 = scrypt(口令, salt, N=2^17, r=8, p=1)。N 比 vault 的 2^15 高一档，因为威胁模型是离线暴力破解而不是本机解锁。AAD 绑定 `tenantId + provider + subject + version`，防止密文被挪到别的身份下。
- 上传 `{ version, kdf: {salt, N, r, p}, nonce, ciphertext }` 到 `PUT /v1/mobile/wallet/backup`。服务端再套一层 `secretbox` 信封落库。**口令与明文永远不出本机。**
- 加密代码放在 `core/wallet/backup/`，纳入 `capability-boundary.spec` 的白名单检查（不许 import 网络）；上传由边界外的 gateway 做，只经手密文。
- 备份完成写 `backedUpAt`；备份方式记为 `"cloud"`，与现有"抄助记词"并列。原有助记词展示（生物验证后 reveal）保留，作为第二条备份路。

### 5.3 恢复

新设备：社会化登录 → `hasBackup` → 输口令 → `GET /v1/mobile/wallet/backup`（需要 5 分钟内的 identityToken）→ 本机解密（GCM 校验失败 = 口令错，本机重试计数）→ `vault.importEntropy` → SIWE。服务端对拉取做限流（每身份每小时 5 次、每天 20 次）、写审计、向该身份的其它设备推一条"钱包已在新设备恢复"。

### 5.4 备份门禁

自动创建后允许直接使用，但：

- 首页常驻"未备份"提示；
- **转出、兑换超过阈值前必须完成备份**（复用 `useRequireVerification` 的门禁位置，阈值走现有设置里的大额阈值）。

理由：自动创建的钱包如果既没口令也没助记词，手机一丢资金就没了，而平台按立场不能替用户找回。这条要用人话写在界面上。

### 5.5 其它

- 改口令：本机重新加密、版本 +1 上传，服务端只保留最新一份（旧密文删除，避免旧弱口令留下攻击面）。
- 删除备份 / 解绑身份：显式操作，二次确认，需要生物验证。
- `wallet_user.status = blocked` 现有逻辑照常拦截登录；备份拉取同样拒绝。

## 6. 安全边界与残余风险

| 威胁                              | 结果                                                                                                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 手机丢失（锁屏未破）              | Keystore 包裹密钥受生物验证保护，与现状一致                                                                                                                   |
| 社会化账号被盗                    | 攻击者能拉到密文，**没有口令解不开**；限流 + 审计 + 推送让本人察觉                                                                                            |
| 平台数据库泄露                    | 拿到的是信封加密后的密文，还需要 STORAGE_MASTER_KEY                                                                                                           |
| **平台内部人员：数据库 + 主密钥** | 可以离线暴力破解口令。这是本方案唯一的信任假设：口令强度 + scrypt 2^17 是全部防线。8 位随机口令在 2^17 下单次尝试约百毫秒量级，穷举不可行；用户选弱口令则可破 |
| 服务端宕机                        | 日常签名不依赖服务端（明文在本机 vault）；只影响新设备恢复                                                                                                    |

如果"内部人员 + 弱口令"不可接受，两个升级方向，都不影响本方案已落地的部分：

1. 密文改存用户自己的云盘（Google Drive appData / iCloud），平台不持有密文；代价是每租户的 entitlement 与授权范围。
2. 口令派生改为服务端 OPRF 参与（Signal SVR 的做法），离线破解变为不可能；代价是一段自研密码学协议，要审计。

## 7. 三端改动清单

### RN-Server

- 表：`wallet_identity(tenant_id, provider, subject, user_id NULL, email_hash NULL, created_at, last_login_at)` 唯一 `(tenant_id, provider, subject)`；`wallet_backup(tenant_id, identity_id, version, envelope BLOB, kdf JSON, created_at, updated_at, last_retrieved_at, retrieval_count)`；`wallet_backup_retrieval` 做限流与审计。`wallet_auth_nonce` 加 `kind` 列复用于 OIDC nonce。
- 接口：`POST /v1/mobile/auth/social/nonce`、`POST /v1/mobile/auth/social/verify`、`/v1/mobile/auth/verify` 接受可选 `identityToken`、`PUT/GET/DELETE /v1/mobile/wallet/backup`、`DELETE /v1/mobile/auth/identity`。
- Provider adapter：`google`（JWKS 缓存、aud = 租户配置的 client id 列表）、`apple`（JWKS、aud = bundle id、nonce 取 SHA-256）、`telegram`（bot token HMAC）。
- 配置：`app_configs` 新键 `auth.providers`（公开 client id）与 `auth.secrets`（telegram bot token 等，`secretbox` 加密）；bootstrap 下发 `auth: { providers: [...] }` 只含公开字段。
- OpenAPI、审计事件、i18n 种子。

### RN-Admin

- 「登录方式」页：各 provider 开关、Google 的 android / ios / web client id、Apple 的 team id / bundle id、Telegram bot 名与 token（只写不读）；保存前校验格式。没有值的 provider 不能开启（不写默认）。

### RN-App

- 依赖：`expo-auth-session` + `expo-web-browser`（Google，系统浏览器 PKCE）、`expo-apple-authentication`（iOS 原生）。**原生依赖，随全量包**（ADR 0011）。
- `bootstrap.schema` 增加 `auth.providers`，严格；没下发就不渲染社会化入口。
- 登录 sheet：社会化按钮在"创建 / 导入 / 外部钱包"之上；`useWalletLogin` 增加 `social(provider)` 入口，走 §4 的 a / b / c 三分支。
- `core/wallet/backup/`：加密 / 解密、口令 KDF，纳入边界测试；`vault.importEntropy`。
- 页面：自动创建后的"设置恢复口令"、恢复时的口令输入、设置里的「登录与恢复」（绑定身份、备份状态、改口令、删除备份、解绑）。
- 备份门禁接入转出 / 兑换。
- 文案、测试、变更记录。

## 8. 分期与工作量（单人）

| 阶段       | 内容                                                                                                                       | 估时       |
| ---------- | -------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 0 决策     | §9 的四个问题定下来                                                                                                        | 半天       |
| 1 服务端   | 表、adapter、接口、bootstrap、OpenAPI、测试                                                                                | 3–4 天     |
| 2 管理端   | 登录方式页                                                                                                                 | 1–2 天     |
| 3 App      | 依赖 + ADR、登录流程、自动创建、备份 / 恢复、设置页、门禁、测试                                                            | 5–7 天     |
| 4 租户接入 | 每个租户包：Google OAuth client（android 要包名 + 签名 SHA-1）、Apple Sign In capability；写进 `SAAS_TENANT_BUILD_RUNBOOK` | 每租户半天 |

Apple 的商店规则：只要提供第三方登录就必须同时提供 Sign in with Apple。本项目 iOS 走 MDM / 企业渠道不受商店审核，但为对齐，首批就把 Apple 做上。

## 9. 需要决策

1. **首批 provider**：建议 Google + Apple；Telegram 第二批（bot 验签简单，但登录组件在 RN 里要走网页）；微信需要企业主体与其 SDK，另议。
2. **备份密文放哪**：平台服务端（本方案）还是用户云盘。决定 §6 的信任假设。
3. **备份是否强制**：建议"创建即可用、转出超过阈值前必须备份"；另一种是创建后立即强制设口令，摩擦更大但零裸奔期。
4. **一身份多地址**：允许（本方案）还是一身份只绑一把钱包。允许的话，切换钱包的界面要标出哪把是"自动创建、有云备份"的。
