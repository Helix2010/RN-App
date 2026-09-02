# 接入 pm-cup2026 预测市场平台：登录与资金转入 / 转出分析

- 状态：已决策（见 §6，2026-09-02），待立项开工。全部改动为纯 JS，不引入原生依赖，可随 OTA 发布
- 对象：`~/fy/work/pm-cup2026`（`apps/user-dapp` C 端 + `services/gamma|clob|data|relayer|faucet`），dev 环境 `https://predict.prax1s.xyz`
- 关联：ADR 0007（Gateway 双实现，预留 `createGateways(bootstrap.services)`）、`wallet-onchain-security-2026-09-01.md`、`AGENTS.md` 正式场景开发原则
- 依据：源码追读（三路）+ dev 环境实测（公开接口、一次性密钥完整登录、链上合约参数）

## 1. 结论先行

1. **平台侧零改动即可接入。** user-dapp 的 Next.js BFF 只是转发；所有业务接口（gamma / clob / data / relayer）都能被原生客户端直连，平台自己的 cex-dapp 接入就是这么做的。我们的 App 直连，RN-Server 只负责按租户下发平台域名与开关。
2. **登录不是 SIWE，是 EIP-712。** 签一条 `LoginMessage` 换 gamma JWT；dev 环境实测有效期 30 天，可刷新。我们的内置钱包已有 `signTypedData`，外部钱包走 WalletConnect 同样可签。
3. **资金模型是"每人一个 Safe"。** 交易余额 = 用户 Safe 里的 USDW（6 位），不是 EOA 余额，也不是平台记账。**转入要用户自己付 gas**（approve + wrap 两笔链上交易）；**转出免 gas但分两步**（发起解包 → 等待延迟 → 领取），目标地址固定为登录的 EOA。
4. **我们现有的 `PredictGateway` 契约要改两处**：`deposit` 变成两笔需要 gas 的链上交易；`withdraw` 变成"发起 + 领取"两阶段，模型要加 `claimableAt` 与待领取列表。其余（行情、下单、持仓）接口形态基本能一一映射。
5. dev 环境用的是 **OP Sepolia（11155420）**，我们 anyfun 租户已启用这条链，且目录里的 USDC 就是平台的 `USDC_UNDERLYING`（`0x2eA6…c3AD`），可以直接联调。

## 2. 平台契约（实测确认）

### 2.1 租户与配置

| 项       | 事实                                                                                                                                                                                                           |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 租户识别 | 请求头 `X-Tenant-Domain`，缺省用 `Host`。**未知域名静默落到租户 0**，不是报错——我们的客户端必须每个请求都带这个头，不能漏                                                                                      |
| 服务地址 | 由租户域名派生：`gamma-api.{domain}`、`clob-api.{domain}`、`data-api.{domain}`、`relayer.{domain}`、`clob-ws.{domain}`、`faucet.{domain}`                                                                      |
| 配置入口 | `GET {gamma}/public-info`：`scopeId`（租户 bytes32）、`chain`（chainId / rpcUrl / explorer / tokens / 22 个合约地址）、`contracts`、`loginStatement`、`walletConnectProjectId`、`agreements`。租户过期返回 403 |
| dev 实值 | scopeId `0xfb05…454a`，chain 11155420，USDW `0x790e…6098`，USDC `0x2eA6…c3AD`，CTF_EXCHANGE `0xB6C9…6c2b`，SAFE_FACTORY `0x08C3…5Fe6`，MULTI_SEND `0xA238…7761`，USDW_WRAPPER `0x7deB…F740`                    |

### 2.2 登录（gamma-service）

```
GET  {gamma}/auth/nonce?address=0x…      → { nonce, scopeId, issuedAt, chainId, statement }
签名  EIP-712  domain { name:"PredictMarket", version:"1", chainId }   ← 没有 verifyingContract
      LoginMessage(address wallet, string nonce, uint256 scopeId, string issuedAt,
                   string domain, string uri, uint256 chainId)
POST {gamma}/auth/login  { signature, messageParams:{ address, nonce, scopeId, issuedAt, domain, uri, chainId } }
      → { token }        RS256，sub = 小写 EOA，scope_id，uid，owner；dev 有效期 30 天
POST {gamma}/auth/refresh   Authorization: Bearer   → { token }
```

要点：

