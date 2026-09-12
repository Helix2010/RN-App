# Feature: bootstrap 响应签名（N3）与默认 24 词助记词（N29）

状态：Done（N3 只到"有签名就验"，强制那一步留给下一个版本）

涉及仓库：RN-App、RN-Server。方案：`docs/design/wallet-key-hardening-2026-09-12.md`。

## N3：bootstrap 响应签名

### 现状证据

bootstrap 决定 RPC 端点、预测平台域名与 scopeId、更新策略（含 `minSupportedVersion`）、以及应用内直装的下载地址。在此之前它的真实性只到 TLS 为止：控制了数据库、控制了 API、或者拿到一张被信任的恶意 CA 的人，不用碰 OTA 就能把设备指向自己的节点。合约地址部分已由 `contract-pin.ts` 的 TOFU 覆盖，更新策略部分已由 OTA 代码签名覆盖，**剩下的 RPC 与域名是最后一个完全未经认证的信任输入**。

### 为什么是 secp256k1

| 位置 | 用的是什么 | 它今天已经在做什么 |
| --- | --- | --- |
| 服务端签名 | `decred/dcrd/dcrec/secp256k1/v4`，go.mod 里的直接依赖 | `internal/siwe` 验 EIP-4361 登录签名 |
| App 验签 | ethers 的 `verifyMessage` | 用户资金的全部签名 |

两端都不引新依赖，验签用的是这个钱包**已经拿用户资金在信任**的那份实现。往最敏感的位置塞一个没人审过的 RSA 验证器或一条新曲线，换不来任何东西。

### Given / When / Then

- Given 租户配了签名者地址，When 收到带签名的下发且签名由那把密钥产生，Then 接受。
- Given 响应体被改了一个字节，Then 拒绝并抛 `BootstrapSignatureError`。
- Given 签名合法但出自另一把密钥，Then 拒绝。
- Given `alg` 不是 `secp256k1-eip191-keccak256`，Then 拒绝，不去猜。
- Given 租户配了地址但服务端还没签，Then **接受**（`REQUIRE_BOOTSTRAP_SIGNATURE = false`）。
- Given 租户没配签名者地址，Then 根本不验。
- Given 收到一份 `issuedAt` 比见过的最大值旧 30 秒以上的**合法**下发，Then 拒绝：签名挡不住把昨天那份再发一遍从而回滚更新策略。

### 技术影响

- RN-Server `internal/siwe/sign.go`：`PersonalHashBytes`（长度前缀数**字节**）、`SignPersonal`、`AddressOf`。dcrd 的紧凑编码把恢复位放在最前面并加 27，ethers 要的是放在最后，这里做了重排。
- RN-Server `internal/api/bootstrap_signing.go`：`bootstrap.signing` 存 app_configs，私钥用 storage master key 加密；管理端 GET / generate；与 OTA 签名密钥**分开**，共用一把等于把两个信任域焊在一起。
- RN-Server `server.go`：bootstrap 先 `json.Marshal` 一次、签这串字节、再 `c.Data` 原样写出。`c.JSON` 会再序列化一次，签的就不是客户端收到的东西——OTA 验签那次踩过一样的坑。载荷加 `issuedAt`。
- RN-App `core/config/bootstrap-signature.ts`：RFC 8941 字典解析（sf-string 转义）、验签、重放判定。
- RN-App `bootstrap-repository.ts`：`loadBootstrap` 改走 `getText`，在 `JSON.parse` **之前**验原始字节。
- RN-App `app.config.ts` / `tenants/<slug>/tenant.json`：`bootstrapSignerAddress`。它走 manifest extra，而 manifest 本身已有代码签名，所以与 `apiBaseUrl` 同一个信任级别。

### 分两个版本上线

服务端先签 → 客户端"有就验" → 客户端"没有就拒"。跳过中间那步直接强制，会把所有还没升级的设备当场锁在门外。`REQUIRE_BOOTSTRAP_SIGNATURE` 翻成 true 之前必须确认带验签的这一版已经铺开。

### 跨语言定桩

`bootstrap-signature.spec.ts` 最后一组的签名是 Go 的 `siwe.SignPersonal` 真实产出的。自签自验证明不了"服务端签的这个 App 认"；两边只要有一处字节重排写反，那一组当场红。

## N29：新钱包默认 24 词，界面可选 12

默认给强的那个，需要好抄的人自己降级。反过来（默认给弱的、把强的藏进高级设置）等于让绝大多数人拿到较弱的那一个。导入不受影响，两种一直都收。

- `generateMnemonic()` 默认值 128 位改 256 位；新增 `MnemonicWordCount`、`DEFAULT_MNEMONIC_WORDS`、`wordCountOf`。
- `KeystoreVault.createWallet(reason?, words?)`，经 `WalletGateway.createWallet({ words })` 透传。
- 设置页加 12 / 24 单选，默认 24。
- 备份页原来写死 `WORD_COUNT = 12`，写死会让 24 词的钱包**永远通不过验证那一步**；改成接受 12 或 24。抄写页标题按实际词数取文案——`translateMessage` 不支持插值，所以是两个键。

本批**不做** BIP-39 passphrase：它的失败方式是静默的，口令错了不会报错，只会打开另一个合法但空的钱包。理由与替代方案见方案文档 §6.2。

## 测试

- RN-Server：`internal/siwe`（签名经 `RecoverAddress` 回环、多字节长度前缀）、`internal/api`（验签、改一个字节即失败、sf-string 转义、未配置租户不签、记录解析）。全量通过。
- RN-App：`bootstrap-signature.spec.ts` 12 例（含 Go 定桩 2 例）、`bootstrap-repository.spec.ts` 验签与重放 7 例、`mnemonic.spec.ts`、`keystore-vault.spec.ts`、`wallet-setup-screen.spec.tsx`。全量 141 套 1057 例通过；`tsc --noEmit`、eslint、`i18n:check` 干净。
