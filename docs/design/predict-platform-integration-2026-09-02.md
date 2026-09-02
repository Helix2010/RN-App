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

| 层                      | 用途                                                                                                                                                                                                        | 获取                                                                                                                                                                                                             | 存放               |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| gamma JWT               | relayer 提交、bridge、资料                                                                                                                                                                                  | 上面的登录                                                                                                                                                                                                       | 客户端             |
| CLOB API key（L2 HMAC） | 撤单 / 余额可用额度 / 成交记录 / 用户 WS；**下单请求也要带它，但订单本身另有 EOA 的 EIP-712 签名，clob 会验签**（`INVALID_SIGNATURE: signer mismatch`），所以这把密钥单独泄露不能替用户下单，能撤单、能看账 | L1：签 `ClobAuth` EIP-712（domain `{name:"ClobAuthDomain",version:"1",chainId}`）→ `POST {clob}/auth/api-key`（头 `PRED_ADDRESS/SIGNATURE/TIMESTAMP/NONCE` + `PRED_SCOPE_ID`）→ `{ apiKey, secret, passphrase }` | 客户端，账户级敏感 |
| Safe 授权               | 交易所能动 Safe 里的 USDW / CTF                                                                                                                                                                             | relayer 转发一笔 MultiSend：`USDW.approve × 4` + `CTF.setApprovalForAll × 3`                                                                                                                                     | 链上               |

L2 签名：`base64(HMAC-SHA256(base64url解码(secret), ts + METHOD + path + body))`，时钟容差 ±30 秒，先取 `GET {clob}/time`。

阶段 6 做下单时注意：订单的 `maker` 是 Safe、`signer` 是 EOA、`signatureType` 是 Gnosis Safe 那一档，不是 EOA 直接做 maker。

**clob-service 不看域名**：它没有租户中间件，租户身份只在建 API key 时由 `PRED_SCOPE_ID` 绑进密钥。这个头对平台是可选的，对我们是必填——漏了会得到一把不属于任何租户的密钥。

### 2.4 代理钱包（Safe）

- 地址 = CREATE2，salt = `keccak256(abi.encode(eoa, scopeId))`，**部署前就能算出**：`GET {relayer}/deployed?signer=&scopeId=` → `{ deployed, address }`。
- 部署：签 `CreateProxy`（domain `{name:"Polymarket Contract Proxy Factory", chainId, verifyingContract: factory}`）→ `POST {relayer}/submit type=SAFE-CREATE` → 轮询 `/transaction` 到 `STATE_MINED|CONFIRMED`。relayer 付 gas。
- 单 owner（EOA）、阈值 1。

### 2.5 资金转入（用户付 gas）

| 路径                  | 链上动作                                                                                                                                                                                                                          | 后端                                                                                                     |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| A：EOA 的 USDC → Safe | `USDC.approve(USDW_WRAPPER, amount)` → `USDWrapper.wrap(USDC, amount, safe)`，1:1 铸 USDW 到 Safe。网页版授权的是无上限额度，我们**按本次金额授权**：多一笔几分钱的 L2 交易，换来 wrapper 万一出事时 EOA 里的 USDC 不会被整个拿走 | 无                                                                                                       |
| B：EOA 的 USDW → Safe | `USDW.transfer(safe, amount)`                                                                                                                                                                                                     | 无                                                                                                       |
| C：跨链（Relay）      | 源链由用户签发；目的链合约自动 wrap 到 Safe                                                                                                                                                                                       | `GET /bridge/assets`、`POST /bridge/quote`、`POST /bridge/requests`、轮询 `/bridge/requests/{id}`（JWT） |

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
    "chain": "op-sepolia",
    "scopeId": "0xfb05…454a"
  }
}
```

三个字段都是管理端在开启预测模块时填写的：`domain` 是平台上该租户的接口域名，`scopeId` 是平台上该租户的 scope（bytes32，格式 `^0x[0-9a-f]{64}$`），`chain` 是我们这边启用的链之一。RN-Server 的租户 id 与平台的租户 id **不假定相同**，两边的关联只靠这条配置。App 拿到 `public-info` 后断言 `scopeId` 与 `chainId` 都相符，任一不符就拒绝启用预测模块并留痕（同 `PROTOCOL` 断言的做法）。来源与租户隔离见 §3.8。

三端规则：

- 服务端：`modules.predict = true` 时 `services.predict` 必须完整合法，否则 bootstrap 返回 503（与代币目录、零条链的处理一致）；`modules.predict = false` 时不下发 `services.predict`。
- 管理端「预测市场」页：开关 + 接口域名 + scopeId + 链四项，加一个「测试连接」按钮——服务端去请求 `https://gamma-api.{domain}/public-info`（带 `X-Tenant-Domain`），回显品牌名、chainId、scopeId，并校验 scopeId 与所填一致、chainId 与所选链一致；不通过就不让保存。
- App：`services.predict` 段本身严格；`domain` 只接受主机名（不含协议、端口、路径）。bootstrap 根对象不是 strict（未知键丢弃），所以服务端先上 `services` 段不会打坏已安装的旧 App；发布顺序仍然是服务端 → 管理端 → App，`modules.predict` 在 App 发布前保持关闭。

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

