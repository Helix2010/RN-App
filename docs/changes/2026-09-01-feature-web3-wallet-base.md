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