- nonce 300 秒有效、**验签前就核销**，失败要重新取 nonce。
- `scopeId` 签成 `uint256`（`BigInt(hex)`），传参仍是 0x-hex。
- `messageParams.domain` 会到 `tenant_domain` 表反查，**必须是该租户已登记的域名**（App 签 `predict.prax1s.xyz`，不能签 scheme 或包名）。
- 没有服务端登出，也没有 `/me`；登出 = 本地丢令牌。
- 首次登录服务端建 `predict_users` 行，并异步算出该 EOA 的 Safe 地址。
- 实测：一次性密钥 nonce → 签名 → login 全程 200，随后用 JWT 查 relayer `/deployed` 拿到未部署的 Safe 地址 `0x79ec…1740`。

### 2.3 三层凭证

| 层                      | 用途                                 | 获取                                                                                                                                                                                                             | 存放                 |
| ----------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| gamma JWT               | relayer 提交、bridge、资料           | 上面的登录                                                                                                                                                                                                       | 客户端               |
| CLOB API key（L2 HMAC） | 下单 / 撤单 / 余额可用额度 / 用户 WS | L1：签 `ClobAuth` EIP-712（domain `{name:"ClobAuthDomain",version:"1",chainId}`）→ `POST {clob}/auth/api-key`（头 `PRED_ADDRESS/SIGNATURE/TIMESTAMP/NONCE` + `PRED_SCOPE_ID`）→ `{ apiKey, secret, passphrase }` | 客户端，等同私钥级别 |
| Safe 授权               | 交易所能动 Safe 里的 USDW / CTF      | relayer 转发一笔 MultiSend：`USDW.approve × 4` + `CTF.setApprovalForAll × 3`                                                                                                                                     | 链上                 |

L2 签名：`base64(HMAC-SHA256(base64url解码(secret), ts + METHOD + path + body))`，时钟容差 ±30 秒，先取 `GET {clob}/time`。

**clob-service 不看域名**：它没有租户中间件，租户身份只在建 API key 时由 `PRED_SCOPE_ID` 绑进密钥。这个头对平台是可选的，对我们是必填——漏了会得到一把不属于任何租户的密钥。

### 2.4 代理钱包（Safe）

- 地址 = CREATE2，salt = `keccak256(abi.encode(eoa, scopeId))`，**部署前就能算出**：`GET {relayer}/deployed?signer=&scopeId=` → `{ deployed, address }`。
- 部署：签 `CreateProxy`（domain `{name:"Polymarket Contract Proxy Factory", chainId, verifyingContract: factory}`）→ `POST {relayer}/submit type=SAFE-CREATE` → 轮询 `/transaction` 到 `STATE_MINED|CONFIRMED`。relayer 付 gas。
- 单 owner（EOA）、阈值 1。

### 2.5 资金转入（用户付 gas）

| 路径                  | 链上动作                                                                                              | 后端                                                                                                     |
| --------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| A：EOA 的 USDC → Safe | `USDC.approve(USDW_WRAPPER, max)`（首次）→ `USDWrapper.wrap(USDC, amount, safe)`，1:1 铸 USDW 到 Safe | 无                                                                                                       |
| B：EOA 的 USDW → Safe | `USDW.transfer(safe, amount)`                                                                         | 无                                                                                                       |
| C：跨链（Relay）      | 源链由用户签发；目的链合约自动 wrap 到 Safe                                                           | `GET /bridge/assets`、`POST /bridge/quote`、`POST /bridge/requests`、轮询 `/bridge/requests/{id}`（JWT） |

dev 环境 `bridge/assets.enabled=false`，C 路径当前关着。测试网有 faucet：`GET/POST {faucet}/api/v1/faucet/{status,claim}`（JWT），实测每人 0.001 TETH，条件是 Safe 已部署。

### 2.6 资金转出（免 gas，两阶段，目标固定为 EOA）

```
阶段 A  GET {relayer}/nonce?address={safe}
        签 SafeTx（domain 只有 { chainId, verifyingContract: safe }）
        to = MULTI_SEND, operation = 1, data = [ USDW.approve(wrapper, amt), wrapper.initiateUnwrap(amt, USDC) ]
        POST {relayer}/submit type=SAFE metadata="initiate-unwrap"  → 轮询 → 事件 UnwrapInitiated(requestId, claimableAt)
等待    unwrapDelay（链上读 wrapper.unwrapDelay()；dev 实测 60 秒，合约上限 30 天）
阶段 B  同样一笔 SafeTx：[ wrapper.claimUnwrap(requestId), USDC.transfer(eoa, amount) ]
待领取  GET {data}/unwrap-requests?safe=&claimed=false
```