凭证存放：gamma JWT、CLOB 三元组、Safe 地址 → `expo-secure-store`，按 `tenantDomain + scopeId + address` 作键；切换账户 / 登出即清；下单超过大额阈值走现有 `useRequireVerification`。iOS 的 keychain 在卸载重装后仍在：首次启动发现本机没有钱包时，把预测凭证一并清掉，不让一把旧密钥跟着新安装复活。

读链只用我们租户自己下发的 RPC（`rpcUrlsFor(chain)`），不用 `public-info.rpcUrl`：App 里链的访问只有一个来源。

`services.predict` 在运行中变化（域名、scopeId 或链任一变了）：视为换了平台，清掉该租户的全部预测凭证，下次进模块重新跑启用流程；`modules.predict` 关掉则只隐藏入口、不动凭证。地址比对一律不区分大小写（JWT 的 `sub` 是小写，我们存的是 EIP-55）。

### 3.4 用户流程

**游客**：未登录也能浏览行情与市场——这些都是公开接口，只需要 `X-Tenant-Domain`，不需要任何凭证。

**启用预测交易（一次性，已登录用户进入预测市场模块时触发，见 §6）**

进入模块时先出一页「启用预测交易」：说明要签什么、钱放在哪、转出规则，附平台的协议（`GET {gamma}/agreements`，网页版在连接钱包前要用户勾选），一个按钮跑完四步，另有「稍后」可以先看行情。四个签名不能在用户没被告知的情况下从钱包里连续弹出来——对外部钱包用户尤其如此。

四步：

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
- **平台限流按 IP**：gamma 每 IP 60 秒 120 次，relayer 每 IP 每小时 1000 次、提交 100 次、建 Safe 10 次。手机用户在运营商 NAT 后面成百上千人共用一个出口 IP，上量后必然撞线。接入前要让平台按租户提高或改为按 JWT 计数；我们这边把轮询压到最低（relayer 交易状态 3 秒一次到终态即停，余额 15 秒，待领取列表 30 秒），并对 429 做退避、不做重试风暴。
- **待领取列表来自子图**（data-service `unwrap-requests`），索引有延迟：发起解包成功后本机先记一条乐观记录（requestId、claimableAt、金额），与服务端列表按 requestId 合并，服务端出现后以服务端为准。否则用户会看到"刚发起的转出不见了"。
- 平台租户过期时 `public-info` 返回 403：模块显示"预测市场暂不可用"，不进启用流程。
- data-service 的持仓、活动、盈亏按地址公开可查，任何人都能看任一地址的仓位：这是平台设计，写进用户可见的说明里，不在我们能改的范围。

### 3.6 联调环境（dev）

