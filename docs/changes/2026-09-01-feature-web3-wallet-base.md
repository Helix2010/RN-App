# Web3 钱包底座：注册 / 导入 / 连接外部钱包

- 日期：2026-09-01
- 方案：`UI/docs/wallet-web3-base-plan-2026-09-01.md`
- 参照：`~/fy/work/reverse` 对 Robinhood Wallet `com.robinhood.gateway` 的静态逆向（E-011 密钥保管、E-018/E-020 沙箱签名与确定性 nonce）
- 分支：`feat/wallet-web3-base`

## 现状与问题

会话层与钱包层的接口（`SessionGateway` 的 SIWE 形态、`WalletGateway`、`connector` 模型、备份页）都在，但实现全是 Mock：`MockSessionGateway.verify()` 只检查签名以 `0x` 开头；`backup-screen` 的助记词是硬编码常量；没有任何密码学依赖。App 无法真正持有密钥，也无法与外部钱包交互。

## 验收条件

1. 用户可在应用内生成自托管钱包（助记词 + 私钥在本机产生），并完成备份校验。
2. 用户可用助记词或私钥导入已有钱包。
3. 用户可连接外部钱包（MetaMask/OKX/Trust）并用其签名，私钥不进本应用。
4. 助记词与私钥明文永不落盘、不进日志；导出与签名必须通过身份验证。
5. SIWE 登录端到端由 RN-Server 校验（nonce 服务端持有并核销）。

## P0 密钥底座（本次）

### Given / When / Then

- Given 首次生成钱包 When 调 `vault.createWallet()` Then 返回 12 词助记词**一次**供备份展示，落盘只有 AES-256-GCM 密文。
- Given 已有条目 When 调 `revealMnemonic` / `withPrivateKey` Then 必须先通过身份验证；取消或失败抛 `WalletAuthRequiredError`，不解密。
- Given 设备没有生物识别也没有锁屏 When 解封 Then 放行（否则用户被永久锁在钱包外，`app-lock` 已踩过这个坑）。
- Given 刚验证过 When 在有效期（默认 5 分钟）内再次签名 Then 不重复弹窗；`vault.lock()` 或超期后重新验证。
- Given 硬件密钥库里的包裹密钥丢失 When 解密 Then 抛 `WalletVaultError`，而不是静默返回错误的密钥。
- Given 存储文件损坏 When 读取 Then 返回空列表，不崩溃。

### 技术影响

新增 `src/core/wallet/`：

- `keygen/mnemonic.ts`：BIP-39 生成/校验/规范化 + BIP-44 EVM 派生（`m/44'/60'/0'/0/{index}`）。
- `vault/keystore-vault.ts`：三层保管 —— 助记词/私钥经 AES-256-GCM 存普通存储；条目密钥由 HKDF-SHA256(包裹密钥 ‖ 可选口令材料, 每条目 salt) 派生；包裹密钥存系统硬件密钥库。**身份验证门控在 Vault 内部**（对应 Robinhood 把认证要求绑在 Keystore 密钥上），不依赖调用方自觉。私钥只在 `withPrivateKey` 的回调作用域内存在。
- `vault/ports.ts` / `vault/expo-ports.ts`：`SecureStorePort`（`expo-secure-store`，`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`）与 `AuthenticatePort`（复用 `core/security/app-lock` 的 `authenticate`）。
- `signer/embedded-signer.ts`：`WalletSigner` 的内置实现，EIP-191 / EIP-712 / EIP-1559 交易签名。

依赖（均为审计过的实现，不自研密码学）：`ethers@6`（secp256k1 RFC6979 确定性 nonce、BIP-39/44、EIP-712）、`@noble/ciphers`（AES-GCM）、`@noble/hashes`（HKDF/scrypt）、`react-native-get-random-values`（Hermes 缺 `crypto.getRandomValues`，polyfill 必须排在 `index.ts` 最前）。

配套调整：
- `package.json` 的 `jest.transformIgnorePatterns` 加入 `@noble|@scure` —— 这两个包 v2 起是纯 ESM，Metro 能处理，jest 需要显式转译。
- `withPrivateKey` 的回调参数不能命名 `use`：`react-hooks/rules-of-hooks` 会把类方法里的 `use(...)` 当成 React 19 的 `use()` hook 而报错。

### 验证