- 最小额 `wrapper.minUnwrapUsdw()`（dev 0.001 USDW），无手续费，无人工审核。
- relayer 校验 `from == JWT.sub`、`scopeId == JWT.scope_id`、MultiSend 内每个目标都在白名单（**USDC_UNDERLYING 要运营手动加白**，否则转出必败）。
- 跨链转出接口在 gamma 有、user-dapp 没接、部署文档标注关闭。

### 2.7 余额

- 交易余额：RPC 直读 `USDW.balanceOf(safe)`。
- 可用 / 冻结：`GET {clob}/balance-allowance?asset_type=COLLATERAL`（L2）→ `{ balance, allowances, virtual_available, locked }`。
- 持仓 / 活动 / 盈亏：data-service 全公开 GET，按 `user=` 查询。
- 行情：clob 公开 REST + `wss://clob-ws.{domain}/ws/market`（无鉴权，订阅帧 `{ assets_ids, level }`）；用户 WS `/ws/user` 首帧带 L2 三元组。

## 3. 与我们项目的对应

### 3.1 现状

| 我们                   | 现在                                                                           | 接入后                                                              |
| ---------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| 会话                   | SIWE → RN-Server `wallet_session`（地址即账号）                                | 保留。预测平台的 JWT 是第二套凭证，按需获取、与地址绑定             |
| 钱包                   | 内置 vault（`signMessage / signTypedData / submitTransaction`）+ WalletConnect | 直接复用；EIP-712 全部由现有签名器完成                              |
| 链层                   | `OnchainTransfers` 只会 ERC-20 / 原生转账                                      | 要加"任意合约调用"能力（approve / wrap / transfer 三个 ABI）        |
| `PredictGateway`       | `MockPredictGateway`，纯本地账本                                               | 新增 `HttpPredictGateway`，按 ADR 0007 由 `bootstrap.services` 选择 |
| 预测账户余额           | Mock `available/locked`                                                        | Safe 的 USDW + clob `virtual_available/locked`                      |
| 划转页 `transfer-form` | 钱包 ⇄ 预测账户，秒到                                                          | 转入：两笔交易、要 gas；转出：两阶段、有延迟、只能回 EOA            |
| 模块开关               | `modules.predict`（服务端）                                                    | 不变；再加 `services.predict` 配置                                  |

### 3.2 架构：App 直连，RN-Server 只下发配置

不做 BFF 代理的理由：

- 平台已有"新前端零后端改动"的先例（cex-dapp），直连是它设计的用法；
- gamma JWT 与 CLOB 密钥都是用户级凭证，经 RN-Server 中转就变成平台替用户保管凭证，与"平台不兜底"的立场冲突；
- WebSocket 行情直连最简单。

RN-Server 新增下发（严格 schema，缺则模块不可用，不写默认）：

```json
"services": {
  "predict": {
    "domain": "predict.prax1s.xyz",
    "chain": "op-sepolia"
  }
}
```

`chain` 必须是本租户启用的链，且 `public-info.chainId` 与之相符，否则 App 拒绝启用预测模块并留痕（同 `PROTOCOL` 断言的做法）。

三端规则：

- 服务端：`modules.predict = true` 时 `services.predict` 必须完整合法，否则 bootstrap 返回 503（与代币目录、零条链的处理一致）；`modules.predict = false` 时不下发 `services.predict`。
- 管理端「预测市场」页：开关 + 域名 + 链三项，加一个「测试连接」按钮——服务端去请求 `https://gamma-api.{domain}/public-info`（带 `X-Tenant-Domain`），回显 chainId、scopeId、品牌名，并校验 chainId 与所选链一致；不通过就不让保存。
- App：schema 严格；`domain` 只接受主机名（不含协议、端口、路径）。

### 3.3 App 侧新增模块