| 项         | 值                                                                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 平台租户   | prax1s（平台 tenant 100000000），域名 `predict.prax1s.xyz`；我们这边用 anyfun（RN-Server 100000001）配 `services.predict.domain = predict.prax1s.xyz`                                |
| 链         | OP Sepolia 11155420，anyfun 已启用                                                                                                                                                   |
| 测试 USDC  | 平台的 `USDC_UNDERLYING`（`0x2eA6…c3AD`，6 位）**有公开的 `mint(address,uint256)`，任何地址都能给自己铸**（2026-09-02 eth_call 实测）。联调时用脚本给测试地址铸 USDC，不需要找平台要 |
| 测试 gas   | 任意 OP Sepolia 水龙头；或平台 faucet（JWT，每人一次 0.001 TETH，条件是 Safe 已部署）。转入两笔交易大约要几万 gas，0.001 TETH 够用                                                   |
| 转出延迟   | wrapper 链上 60 秒，最小 0.001 USDW                                                                                                                                                  |
| 平台侧前提 | dev 的 relayer 配置已把 `USDC_UNDERLYING` 列入白名单（`services/relayer-service/config.yaml`），无需动作；主网见 §7 待办 1                                                           |

验收清单（一条链跑通即视为登录 + 转入 / 转出完成）：

1. 已登录用户进入预测模块 → 四步启用一次完成；杀 App 重进不再弹签名；换钱包地址重新触发。
2. 划转页转入 1 USDC：首次两笔（approve、wrap），第二次一笔；Safe 的 USDW 余额 +1，EOA 的 USDC −1。
3. 转出 0.5 USDW：阶段 A 成功后出现"解锁中"，60 秒后"领取"可点；领取后 EOA 的 USDC +0.5，待领取列表清空。
4. 转出 0.0001 USDW：低于最小额，提交前就被拦下，文案说明最小额。
5. gas 不足时：转入按钮前置提示，不进入签名。
6. 断网 / relayer 返回 `STATE_FAILED`：界面显示失败原因，不静默重试。
7. `X-Tenant-Domain` 断言：所有请求录制成夹具，测试逐条检查该头存在。
8. 外部钱包（MetaMask / OKX 移动端）走完四步：重点看 `uint256 scopeId` 这种大整数在 `eth_signTypedData_v4` 里各家钱包是否签得一致。
9. 网页版与 App 用同一个地址同时发起 Safe 交易：后发的一笔要么取到新 nonce 成功，要么以失败呈现并可重试，不能卡死。
10. 发起解包后立刻杀 App 再进：待领取列表在子图追上之前就有这一条（乐观记录），追上后不重复。

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
| 转出发起成功但 App 被杀                                  | 本机乐观记录 + data-service 列表合并，重进即恢复                    |
| 平台限流 429                                             | 指数退避，最多 3 次，界面显示"稍后再试"；不并发重试                 |
| `services.predict` 在运行中被改                          | 清预测凭证，下次进模块重新启用（§3.3）                              |
| 平台租户过期（`public-info` 403）                        | 模块不可用提示，不进启用流程                                        |

### 3.8 服务地址：从哪来、谁维护、租户怎么隔离

**结论：是的，平台的服务地址是租户级的运行时配置，由 RN-Server 随 bootstrap 下发，在管理端维护。** 不放进 `tenant.json`：构建期只有 RN-Server 的 `apiBaseUrl` 这一个根，其余全部运行时下发——平台换域名、换环境都不该重发 App 包，和 RPC 端点是同一套做法。

**只需要一个域名。** 平台自己的规则是从租户域名派生全部服务地址（`gamma-api.` / `clob-api.` / `data-api.` / `relayer.` / `clob-ws.` / `faucet.` 六个子域），它的网页端就是这么做的。所以管理端只维护 `domain` 一个字段，App 按同一规则派生，并强制 `https` / `wss`。不提供逐个服务的地址覆盖：平台部署不按它自己的规则，是平台侧的配置错误；将来真有这种租户，再加一个管理端显式声明的 `endpoints`，不是现在。