- 27 例单测：
  - `mnemonic.spec.ts` 5 例，含 **BIP-39 官方全零熵向量**（`abandon…about`）与其在 `m/44'/60'/0'/0/0`、`/1` 上的公开测试地址；大小写/空白规范化；校验和错误的助记词被拒；私钥带不带 `0x` 都接受。
  - `keystore-vault.spec.ts` 13 例：落盘无明文（密文既不是明文也不是其编码）、导入不弹验证而导出必须验证、取消/失败不解密、未录入生物识别时放行、解锁有效期与 `lock()`、私钥只经回调交出、私钥导入没有助记词可导出、重复/非法导入不留残留、包裹密钥丢失即不可解、备份标记与删除、损坏文件不崩。
  - `embedded-signer.spec.ts` 6 例：EIP-191 与 EIP-712 签名能 recover 回本地址、同消息签名确定性、EIP-1559 交易的 recovered sender 正确、验证被拒则不签名、reason 透传到系统弹窗。
  - `capability-boundary.spec.ts` 3 例：**静态守住密钥边界** —— Vault/签名器/keygen 不得 import 网络/存储/遥测模块，不得出现 `fetch(`/`XMLHttpRequest`/`WebSocket(`，不得有 `console.*`，不得有直接返回私钥的公开方法。这条对应逆向 EXP-D5"读 WASM Import 段即知能力边界"。
- `pnpm check` 全绿（42 suites / 197 例）。
- 未验证：模拟器真机（P1 接上 UI 后一并验证）；iOS。

## P1 注册 + 导入（本次）

### Given / When / Then

- Given 本机没有钱包 When 打开连接钱包 sheet Then 内置区第一行是"创建钱包"；点击进入钱包设置页（创建 / 导入二选一）。
- Given 点击创建 When 生成成功 Then 直接 `replace` 到备份流程并把助记词随路由参数带过去（不再弹第二次身份验证）。
- Given 本机已有钱包 When 打开 sheet Then 第一行变成"使用内置钱包"，点击即连接并进入 SIWE 确认层。
- Given 从设置页进入备份 When 页面挂载 Then 调 `revealMnemonic`（需身份验证）解封；失败给"未能读取助记词"+ 重试。
- Given 备份校验通过 Then 写入 `backedUpAt`，钱包管理页的"未备份"角标消失。
- Given 导入页输入非法助记词/私钥 Then 输入框**实时**给出原因（提交按钮本来就是禁用的，不实时提示用户不知道错在哪）；合法时先显示将导入的地址再允许提交。
- Given 导入一个已存在的地址 Then 提示"这个钱包已经在应用里了"，不产生重复条目。
- Given 断开一个内置钱包 Then 只取消选中，**密钥保留在 Vault**（删除密钥必须走单独的带确认流程）。

### 技术影响

- `WalletGateway` 扩展：`createWallet` / `importMnemonic` / `importPrivateKey` / `revealMnemonic`，`signMessage` 增加可选 `reason`（进入系统验证弹窗）。新增 `WalletNotProvisionedError` / `WalletProvisioningUnsupportedError`。
- 新增 `EmbeddedWalletGateway`：账户来自 `KeystoreVault`，签名来自 `EmbeddedSigner`，账户元数据（标签 / 当前选中 / 外部账户）存 `foundation.wallet.accounts.v1`；**链上数据（余额 / 转账 / 交易）仍委托给注入的 `chainData`**——按"一期业务全 Mock"的产品决策，本期只把密钥与签名变成真的。地址一律存 EIP-55 校验和形式。
- `MockWalletGateway` 同步实现开通接口（地址用真实 BIP-39/BIP-44 派生，签名仍是假摘要），Mock 模式与既有测试不受影响；演示余额通过 `seedDemoBalances` 显式注入，接真链时删掉。
- 新增页面 `WalletSetupScreen` / `WalletImportScreen`；`BackupScreen` 改为读真实助记词，**干扰词取自真实 BIP-39 词表**（不再是硬编码 DECOYS）。
- `gateway-context` 装配真实 Vault；`Gateways.lockKeys()` 由 `AppLockGate` 在冷启动上锁与回前台超时上锁时调用，丢弃内存中的解锁态。
- i18n 新增 `wallet.setup.*` / `wallet.import.*` / `backup.locked|revealReason|revealFailed|retry` / `login.useWallet|useWalletHint|reason`，seed 已重导（702 键 × 2 语言）。

### 验证