```
src/core/predict-platform/
  tenant-client.ts     每个请求带 X-Tenant-Domain；派生五个子域
  public-info.ts       严格 zod；chainId 与租户链断言
  auth.ts              nonce → LoginMessage 签名 → JWT；exp 提前 5 分钟刷新；绑定地址
  relayer.ts           deployed / nonce / submit / transaction 轮询
  clob-auth.ts         ClobAuth 签名、L1 头、L2 HMAC
  safe.ts              SafeTx 类型、MultiSend 编码、CreateProxy 类型
  contracts.ts         ERC20 / USDWrapper / CTF 的 ABI 片段
src/features/predict/api/http-predict-gateway.ts
src/features/predict/model/predict.ts     PredictTx 加 claimableAt / requestId；新增 PendingWithdrawal
```

HMAC-SHA256、keccak、ABI 编码都用已有依赖（`@noble/hashes`、ethers），不新增原生模块。

凭证存放：gamma JWT、CLOB 三元组、Safe 地址 → `expo-secure-store`，按 `tenantDomain + address` 作键；切换账户 / 登出即清；CLOB 密钥按私钥对待，下单超过大额阈值走现有 `useRequireVerification`。

### 3.4 用户流程

**游客**：未登录也能浏览行情与市场——这些都是公开接口，只需要 `X-Tenant-Domain`，不需要任何凭证。

**启用预测交易（一次性，已登录用户进入预测市场模块时触发，见 §6）**

1. 签 `LoginMessage` → JWT。
2. `deployed` 查 Safe；未部署 → 签 `CreateProxy` → relayer 部署（免 gas）。
3. 签 `ClobAuth` → 拿 CLOB 密钥。
4. 签一笔 SafeTx MultiSend 做 7 个授权（免 gas）。

内置钱包 4 次签名落在同一个 5 分钟解锁窗口里，只弹一次生物验证；外部钱包（WalletConnect）每次都要在钱包里确认 `eth_signTypedData_v4`，和网页版一致，转入的两笔交易走 `eth_sendTransaction`。步骤要可断点续做：每步完成写本地状态，重进按 `deployed` / allowance 实查对齐，不信本地缓存。

**转入**

- 入口仍是划转页，方向"钱包 → 预测账户"。
- 显示 EOA 的 USDC 与 USDW 余额；选 USDC 走 A（首次多一笔 approve），选 USDW 走 B。
- 先查原生币够不够 gas，不够就是现有的 `InsufficientGasError` 文案；测试网多一个"领取测试 gas"按钮（faucet）。
- 两笔交易的进度用现有 `TxProgress`。

**转出**

- 方向"预测账户 → 钱包"，目标固定显示登录地址，不可改（平台合约如此）。
- 提交 = 阶段 A；成功后进入"解锁中"，显示 `claimableAt` 倒计时（dev 60 秒，主网当前 2 小时）。
- 划转页多一个"待领取"列表（data-service `unwrap-requests`），到期出现"领取"按钮 = 阶段 B。
- 文案必须说清"先解锁再到账"，不能写成一笔转账。

### 3.5 安全与运维要点

- `X-Tenant-Domain` 漏发不会报错、会落到租户 0：客户端封装在一个 client 里统一加，测试断言每个请求都带。
- 登录 `domain` 只能签平台已登记的域名；我们的 App 用 `services.predict.domain`。
- relayer 白名单：接入前让平台把 `USDC_UNDERLYING` 加白，否则转出阶段 B 必败。
- JWT `sub` 与当前地址不一致就作废重登（切换钱包）。
- 转入需要用户持有原生币；主网上这是真钱，要在划转页提前提示，不能到签名时才失败。
- 平台 JWT 私钥 `gamma-jwt-private.pem` 就放在仓库根目录：是他们的事，但联调时别把这个文件带进任何日志或文档。

### 3.6 联调环境（dev）

| 项         | 值                                                                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 平台租户   | prax1s（平台 tenant 100000000），域名 `predict.prax1s.xyz`；我们这边用 anyfun（RN-Server 100000001）配 `services.predict.domain = predict.prax1s.xyz`                                |
| 链         | OP Sepolia 11155420，anyfun 已启用                                                                                                                                                   |
| 测试 USDC  | 平台的 `USDC_UNDERLYING`（`0x2eA6…c3AD`，6 位）**有公开的 `mint(address,uint256)`，任何地址都能给自己铸**（2026-09-02 eth_call 实测）。联调时用脚本给测试地址铸 USDC，不需要找平台要 |
| 测试 gas   | 任意 OP Sepolia 水龙头；或平台 faucet（JWT，每人一次 0.001 TETH，条件是 Safe 已部署）。转入两笔交易大约要几万 gas，0.001 TETH 够用                                                   |
| 转出延迟   | wrapper 链上 60 秒，最小 0.001 USDW                                                                                                                                                  |
| 平台侧前提 | relayer 白名单里要有 `USDC_UNDERLYING`（§7 待办 1）                                                                                                                                  |

