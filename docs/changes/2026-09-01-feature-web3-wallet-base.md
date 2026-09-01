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