- 单测 22 例新增：`embedded-wallet-gateway.spec` 15 例（未开通时拒绝连接、创建后未备份、导入助记词后签名可 recover 回该地址、私钥导入无助记词可导出、reason 透传、断开保留密钥、多钱包切换与持久化、重命名、无外部连接器时如实标记不可用、外部钱包连接与签名转发、内外账户并列、未知账户拒签、链上数据委托）；`wallet-setup-screen.spec` 3 例；`wallet-import-screen.spec` 4 例。
- `pnpm check` 全绿（45 suites / 219 例）。
- **Android 模拟器（`rn_smoke`，1.2.4/build18 干净安装，打线上 `api.anyfun.win`）**：
  - 创建钱包 → 备份页显示**真实随机助记词**（`giraffe level hollow uphold art social polar loop frame atom direct tenant`），干扰词为真实 BIP-39 词（depend/atom/theme/gas…）✅
  - 退出后重开 sheet → 首行变为"Use my wallet" ✅
  - SIWE 确认层显示真实地址 `0x6904…8965` → 签名登录成功，首页正常 ✅
  - 钱包管理页显示"Not backed up" → 点击进入备份走 `revealMnemonic`，**解出的助记词与创建时完全一致** ✅ → 校验 3 个词通过 → "Backup complete"，`backedUpAt` 落盘 ✅
  - **静止态实测**（`adb root` 读应用私有目录）：`foundation.wallet.vault.v1` 只有 `address/kind/path/createdAt/backedUpAt/salt/nonce/ciphertext`；助记词的三词前缀与最冷僻词 `giraffe` 在整个应用目录中**均不存在**（逐词 grep 的命中全部落在字体 .ttf、ART/OAT 编译缓存、http-cache 与 i18n 缓存等无关文件）；`SecureStore.xml` 中 `foundation.wallet.wrap-key.v1` 形如 `{ct, iv, tlen:128, scheme:"aes", keystoreAlias:"key_v1"}`，即包裹密钥本身由 Android Keystore 密钥加密 ✅
- 未验证 / 残留：
  - 外部钱包（MetaMask/OKX/Trust/WalletConnect）在 sheet 里仍可点击但会报"不支持"——P3 接入连接器后解决。
  - `expo-secure-store` 的条目是 `requireAuthentication:false`：身份验证目前由 Vault 在**应用内**强制，而 Robinhood 是用 Keystore 的 `setUserAuthenticationRequired` 由**硬件**强制。进程内有代码执行能力的攻击者可绕过应用内门控，硬件门控不能。P4 会尝试在设备已录入生物识别时改用 `requireAuthentication: true`，未录入时回退（否则会把用户锁死）。
  - 测试环境坑：RNTL 14 + React 19 下，同一个用例里连续两次 `fireEvent.changeText` 会把工作留在全局调度器里，导致**后续用例**的 `render` 产出空树（`findByTestId` 超时）。已把用例改成单次输入；根因未解（设 `IS_REACT_ACT_ENVIRONMENT=true` 无效）。
  - iOS 未验证。

## P2 真实 SIWE（本次）

### Given / When / Then

- Given 点"使用内置钱包" When 取挑战 Then 挑战由 **RN-Server 构造整条 SIWE 消息**并下发（`POST /v1/mobile/auth/nonce`），客户端不再自己拼消息、不再自己造 nonce。
- Given 用钱包签完名 When 提交 Then `POST /v1/mobile/auth/verify` 由服务端 ecrecover 验签；首次成功即注册（`registered: true`），之后是登录。
- Given 同一个 nonce 再用一次 Then 服务端拒绝（`WALLET_CHALLENGE_USED`）。
- Given 消息里写别人的地址、签名用自己的密钥 Then 服务端拒绝（`WALLET_SIGNATURE_INVALID`），且该挑战立即作废。
- Given 已登录 When 退出 Then 服务端撤销令牌，旧令牌立刻不可用；服务端不可达时本地照样清干净，不把用户卡在登录态。
- Given 服务端回 401 When `refresh()` Then 清空本地会话；只是网络不通时保留本地会话（离线可用）。

### 技术影响

- 新增 `HttpSessionGateway`：会话令牌存 `expo-secure-store`（不进普通存储），会话本身缓存在普通存储供离线读取；`authorization()` 供后续业务请求带令牌。`gateway-context` 生产装配改用它（测试仍由 harness 注入 Mock 会话）。
- 服务端（RN-Server `beec74f`）：`internal/siwe`（EIP-191 信封 + Keccak-256 + secp256k1 恢复 + EIP-55 + EIP-4361 解析）、`internal/api/wallet_auth.go`、迁移 25（`wallet_auth_nonce` / `wallet_user` / `wallet_session`）、ADR-0012。新增依赖 `decred/dcrd/dcrec/secp256k1/v4`（比 go-ethereum 轻得多）。
- 会话 7 天；nonce 10 分钟且一次性，`SELECT … FOR UPDATE` 保证并发只核销一次。