验收清单（一条链跑通即视为登录 + 转入 / 转出完成）：

1. 已登录用户进入预测模块 → 四步启用一次完成；杀 App 重进不再弹签名；换钱包地址重新触发。
2. 划转页转入 1 USDC：首次两笔（approve、wrap），第二次一笔；Safe 的 USDW 余额 +1，EOA 的 USDC −1。
3. 转出 0.5 USDW：阶段 A 成功后出现"解锁中"，60 秒后"领取"可点；领取后 EOA 的 USDC +0.5，待领取列表清空。
4. 转出 0.0001 USDW：低于最小额，提交前就被拦下，文案说明最小额。
5. gas 不足时：转入按钮前置提示，不进入签名。
6. 断网 / relayer 返回 `STATE_FAILED`：界面显示失败原因，不静默重试。
7. `X-Tenant-Domain` 断言：所有请求录制成夹具，测试逐条检查该头存在。

### 3.7 失败与边界

| 场景                                                     | 处理                                                                |
| -------------------------------------------------------- | ------------------------------------------------------------------- |
| JWT 过期或 `sub` ≠ 当前地址                              | 先 `refresh`，失败则重走登录签名；切换钱包地址时清掉全部预测凭证    |
| nonce 用过 / 过期（`40101`）                             | 重取 nonce 再签，不复用旧签名                                       |
| `scopeId` 与租户不符（`40305`）                          | 视为配置错误，停用模块并留痕，不重试                                |
| `public-info.chainId` ≠ `services.predict.chain`         | 同上                                                                |
| relayer 拒绝：白名单 / `from` 不符 / scopeId 不符（403） | 显示平台返回的原因，提示联系平台；不重试                            |
| relayer `STATE_FAILED` / `STATE_INVALID`                 | 该笔作废；重新取 Safe nonce 再发起，不重发同一 nonce                |
| 同一 Safe 多笔 SafeTx                                    | 串行：每笔发起前实时取 `nonce`，前一笔没到 `STATE_MINED` 不发下一笔 |
| L2 时钟偏差（±30 秒）                                    | 每次签名前用 `GET {clob}/time` 校准，不信本机时钟                   |
| CLOB 密钥被平台吊销                                      | L2 请求 401 → 重走 `ClobAuth` 换新密钥                              |
| 转出金额低于 `minUnwrapUsdw`                             | 提交前拦截                                                          |
| 转入时原生币不够 gas                                     | 签名前拦截，走现有 `InsufficientGasError` 文案                      |
| 转出发起成功但 App 被杀                                  | 待领取列表来自 data-service，重进即恢复；不依赖本地状态             |

## 4. 工作量（单人，App 为主）

| 阶段 | 内容                                                                                                   | 估时   |
| ---- | ------------------------------------------------------------------------------------------------------ | ------ |
| 0    | 平台侧准备：确认租户域名、relayer 白名单加 `USDC_UNDERLYING`、给测试地址铸 USDC                        | 半天   |
| 1    | 三端 `services.predict` 下发 + 管理端页面（含测试连接）+ schema                                        | 1–2 天 |
| 2    | `predict-platform` client：租户头、public-info、登录 / 刷新、relayer、Safe/MultiSend 编码、ClobAuth/L2 | 4–5 天 |
| 3    | 链层任意合约调用 + 转入（A/B）+ faucet                                                                 | 2–3 天 |
| 4    | 转出两阶段 + 待领取列表 + 模型改动 + 划转页改造                                                        | 3–4 天 |
| 5    | 启用流程（4 步、可续做）+ 凭证存储 + 登出清理                                                          | 2–3 天 |
| 6    | `HttpPredictGateway` 其余读接口（行情 / 持仓 / 活动 / WS）                                             | 4–6 天 |
| 7    | 测试（录制 dev 响应做夹具）、联调、文档                                                                | 3 天   |