**两个租户注册表用一条显式关联对上，不假定 id 相同。** 平台在所有签名、JWT、CLOB 密钥里用 `scopeId` 标识租户，所以关联键就是它。关联属性放在租户的应用配置 `services.predict.scopeId` 里（与钱包、模块开关同一张 `app_configs` 表），管理端开启预测模块时和接口域名一起填；不加在 `tenants` 表的列上——tenants 表没有管理接口、表结构又和平台镜像，加列会再耦合一次。RN-Server 不读平台的库。

2026-09-02 线上实测：RN-Server 与平台用同一台 MySQL（`rn` 与 `pm` 两个库），现有四个租户（100000001–100000004）两边 id 与 scope_id 恰好一致，平台的 dev 租户 100000000（prax1s）不在 `rn` 里。这是现状，不是规则；设计按"不一定相同"来。

| 平台租户                | 平台链     | 平台域名与状态                                    | 我们这边                             |
| ----------------------- | ---------- | ------------------------------------------------- | ------------------------------------ |
| 100000000 prax1s（dev） | OP Sepolia | `predict.prax1s.xyz` 可用                         | 无对应租户，可由任一租户通过配置关联 |
| 100000001               | OP Sepolia | `predict.predict.kim`，`gamma-api` 子域当前不可达 | anyfun（生产）                       |
| 100000004               | OP Sepolia | `predict.tokenup.pro` 可用                        | tokenup.pro                          |

**这两个字段决定用户凭证发往哪里**（登录 JWT 发到 `gamma-api.{domain}`，CLOB 密钥发到 `clob-api.{domain}`），所以是安全敏感配置：

- 管理端：`domain` 只接受主机名（无协议、端口、路径）；`scopeId` 校验格式；保存前「测试连接」请求 `public-info`，返回的 `scopeId` 必须等于所填、`chainId` 必须等于所选链，否则拒绝保存——配成别的租户的平台，当场就发现。
- 修改走现有审计日志。
- App 端同样断言 `public-info.scopeId == services.predict.scopeId` 且 `chainId` 相符，不符不启用。

**环境隔离。** anyfun 是生产租户，有真实用户。联调时如果把它的 `services.predict` 指向 dev 平台并打开预测模块，生产用户就会看到 dev 市场。有了显式关联，正确做法很直接：

1. 在 RN-Server 新建一个 dev 租户（新 id，域名如 `api-dev.anyfun.win`），出一个 dev App 包（`tenants/anyfun-dev/tenant.json`），管理端给它配 `domain = predict.prax1s.xyz`、`scopeId = 0xfb05…454a`、`chain = op-sepolia`。不需要平台做任何事。**推荐。**
2. 或者让平台把 anyfun 的平台域名 `predict.predict.kim` 部署起来，直接用生产租户对接，联调即上线预演。

## 4. 工作量（单人，App 为主）

| 阶段 | 内容                                                                                                   | 估时   |
| ---- | ------------------------------------------------------------------------------------------------------ | ------ |
| 0    | 平台侧准备：确认租户域名、给测试地址铸 USDC（dev 的 relayer 白名单已含 USDC）                          | 半天   |
| 1    | 三端 `services.predict` 下发 + 管理端页面（含测试连接）+ schema                                        | 1–2 天 |
| 2    | `predict-platform` client：租户头、public-info、登录 / 刷新、relayer、Safe/MultiSend 编码、ClobAuth/L2 | 4–5 天 |
| 3    | 链层任意合约调用 + 转入（A/B）+ faucet                                                                 | 2–3 天 |
| 4    | 转出两阶段 + 待领取列表 + 模型改动 + 划转页改造                                                        | 3–4 天 |
| 5    | 启用引导页 + 启用流程（4 步、可续做）+ 凭证存储 + 登出 / 重装 / 配置变化清理                           | 3–4 天 |
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
| 服务地址与租户关联   | **管理端维护、RN-Server 随 bootstrap 下发**：开启预测模块时填接口域名 + 平台 scopeId + 链，存在租户应用配置里；不假定两边租户 id 相同；测试连接与 App 双向校验（§3.8）                                                              |
| 主网 `unwrapDelay`   | 主网当前 7200 秒。**App 不配置这个值，也不经 RN-Server 下发**：发起解包时直接用链上事件返回的 `claimableAt`，展示前再读一次 `wrapper.unwrapDelay()`；平台改了参数 App 自动跟上，两边永远一致。RN-Server 只下发 `services.predict`。 |