### 验证

- App 单测 7 例（`http-session-gateway.spec`）：挑战取自服务端、签名换会话且令牌进安全存储、过期会话被丢弃、登出撤销、服务端失败仍本地登出、401 清会话、网络错误保留会话。
- 服务端单测 11 例（`internal/siwe`）：真实 ethers 签名向量、多字节消息（EIP-191 长度前缀按字节）、legacy v=0/1、篡改签名/消息被拒、EIP-55 规范向量、EIP-4361 解析与畸形拒绝、domain/nonce/时间绑定、地址替换攻击。
- 本地 MySQL 集成往返：nonce → 真实签名 → verify（`registered` 先 true 后 false）→ 重放 401 → session → 登出 → 复用 401；错误密钥签名被拒且挑战立即作废。
- **线上往返**（`api.anyfun.win`，RN-Server 已部署）：注册 → 会话 → 重放拒绝 → 登出，全部符合预期。
- **设备端到端**（模拟器干净安装 1.2.4/build18，打线上）：创建钱包 → 12 词备份页 → 退出重开 sheet → "Use my wallet" → 签名登录成功，首页显示 `0x850F…82CE`；生产库 `wallet_user` 出现该地址（`login_count=1`，`first_seen_at` 即注册时间），`wallet_session` 一条未撤销、链为 `bsc,eth,base`，`wallet_auth_nonce` 已核销 ✅ logcat 无 auth 相关错误。
- 未验证：iOS；会话 7 天到期后的重新登录（需要等或改时钟）。

## P3 连接外部钱包（本次）

### Given / When / Then

- Given 服务端 bootstrap 下发了 `wallet.walletConnectProjectId` When 打开连接钱包 sheet Then 外部钱包（MetaMask / OKX / Trust / 其他）可点。
- Given 服务端没下发 projectId Then 外部钱包整行置灰并写明"此版本未启用"，而不是点了静默失败。
- Given 点 MetaMask/OKX/Trust When 已装该钱包 Then 用其深链直接唤起；未装则退回二维码 sheet。
- Given 点"其他钱包" Then 展示 WalletConnect 配对二维码，可复制连接码，并提示"只在你自己的钱包里确认"。
- Given 外部钱包批准连接 Then 得到地址与链，账户以 `connector=walletconnect` 记入本应用，**私钥始终留在外部钱包**；`backedUp` 视为 true（备份由钱包自己负责）。
- Given 用外部钱包签名 Then 请求经 WalletConnect 会话转发，Android 上先把用户切到钱包 App；用户拒绝则抛 `WalletConnectRejectedError`。
- Given 冷启动后仍有有效 WC 会话 Then `restore()` 恢复，不用重新扫码。

### 技术影响

- 新增 `WalletConnectConnector`（实现 P1 定义的 `ExternalWalletConnector`）：CAIP-10 账户解析、`personal_sign`（**按字节** hex 编码）、`eth_signTypedData_v4`、`eth_signTransaction`；与 SDK 的耦合收在 `SignClientLike` 窄接口后面，便于单测与换库。
- `walletconnect-client.ts` 惰性 `import("@walletconnect/sign-client")`，未配置 projectId 时不初始化。
- **参数全部由服务端下发**：bootstrap 新增 `wallet: { walletConnectProjectId, chains }`（RN-Server `5941868`，迁移 26 给已有租户补齐，管理端 PATCH 路径同样归一化）。**没有构建期兜底** —— projectId 是租户配置而不是构建参数，混两条来源会让"某台机器能连、CI 出的包不能连"无法排查。
- 新增依赖：`@walletconnect/sign-client` / `@walletconnect/utils` / `@walletconnect/react-native-compat` + polyfill（`react-native-url-polyfill`、`fast-text-encoding`），polyfill 在 `index.ts` 最前加载。
- 生产插件补 R8 抑制规则：WalletConnect 的依赖树里带进引用 `java.awt` 的桌面端代码（`com.sun.jna`），Android 上是死代码，但会让 `minifyReleaseWithR8` 直接失败。规则由插件写入，`prebuild --clean` 不会冲掉。
- 连接器列表：`staleTime` 从 `Infinity` 改为 30s，并在 `applyDeliveredWalletConfig` 后主动失效——否则 bootstrap 到达前缓存的"未启用"会一直留着。