只做"登录 + 转入 / 转出"这一片（阶段 1–5）约 2.5–3 周；整个预测模块接真约 4–5 周。

## 5. 两个概念的说明

### 5.1 "启用流程"是什么

App 的钱包地址就是预测平台里的 EOA，这个理解是对的。但平台不允许 EOA 直接交易：资金放在为这个 EOA 生成的 Safe 里，下单要用 CLOB 的 API key，成交要有 Safe 对交易所合约的授权。所以每个 EOA 在每个租户下要过一次"启用"，一共四步、四个签名：

| 步  | 做什么                                    | 签什么                     | 谁付 gas   | 频率                        |
| --- | ----------------------------------------- | -------------------------- | ---------- | --------------------------- |
| 1   | 登录，换 gamma JWT                        | `LoginMessage`             | 无链上动作 | JWT 过期后重签（dev 30 天） |
| 2   | 部署这个 EOA 的 Safe                      | `CreateProxy`              | relayer    | 一次                        |
| 3   | 申请 CLOB API key                         | `ClobAuth`                 | 无链上动作 | 一次（密钥丢了重签）        |
| 4   | Safe 授权 4 个合约动 USDW、3 个合约动 CTF | `SafeTx`（一笔 MultiSend） | relayer    | 一次                        |

网页版在钱包连上时自动跑 1、2，再弹"启用交易"窗口跑 3、4。做完之前，用户能看行情但不能转入、下单。

四步都是幂等的：Safe 部署了就跳过 2，授权在链上查得到就跳过 4。App 每次进模块都按链上和服务端的实际状态对齐，不信本地缓存——用户中途取消、换手机、换钱包都能续上。

### 5.2 "unwrapDelay"是什么

平台的交易币 USDW 是 USDC 的包装币，1:1。转出就是"解包"：把 USDW 烧掉、把 USDC 还给用户。解包合约（`USDWrapper`）在"发起解包"和"领取 USDC"之间强制隔一段时间，这段时间就是 `unwrapDelay`，单位秒，由平台在合约上设置，上限 30 天。它是平台的风控窗口，不是网络确认时间。

- dev 环境实测 60 秒，所以在 dev 上转出体感是"发起，一分钟后点领取"。
- 主网（Monad 143，wrapper proxy `0x119E…D2c1`）2026-09-02 链上实测 **7200 秒（2 小时）**，最小 0.001 USDW。平台自己的文档里这个值先后出现过 86400（初始部署）、3600、7200——它是 owner 随时可改的链上参数，不是常量。
- 无论多长，两阶段的模型都要做；延迟长短只影响提醒方式。

## 6. 决策记录（2026-09-02）

| 问题                 | 决定                                                                                                                                                                                                                                |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 先接哪条链           | **先调通测试网（OP Sepolia，dev 环境 predict.prax1s.xyz）**；主网接入后续做。Monad（143）这条链本身已按用户要求预先加进三端目录（`docs/changes/2026-09-02-feature-monad-chain.md`），届时只需租户在管理端勾选                       |
| 直连还是经 RN-Server | **直连平台，不经 RN-Server**；RN-Server 只下发 `services.predict { domain, chain }`                                                                                                                                                 |
| 启用流程的时机       | **进入预测市场模块时**进入授权流程（已登录的钱包地址作为 EOA）；未登录用户进模块先走现有登录 sheet，登录后接着跑四步                                                                                                                |
| 主网 `unwrapDelay`   | 主网当前 7200 秒。**App 不配置这个值，也不经 RN-Server 下发**：发起解包时直接用链上事件返回的 `claimableAt`，展示前再读一次 `wrapper.unwrapDelay()`；平台改了参数 App 自动跟上，两边永远一致。RN-Server 只下发 `services.predict`。 |

## 7. 待办（不阻塞开工）

0. 转入路径 B 要显示 EOA 里的 USDW：租户目录里加 USDW（`0x790e…6098`，6 位）这一条，管理端上币即可，不是代码改动。
1. 让平台把 `USDC_UNDERLYING` 加进 relayer 白名单（dev 与将来的主网各一次），否则转出第二阶段必败。
2. 主网 `unwrapDelay` 目前 2 小时：用户不会盯两小时倒计时，主网接入时要做"可以领取了"的推送（走现有推送链路，由 App 在发起解包成功后向 RN-Server 登记一条定时提醒，或本地通知）。