## 7. 待办（不阻塞开工）

-1. 联调用哪个租户：建议 RN-Server 新建 dev 租户 + dev App 包，配置关联到 prax1s（§3.8 路 1）；生产租户 anyfun 不指向 dev 平台。0. 转入路径 B 要显示 EOA 里的 USDW：租户目录里加 USDW（`0x790e…6098`，6 位）这一条，管理端上币即可，不是代码改动。

1. 主网接入时让平台把 Monad 的 `USDC_UNDERLYING` 加进 relayer 白名单，否则转出第二阶段必败（平台自己的主网部署文档也标注要手工加；dev 已经有）。
2. 主网 `unwrapDelay` 目前 2 小时：用户不会盯两小时倒计时，主网接入时要做"可以领取了"的推送（走现有推送链路，由 App 在发起解包成功后向 RN-Server 登记一条定时提醒，或本地通知）。

## 8. 对抗评审记录（第二轮，2026-09-02）

逐条攻击方案里的假设，结论与改动：

| 攻击点                                             | 结论                                                                      | 改动                                                                 |
| -------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| "CLOB 密钥等同私钥"                                | 不成立：clob 对每笔订单验 EOA 的 EIP-712 签名，密钥单独泄露只能撤单、看账 | §2.3 改为"账户级敏感"，并注明阶段 6 订单的 maker / signer 结构       |
| 无上限授权 wrapper                                 | 网页版是无上限；wrapper 出事时 EOA 里的 USDC 会被整个拿走                 | §2.5 改为按本次金额授权                                              |
| 服务端先上 `services` 段会不会打坏旧 App           | 不会：bootstrap 根对象丢弃未知键（已核对 schema）                         | §3.2 写明发布顺序                                                    |
| 限流按 IP，手机走运营商 NAT                        | 成立，且是上量后的必然故障                                                | §3.5 列出实际数字，接入前要平台按租户放宽；我们压低轮询、对 429 退避 |
| 待领取列表依赖子图                                 | 成立：索引延迟会让刚发起的转出"消失"                                      | §3.5 / §3.7 加乐观记录合并                                           |
| 进模块就连弹四个签名                               | 对外部钱包用户体验差、且不合"告知后签名"的原则                            | §3.4 加启用引导页与协议展示，保留"进模块时触发"                      |
| 卸载重装后 keychain 里的凭证复活                   | iOS 会                                                                    | §3.3 首次启动无钱包即清预测凭证                                      |
| `services.predict` 运行中改动                      | 会把旧凭证发到新平台                                                      | §3.3 视为换平台，清凭证重启用                                        |
| 两个 RPC 来源（我们下发的与 `public-info.rpcUrl`） | 违反单一来源                                                              | §3.3 只用我们下发的                                                  |
| 网页与 App 共用 Safe 的 nonce 竞争                 | 会发生                                                                    | §3.6 加验收项 9                                                      |
| 大整数 `scopeId` 在外部钱包的 typed data 实现      | 未验证，是已知的兼容坑                                                    | §3.6 加验收项 8                                                      |
| 平台租户过期                                       | `public-info` 403，原方案没写                                             | §3.5 / §3.7                                                          |
| 持仓按地址公开                                     | 平台设计，无法改                                                          | §3.5 写进用户说明                                                    |

未被推翻的核心结论：直连、一个域名派生服务地址、显式 scopeId 关联、`unwrapDelay` 以链上为准、转出两阶段。