### 验证

- 单测 14 例（`walletconnect-connector.spec`）：CAIP-10 解析（含未知链回退、无账户返回 null）、required namespaces 的链与方法、深链选择、无账户即拒、`personal_sign` 参数顺序与多字节 hex、typed data 参数顺序、交易按自身链且金额 hex、钱包拒绝→类型化错误、未连接地址拒签、断开与重复断开、冷启动恢复、**projectId 未下发时置灰且 connect 抛 `WalletConnectUnavailableError`**。
- `embedded-wallet-gateway.spec` 补 2 例：内置钱包项不被外部连接器吞掉、无外部连接器时内置项仍在。
- `pnpm check` 全绿（47 suites / 241 例）。
- **设备验证**（模拟器，打线上）：
  - 未下发 projectId → sheet 中 4 个外部钱包整行置灰、副标题"Not enabled in this build" ✅
  - 在生产租户配置里临时设一个 projectId → 冷启动后同一 sheet 中外部钱包变为可点、副标题"Installed"，且"内置钱包"分组仍在 ✅（随后已还原为空，`updated_by=claude-revert`）
  - 这两步之间**只改了服务端配置，没有重新打包** —— 下发链路成立。
- 未验证：与真实钱包 App 的完整配对与签名（需要一个真实的 WalletConnect projectId，见下）。R8 规则变更后的构建已通过。

### 需要你提供

WalletConnect（Reown）的 **projectId**：在 https://dashboard.reown.com 建一个项目即可，是客户端标识不是密钥。拿到后在管理端（或直接改租户 bootstrap 配置）把 `wallet.walletConnectProjectId` 填上，**不需要重新打包**，App 冷启动即生效。填好后我可以在装了 MetaMask 的设备上跑完整的配对 + 签名验证。

## P4 加固：敏感界面防截屏（本次）

### Given / When / Then

- Given 停在助记词展示 / 校验页 Then 系统截图与**程序化抓屏**（含埋点 SDK 录屏）都被挡住。
- Given 停在助记词 / 私钥导入页 Then 同样被挡住。
- Given 离开这些页面 Then 保护释放，其他页面能正常截图分享。
- Given 设备或系统不支持防截屏 Then 不抛错、不挡住用户看助记词。

### 技术影响

- 新增 `src/core/security/screen-protect.ts`：`PROTECTED_FLOWS` 显式列出受保护流程 + `useScreenProtect(flow)`。这是 Robinhood 中央 `ScreenProtectManager` 的对位实现（逆向 E-019 / F-002）：`FLAG_SECURE` 只加在**明确列出**的敏感流程上——全局开会影响正常截图分享，逐页手写又容易漏。
- 用 tag 调用 `preventScreenCaptureAsync(flow)` / `allowScreenCaptureAsync(flow)`：两个受保护页面叠在一起时，先离开的那个不会撤掉仍在前台那个的保护。
- 新增依赖 `expo-screen-capture`（原生模块，需全量包，不能 OTA）。

### 验证

- 单测 3 例：挂载即保护、卸载即释放、tag 正确、不支持的设备不崩、受保护流程清单显式。
- `pnpm check` 全绿（48 suites / 244 例）。
- **设备验证**（模拟器）：停在助记词页时 uiautomator 能读到 12 个词（页面确实在显示），但 `adb exec-out screencap` 返回**全黑**（15KB 纯黑 PNG）；返回上一页后同样的命令拿到 121KB 正常内容 —— 保护生效且正确释放 ✅
- iOS 未验证（iOS 只能拦截截图事件，无法像 Android 的 `FLAG_SECURE` 那样阻止抓屏）。

## 依赖对齐修正

CI 的 `check-expo-doctor` 抓到两个真问题（本地 `pnpm check` 不覆盖，已修）：

- `@walletconnect/react-native-compat` 的 peer 依赖 `@react-native-community/netinfo` 只是传递依赖。pnpm 的严格 node_modules 布局下它不会被提到应用根目录，原生自动链接可能拿不到 —— 运行时才崩。改为按 SDK 版本直接安装（`12.0.1`）。
- `react-native-get-random-values` 装成了 `2.0.0`，与 Expo SDK 57 期望的 `~1.11.0` 是大版本不匹配。改为 `^1.11.0`（polyfill 的用法不变）。

修正后 `expo-doctor` 21/21 通过，`pnpm check` 48 suites / 244 例全绿，release 包重建并在设备上冷启动无错误。

## 剩余（P4 未做的部分）

- `expo-secure-store` 的条目仍是 `requireAuthentication:false`：身份验证由 Vault 在应用内强制，而不是 Keystore 硬件强制。计划：设备已录入生物识别时改用 `requireAuthentication: true`，未录入时回退（否则把用户锁死）。
- RN-Server 的 TLS 证书 pinning（逆向 E-007 的对位项）。
- 可选的越狱 / root 检测与 Play Integrity（逆向 E-013），建议一期只提示不阻断。
- 真实链上数据（余额 / 转账广播）仍是 Mock 账本，按"一期业务全 Mock"的产品决策保留。

## P3+ 链端点也走统一下发（本次）

起因：`walletConnectProjectId` 走下发之后，RPC 与区块浏览器地址显然是同一类东西（租户配置、要能轮换、不该重新打包）。核实时还发现两处现存问题：`CHAINS[x].explorerUrl` 定义了却**从没被读过**（死配置），而唯一需要浏览器链接的 `wallets-screen.tsx` 里**硬编码了 `https://bscscan.com/address/...`**，不管账户在哪条链。

### Given / When / Then

- Given 租户在配置里给某条链填了自己的 `rpcUrls` / `explorerUrl` Then App 冷启动即用新端点，**不用重新打包**。
- Given 填的是 `http://` 明文端点 Then 服务端拒绝并回退到默认值（明文 RPC 会泄露 App 查询的每个地址与余额）。
- Given 某条链只出现在 `networks` 里没写进 `chains` Then 视为启用，不必两处都配。
- Given `explorerUrl` 末尾带斜杠 Then 归一化掉，避免拼出双斜杠。
- Given 老服务端不下发 `networks` Then App 用 `chains` 推默认值，**不让整个 bootstrap 解析失败**（白标产品里 App 版本必然落后服务端）。
- Given 还没连上服务端 Then `rpcUrls` 为空，依赖它的功能应如实不可用——不猜端点。

### 技术影响

- 服务端 `normalizeWallet` 改为输出 `{walletConnectProjectId, chains, networks:[{id, chainId, rpcUrls, explorerUrl}]}`。`chainId` 来自平台目录、**不允许租户改写**（改错会让签名打到错链）；端点可改。`chains` 保留在 payload 里给只认旧结构的客户端。
- App 新增 `src/core/wallet/config/wallet-runtime-config.ts`：下发配置的唯一持有处，暴露 `walletConnectProjectId / enabledChains / networkFor / evmChainId / chainForEvmId / explorerAddressUrl / rpcUrlsFor` 与 `onWalletConfigChange`（projectId 变化时丢弃已建的 WalletConnect 客户端）。原来放在 `walletconnect-client.ts` 里的 holder 搬走了——RPC 与浏览器地址不属于 WalletConnect 范畴。
- 修掉硬编码的 bscscan：改用 `explorerAddressUrl(current.chains[0], current.address)`。
- `CHAINS` 保留为**展示元数据**（名称 / 符号 / 精度 / 颜色），端点一律来自服务端。

### 验证

- 服务端 6 例（`wallet_config_test.go`）：默认全链、按 `chains` 过滤、租户端点覆盖且 chainId 不可改写、明文端点被拒并回退、projectId trim、坏配置回退到全链而不是空列表。
- App 6 例（`wallet-runtime-config.spec.ts`）：未下发时 WalletConnect 不可用且 RPC 为空、下发后用新端点、老服务端缺 `networks` 时从 `chains` 推、只在真的变化时通知订阅者、未在下发列表里的链仍有可用默认值。
- `pnpm check` 49 suites / 250 例全绿；RN-Server `go test ./...` 全绿。
- **线上 + 设备实测**：`api.anyfun.win` 的 bootstrap 已返回三条链的 `chainId/rpcUrls/explorerUrl`；App 清数据冷启动后，`adb root` 读 `foundation.bootstrap.v3.*` 缓存确认**三条 networks 全部被接受并落缓存**（若 schema 不匹配会静默回落到 fallback，缓存里就不会有这段）✅

### 关于 RPC 的一个必须说清的边界

下发给客户端的 RPC 地址**按定义就是公开的**——任何人都能从包里或抓包拿到。所以：租户要么用可以公开的端点（按域名限制来源、或带速率限制的 key），要么让 RN-Server 代理 RPC。**绝不要把 bearer 类密钥拼在 rpcUrl 里**。当前默认值用的是各链的公共端点（BSC dataseed / publicnode / base mainnet），能跑但有速率限制，正式上线应换成租户自己的服务商。
