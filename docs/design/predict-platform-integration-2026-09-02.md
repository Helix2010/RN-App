# 接入 pm-cup2026 预测市场平台：登录与资金转入 / 转出

- 状态：已决策（§4），待立项。全部改动为纯 JS，不引入原生依赖，可随 OTA 发布
- 对象：`~/fy/work/pm-cup2026`（`apps/user-dapp` + `services/gamma|clob|data|relayer|faucet`）；dev 环境 `https://predict.prax1s.xyz`
- 关联：ADR 0007（`createGateways(bootstrap.services)`）、`AGENTS.md`「租户身份与外部系统的对应」「正式场景开发原则」
- 依据：每条事实后面标注来源。`文件:行` 指 pm-cup2026 仓库；"实测"指 2026-09-02 对 dev 环境或链上的直接调用。没有来源的句子是我们自己的设计决定

## 1. 结论

1. 平台侧零改动。user-dapp 的 Next.js 层只转发，业务接口可被原生客户端直连（`docs/design-docs/cex-dapp/README.md` 记录了同样的接入方式）。App 直连，RN-Server 只下发租户级配置。
2. 登录是 EIP-712 `LoginMessage` 换 gamma JWT，不是 SIWE（`services/gamma-service/internal/auth/eip712.go:26-29`）。
3. 资金放在每个 EOA 对应的 Safe 里，交易余额 = Safe 的 USDW（`apps/user-dapp/src/hooks/useOnChainBalance.ts:111-122`）。转入由用户付 gas；转出经 relayer 免 gas、分两阶段。
4. 我们的 `PredictGateway` 契约要改 `deposit`（两笔需要 gas 的交易）与 `withdraw`（发起 + 领取）；其余接口可映射。
5. dev 在 OP Sepolia（11155420，实测 `public-info`），anyfun 已启用该链，目录里的 USDC 就是平台的 `USDC_UNDERLYING`（实测 bootstrap 与 `public-info` 地址一致 `0x2eA6…c3AD`）。

## 2. 平台事实

### 2.1 租户与配置

| 项       | 事实                                                                                                                                                                                                                | 来源                                                       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 租户识别 | 请求头 `X-Tenant-Domain`，缺省用 `Host`；未知域名落到租户 0，不报错                                                                                                                                                 | `gamma-service/internal/middleware/middleware.go:157-229`  |
| 服务地址 | 由租户域名派生：`gamma-api.` `clob-api.` `data-api.` `relayer.` `clob-ws.` `faucet.` `{domain}`；非本地一律 https / wss                                                                                             | `apps/user-dapp/src/lib/serviceUrls.ts:120-142`            |
| 配置入口 | `GET {gamma}/public-info` → `scopeId`、`chain`（chainId / rpcUrl / explorer / tokens / contracts）、`contracts`、`loginStatement`、`walletConnectProjectId`、`agreements`；租户过期 403                             | `gamma-service/internal/handlers/public_info.go:18-56,128` |
| dev 实值 | chain 11155420；USDW `0x790e…6098`、USDC `0x2eA6…c3AD`（均 6 位）；CTF_EXCHANGE `0xB6C9…6c2b`；SAFE_FACTORY `0x08C3…5Fe6`；MULTI_SEND `0xA238…7761`；USDW_WRAPPER `0x7deB…F740`；scopeId `0xfb05…454a`；bridge 关闭 | 实测                                                       |

### 2.2 登录（gamma-service）

```
GET  {gamma}/auth/nonce?address=0x…   → { nonce, scopeId, issuedAt, chainId, statement }
签名  EIP-712  domain { name:"PredictMarket", version:"1", chainId }（无 verifyingContract）
      LoginMessage(address wallet, string nonce, uint256 scopeId, string issuedAt,
                   string domain, string uri, uint256 chainId)
POST {gamma}/auth/login  { signature, messageParams:{ address, nonce, scopeId, issuedAt, domain, uri, chainId } } → { token }
POST {gamma}/auth/refresh   Authorization: Bearer → { token }
```

| 事实                                                                                  | 来源                                                                                   |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 路由只有 nonce / login / refresh / jwks；无 logout、无 `/me`                          | `gamma-service/internal/handlers/router.go:43-48`                                      |
| nonce 存 Redis，TTL 300 秒；验签之前就核销，失败要重取                                | `internal/auth/nonce.go:36-64`、`config/config.go:250`、`handlers/auth.go:337-341`     |
| `scopeId` 按 `uint256` 签、按 0x-hex 传                                               | `useSetupSteps.ts:248`、`eip712.go:121-122`                                            |
| `messageParams.domain` 反查 `tenant_domain`，必须是该租户登记的域名                   | `handlers/auth.go:393-401`                                                             |
| JWT RS256；`sub` = 小写 EOA，`scope_id`、`uid`、`owner`；默认 24 小时，dev 实测 30 天 | `internal/auth/jwt.go:17-44`、`config/config.go:249`、实测                             |
| 首次登录建 `predict_users` 行，异步算 Safe 地址                                       | `handlers/auth.go:433-459,169-191`                                                     |
| 实测                                                                                  | 一次性密钥 nonce → 签名 → login 200；JWT 查 relayer `/deployed` 返回未部署的 Safe 地址 |

### 2.3 三层凭证

| 层                      | 用途                                                                                             | 获取                                                                                                                                                                                                    | 来源                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| gamma JWT               | relayer 提交、bridge、资料                                                                       | §2.2                                                                                                                                                                                                    | —                                                                                                   |
| CLOB API key（L2 HMAC） | 撤单、余额可用额度、成交、用户 WS；下单请求也带它，但订单本身另有 EOA 的 EIP-712 签名，clob 验签 | L1：签 `ClobAuth`（domain `{name:"ClobAuthDomain",version:"1",chainId}`）→ `POST {clob}/auth/api-key`，头 `PRED_ADDRESS/SIGNATURE/TIMESTAMP/NONCE` + `PRED_SCOPE_ID` → `{ apiKey, secret, passphrase }` | `useSetupSteps.ts:43-59,469-521`；验签 `clob-service/internal/dispatch/match_dispatcher.go:885-899` |
| Safe 授权               | 交易所能动 Safe 里的 USDW / CTF                                                                  | relayer 转发一笔 MultiSend：`USDW.approve × 4` + `CTF.setApprovalForAll × 3`                                                                                                                            | `useSetupSteps.ts:536-684`                                                                          |

- L2 签名：`base64(HMAC-SHA256(base64url解码(secret), ts + METHOD + path + body))`，±30 秒，时间取 `GET {clob}/time`（`apps/user-dapp/src/lib/hmac.ts:58-84`、`clob-service/internal/tradingapi/middleware/auth.go:26,52-58`）。
- clob-service 没有租户中间件；租户身份在建 key 时由 `PRED_SCOPE_ID` 绑进密钥，对平台可选（`handlers/auth.go:37`）。对我们必填。
- 订单：`maker` = Safe、`signer` = EOA（`apps/user-dapp/src/hooks/useOrderSigning.ts:33-34`）；`signatureType` 枚举 EOA / PolyProxy / PolyGnosisSafe（`clob-service/internal/shared/types/order.go:34-46`）。阶段 6 用。

### 2.4 代理钱包（Safe）

| 事实                                                                                                                                                                               | 来源                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 地址 = CREATE2，salt = `keccak256(abi.encode(eoa, scopeId))`，部署前可算                                                                                                           | `gamma-service/internal/safe/safe.go:205-223`、`contracts/proxy-factories/.../SafeProxyFactory.sol:62-70` |
| `GET {relayer}/deployed?signer=&scopeId=` → `{ deployed, address }`，未部署返回预测地址                                                                                            | `relayer-service/internal/api/handler.go:450-494`；实测                                                   |
| 部署：签 `CreateProxy`（domain `{name:"Polymarket Contract Proxy Factory", chainId, verifyingContract: factory}`）→ `POST {relayer}/submit type=SAFE-CREATE` → 轮询 `/transaction` | `useSetupSteps.ts:32-41,319-458`                                                                          |
| 单 owner（EOA）、阈值 1                                                                                                                                                            | `SafeProxyFactory.sol:94-98`                                                                              |

### 2.5 资金转入（用户付 gas）

| 路径                  | 链上动作                                                                                     | 来源                                                                  |
| --------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| A：EOA 的 USDC → Safe | `USDC.approve(USDW_WRAPPER, …)` → `USDWrapper.wrap(USDC, amount, safe)`，1:1 铸 USDW 到 Safe | `wrapUsdc.ts:53-112`、`contracts/wusd/src/USDWrapper.sol:133-150`     |
| B：EOA 的 USDW → Safe | `USDW.transfer(safe, amount)`                                                                | `transferUsdw.ts:26-58`                                               |
| C：跨链（Relay）      | `GET /bridge/assets`、`POST /bridge/quote`、`POST /bridge/requests`、轮询（JWT）             | `apps/user-dapp/src/lib/bridge/relay.ts`；dev `enabled=false`（实测） |

- 网页版的授权额度是 `MaxUint256`（`wrapUsdc.ts:53-77`）。
- 测试网 faucet：`GET/POST {faucet}/api/v1/faucet/{status,claim}`（JWT），条件是 Safe 已部署且 USDC 余额高于配置下限（`faucet-service/internal/service/faucet.go:20-25,64-90,137-138`）；dev 实测每人 `0.001` TETH。

### 2.6 资金转出（relayer 免 gas，两阶段）

```
阶段 A  GET {relayer}/nonce?address={safe}
        签 SafeTx（domain { chainId, verifyingContract: safe }，无 name/version）
        to = MULTI_SEND, operation = 1, data = [ USDW.approve(wrapper, amt), wrapper.initiateUnwrap(amt, USDC) ]
        POST {relayer}/submit type=SAFE → 轮询 /transaction → 事件 UnwrapInitiated(requestId, claimableAt)
等待    unwrapDelay
阶段 B  SafeTx MultiSend：[ wrapper.claimUnwrap(requestId), USDC.transfer(recipient, amount) ]
待领取  GET {data}/unwrap-requests?safe=&claimed=false
```

| 事实                                                                                                                                                                       | 来源                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 阶段 A / B 的构造与轮询                                                                                                                                                    | `initiateUnwrap.ts:93-259`、`claimUnwrap.ts:66-140`                                    |
| 合约：`initiateUnwrap` 烧 USDW、记 `claimableAt = now + unwrapDelay`；`claimUnwrap` 把 USDC 给 `msg.sender`（即 Safe）；1:1 无手续费；`unwrapDelay` 上限 30 天，owner 可改 | `USDWrapper.sol:26,157-199`                                                            |
| 收款地址：合约层面 USDC 先回到 Safe，第二个子调用 `USDC.transfer` 的收款人由客户端填；网页版填的是当前连接的 EOA                                                           | `claimUnwrap.ts:68,121`                                                                |
| `unwrapDelay` / `minUnwrapUsdw` 网页版从链上读                                                                                                                             | `useUsdwOnchainConfig.ts:29-55`                                                        |
| dev：60 秒、最小 0.001 USDW；主网 Monad wrapper `0x119E…D2c1`：7200 秒、最小 0.001 USDW                                                                                    | 实测 `eth_call`                                                                        |
| relayer 校验 `from == JWT.sub`、`scopeId == JWT.scope_id`、MultiSend 内每个目标在白名单；USDW 与 wrapper 自动加白，底层 USDC 要配置                                        | `relayer-service/internal/api/handler.go:247-330`、`internal/config/config.go:216-229` |
| dev 的 relayer 白名单已含 OP Sepolia USDC                                                                                                                                  | `services/relayer-service/config.yaml:58-65`                                           |
| 待领取列表来自子图                                                                                                                                                         | `data-service/internal/handlers/unwrap_requests.go:38-96`                              |
| 跨链转出接口存在、网页未接入                                                                                                                                               | `gamma-service/internal/handlers/router.go:102-110`；`apps/user-dapp/src` 无引用       |

### 2.7 余额与行情

| 项                 | 事实                                                                                                                                                    | 来源                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 交易余额           | RPC 直读 `USDW.balanceOf(safe)`                                                                                                                         | `useOnChainBalance.ts:111-122`                                                                          |
| 可用 / 冻结        | `GET {clob}/balance-allowance?asset_type=COLLATERAL`（L2）→ `{ balance, allowances, virtual_available, locked }`；服务端按 EOA + scopeId 算 Safe 再读链 | `useBalance.ts:37-71`、`clob-service/.../handlers.go:2087-2124`                                         |
| 持仓 / 活动 / 盈亏 | data-service 全部公开 GET，按 `user=` 查                                                                                                                | `data-service/internal/handlers/router.go`                                                              |
| 行情               | clob 公开 REST；`wss://clob-ws.{domain}/ws/market` 无鉴权，订阅帧 `{ assets_ids, level }`；`/ws/user` 首帧带 L2 三元组                                  | `clob-service/internal/wsservice/server.go:37-39`、`market_channel.go:128-138`、`user_channel.go:27-38` |

### 2.8 限流（仓库配置值，线上未核实）

gamma 每 IP 60 秒 120 次（`gamma-service/config.yaml:58-63`）；relayer 每 IP 每小时 1000 次、`/submit` 100 次、`SAFE-CREATE` 10 次（`relayer-service/config.yaml:75-77`）。

## 3. 我们的方案

### 3.1 现状对应

| 我们             | 现在                                                                    | 接入后                                                              |
| ---------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 会话             | SIWE → RN-Server `wallet_session`                                       | 保留；gamma JWT 是第二套凭证，按需获取、绑定地址                    |
| 钱包             | vault `signMessage / signTypedData / submitTransaction` + WalletConnect | 复用；EIP-712 全部由现有签名器完成                                  |
| 链层             | `OnchainTransfers` 只会 ERC-20 / 原生转账                               | 加合约调用（approve / wrap / transfer / MultiSend 编码）            |
| `PredictGateway` | Mock                                                                    | 新增 `HttpPredictGateway`，按 ADR 0007 由 `bootstrap.services` 选择 |
| 预测账户余额     | Mock                                                                    | Safe 的 USDW + clob `virtual_available / locked`                    |
| 划转页           | 钱包 ⇄ 预测账户，秒到                                                   | 转入两笔交易要 gas；转出两阶段、有延迟                              |
| 模块开关         | `modules.predict`                                                       | 不变；加 `services.predict`                                         |

### 3.2 架构与下发

App 直连平台，RN-Server 只下发租户级配置：

```json
"services": {
  "predict": {
    "domain": "predict.prax1s.xyz",
    "scopeId": "0xfb05…454a",
    "chain": "op-sepolia"
  }
}
```

- 三个字段都由管理端在开启预测模块时填写。RN-Server 租户 id 与平台租户 id 不假定相同（线上四个租户两边 id 与 scope_id 恰好一致，实测 `rn` 与 `pm` 两库；这是现状不是规则），关联只靠这条配置；不读平台的库。
- `domain` 只接受主机名；App 按 §2.1 的规则派生服务地址，强制 https / wss；不提供逐个服务的覆盖。
- `scopeId` 格式 `^0x[0-9a-f]{64}$`；`chain` 是本租户启用的链之一。
- 服务端：`modules.predict = true` 时 `services.predict` 必须完整合法，否则 bootstrap 503；`= false` 时不下发该段。
- 管理端「预测市场」页：开关 + 域名 + scopeId + 链 + 「测试连接」——服务端请求 `public-info`，回显品牌、chainId、scopeId，scopeId 须等于所填、chainId 须等于所选链，否则不允许保存；修改进审计日志。
- App：`services.predict` 段严格解析；拿到 `public-info` 后断言 scopeId 与 chainId 相符，不符不启用并留痕。bootstrap 根对象不是 strict（`src/core/config/bootstrap.schema.ts:113`，未知键丢弃），服务端先上该段不会打坏旧 App；发布顺序服务端 → 管理端 → App，`modules.predict` 在 App 发布前保持关闭。

### 3.3 App 侧模块与凭证规则

```
src/core/predict-platform/
  tenant-client.ts   每个请求带 X-Tenant-Domain；派生子域
  public-info.ts     严格 zod；scopeId / chainId 断言
  auth.ts            nonce → LoginMessage 签名 → JWT；exp 前 5 分钟刷新；绑定地址
  relayer.ts         deployed / nonce / submit / transaction 轮询
  clob-auth.ts       ClobAuth 签名、L1 头、L2 HMAC
  safe.ts            SafeTx / CreateProxy 类型、MultiSend 编码
  contracts.ts       ERC20 / USDWrapper / CTF ABI 片段
src/features/predict/api/http-predict-gateway.ts
src/features/predict/model/predict.ts   PredictTx 加 claimableAt / requestId；新增 PendingWithdrawal
```

- HMAC、keccak、ABI 编码用已有依赖（`@noble/hashes`、ethers）。
- 凭证（gamma JWT、CLOB 三元组、Safe 地址）存 `expo-secure-store`，键 `tenantDomain + scopeId + address`。切换账户 / 登出即清。首次启动发现本机没有钱包时清掉预测凭证（iOS keychain 卸载后仍在）。
- `services.predict` 任一字段在运行中变化：清该租户全部预测凭证，下次进模块重新启用；`modules.predict` 关掉只隐藏入口。
- 读链只用我们下发的 `rpcUrlsFor(chain)`，不用 `public-info.rpcUrl`。
- 地址比对不区分大小写（JWT `sub` 小写，本地存 EIP-55）。
- 下单超过大额阈值走现有 `useRequireVerification`。

### 3.4 用户流程

**游客**：未登录可浏览行情与市场，公开接口只需 `X-Tenant-Domain`。

**启用（已登录用户进入预测模块时触发）**：先出一页「启用预测交易」，说明要签什么、钱放在哪、转出规则，展示平台协议（`GET {gamma}/agreements`），一个按钮跑完四步，另有「稍后」可先看行情。

| 步  | 做什么                                        | 签什么         | gas     | 频率           |
| --- | --------------------------------------------- | -------------- | ------- | -------------- |
| 1   | 登录换 JWT                                    | `LoginMessage` | 无      | JWT 过期后重签 |
| 2   | 部署 Safe（`deployed` 为真则跳过）            | `CreateProxy`  | relayer | 一次           |
| 3   | 申请 CLOB API key                             | `ClobAuth`     | 无      | 一次           |
| 4   | Safe 的 7 个授权（链上 allowance 已有则跳过） | `SafeTx`       | relayer | 一次           |

内置钱包四次签名在同一个解锁窗口内（`keystore-vault.ts` `DEFAULT_UNLOCK_TTL_MS` 5 分钟），只弹一次生物验证；外部钱包每次在钱包里确认。每步完成写本地状态；重进按 `deployed` 与链上 allowance 实查对齐，不信本地缓存。

**转入**（方向"钱包 → 预测账户"）：显示 EOA 的 USDC 与 USDW 余额；USDC 走路径 A，USDW 走路径 B。授权按本次金额，不用 `MaxUint256`（网页版的做法会让 wrapper 一旦出事拿走 EOA 里全部 USDC）。签名前检查原生币够 gas，不够走现有 `InsufficientGasError`；测试网加「领取测试 gas」（faucet）。进度用现有 `TxProgress`。

**转出**（方向"预测账户 → 钱包"）：收款人固定为登录的 EOA（与网页版一致；合约不限制，我们不开放任意地址）。提交 = 阶段 A；成功后显示 `claimableAt` 倒计时；待领取列表 = 本机乐观记录（requestId、claimableAt、金额）与 data-service 列表按 requestId 合并，服务端出现后以服务端为准；到期出现「领取」= 阶段 B。文案写清"先解锁再到账"。

### 3.5 安全与运维要点

- `X-Tenant-Domain` 漏发不报错、落到租户 0：统一在一个 client 里加，测试逐请求断言。
- 登录 `domain` 只能签平台登记的域名，用 `services.predict.domain`。
- 主网 relayer 白名单要含 Monad 的 `USDC_UNDERLYING`（平台主网部署文档 `docs/deploy/2026-08-27-mainnet-upgrade-steps.md:218-226` 要求手工加）；dev 已有。
- 限流按 IP（§2.8）：手机用户经运营商 NAT 共用出口 IP，上量会撞线。接入前要平台按租户放宽或按 JWT 计数；我们的轮询：relayer 交易状态 3 秒到终态即停，余额 15 秒，待领取 30 秒；429 退避不重试风暴。
- 转入需要原生币；主网上提前提示。
- data-service 的持仓、活动按地址公开可查（`router.go` 无鉴权）：写进用户可见说明。
- 平台仓库根目录有 JWT 私钥 `gamma-jwt-private.pem`：联调时不要把它带进日志或文档。

### 3.6 联调环境与验收

| 项         | 值                                                                                   |
| ---------- | ------------------------------------------------------------------------------------ |
| 平台租户   | prax1s（平台 100000000，不在 `rn` 库）；域名 `predict.prax1s.xyz`                    |
| 我们的租户 | 新建 dev 租户 + dev App 包，配置关联 prax1s；生产租户 anyfun 不指向 dev（§5 待办 1） |
| 链         | OP Sepolia 11155420                                                                  |
| 测试 USDC  | `0x2eA6…c3AD` 有公开 `mint(address,uint256)`，任意地址可给自己铸（实测 `eth_call`）  |
| 测试 gas   | 任意 OP Sepolia 水龙头，或平台 faucet（§2.5）                                        |
| 转出参数   | 60 秒、最小 0.001 USDW（实测）                                                       |

验收：

1. 已登录用户进入预测模块 → 引导页 → 四步一次完成；杀 App 重进不再弹签名；换地址重新触发。
2. 转入 1 USDC：首次两笔（approve、wrap），第二次仍两笔（按额授权）；Safe 的 USDW +1，EOA 的 USDC −1。
3. 转出 0.5 USDW：阶段 A 后"解锁中"，60 秒后「领取」可点；领取后 EOA 的 USDC +0.5，列表清空。
4. 转出 0.0001 USDW：提交前拦下。
5. gas 不足：转入按钮前置提示，不进签名。
6. relayer 返回 `STATE_FAILED`：显示失败，不静默重试。
7. 所有请求录制成夹具，逐条检查 `X-Tenant-Domain`。
8. 外部钱包（MetaMask / OKX 移动端）走完四步；重点看 `uint256 scopeId` 的 `eth_signTypedData_v4`。
9. 网页版与 App 同一地址并发发 Safe 交易：后发的一笔要么取到新 nonce 成功，要么失败可重试。
10. 发起解包后立刻杀 App 再进：乐观记录先出现，子图追上后不重复。

### 3.7 失败与边界

| 场景                                                        | 处理                                                        |
| ----------------------------------------------------------- | ----------------------------------------------------------- |
| JWT 过期或 `sub` ≠ 当前地址                                 | 先 `refresh`，失败重走登录；切换地址清全部预测凭证          |
| nonce 用过 / 过期（`40101`）                                | 重取 nonce 再签                                             |
| `scopeId` 与租户不符（`40305`）、`public-info.chainId` 不符 | 视为配置错误，停用模块并留痕，不重试                        |
| relayer 403（白名单 / `from` / scopeId）                    | 显示平台原因，提示联系平台，不重试                          |
| relayer `STATE_FAILED` / `STATE_INVALID`                    | 该笔作废；重取 Safe nonce 再发起                            |
| 同一 Safe 多笔 SafeTx                                       | 串行；每笔前实时取 nonce，前一笔未 `STATE_MINED` 不发下一笔 |
| L2 时钟偏差                                                 | 每次签名前 `GET {clob}/time` 校准                           |
| CLOB 密钥被吊销（401）                                      | 重走 `ClobAuth`                                             |
| 低于 `minUnwrapUsdw` / 原生币不够 gas                       | 提交前拦截                                                  |
| 转出发起后 App 被杀                                         | 乐观记录 + data-service 合并，重进即恢复                    |
| 限流 429                                                    | 指数退避最多 3 次，界面"稍后再试"                           |
| `services.predict` 运行中被改                               | 清预测凭证，下次进模块重新启用                              |
| 平台租户过期（`public-info` 403）                           | 模块不可用提示                                              |

## 4. 决策记录（2026-09-02）

| 问题                 | 决定                                                                                                                                                       |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 先接哪条链           | 先调通测试网（OP Sepolia，dev `predict.prax1s.xyz`）；主网接入后续做。Monad（143）已预先加进三端链目录（`docs/changes/2026-09-02-feature-monad-chain.md`） |
| 直连还是经 RN-Server | 直连；RN-Server 只下发 `services.predict`                                                                                                                  |
| 租户关联             | 管理端开启预测模块时填接口域名 + 平台 scopeId + 链；不假定两边租户 id 相同；测试连接与 App 双向校验                                                        |
| 启用流程时机         | 已登录用户进入预测模块时（经引导页）；未登录先走现有登录 sheet                                                                                             |
| `unwrapDelay`        | 以链上为准（事件 `claimableAt`、`wrapper.unwrapDelay()`），不配置、不经 RN-Server 下发                                                                     |

## 5. 待办

实现状态（2026-09-02）：阶段 1–5（服务端下发、管理端、App 平台客户端、账户网关、启用 / 划转界面）已落地，见 `docs/changes/2026-09-02-feature-predict-account-real.md`；阶段 6（行情 / 下单 / 持仓）未开始。

对照 §3.3 / §3.4 / §3.7 逐条核对（2026-09-02 晚）后补齐的偏差，均有 spec：

| 设计条目                                            | 核对结果                                                                                                                                                                       | 落点                              |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------- |
| §3.7 限流 429 指数退避最多 3 次                     | 原实现直接抛错 → 已改为 500 / 1000 / 2000 ms 三次重试后再抛                                                                                                                    | `tenant-client.ts`                |
| §3.7 nonce 已核销（40101）重取再签                  | 原实现不重试 → 登录收到 401 + `40101`（`types.go:14`）重取 nonce 再签一次                                                                                                      | `auth.ts`                         |
| §3.7 CLOB 密钥被吊销（401）重走 ClobAuth            | 原实现把 401 当普通错误 → L2 401（`middleware/auth.go:95`）丢掉本地密钥，启用状态回到"缺 CLOB 密钥"，由用户在引导页重签，不在读余额时替用户签名                                | `http-predict-account-gateway.ts` |
| §3.3 重装后首次启动清预测凭证                       | 未实现 → 普通存储里的安装标记不在即清安全存储里的全部凭证                                                                                                                      | 同上                              |
| §3.7 同一 Safe 多笔 SafeTx 串行                     | 未实现 → 按 Safe 排队，前一笔到终态才取下一笔 nonce                                                                                                                            | 同上                              |
| §3.4 启用页展示平台协议（`GET {gamma}/agreements`） | 未实现 → 客户端 `agreements.ts`（字段按 `public_info.go:48-56`，多语言取法照 `pickTranslation.ts`，接受记录本机按 scopeId，`required` 版本不符即待接受）；引导页接入见变更记录 | `agreements.ts`                   |
| §3.4 启用四次签名一个解锁窗口                       | 已满足：`keystore-vault.ts` `unlock()` 缓存 5 分钟                                                                                                                             | 无改动                            |
| §3.7 `STATE_FAILED` 作废、重取 nonce 再发           | 已满足：每笔提交前实时取 nonce，失败原样抛出不重试                                                                                                                             | 无改动                            |

深度评审（2026-09-02 晚，对照平台源码逐条核实）后修掉的实现缺陷：读不到的代币余额不再当 0（查询失败就是错误）；划转金额与输入精度改从平台代币的 `decimals` 取，不再写死 6，按比例取整走 bigint；`withdraw` 在读日志前先等我们自己的节点看到回执，不把节点落后误报成"没有事件"；待领取合并同时问 `claimed=false/true` 两个列表（data-service 按 `claimed` 精确筛，只问未领的话网页版领掉的那笔永远删不掉本机记录）；转入与报价受租户 `wallet.onchainSends` 门禁（`PredictChainUnavailableError`）；报价按 approve 费 + wrap 4 倍上界；配置错误（关联缺失、scopeId / chainId 不符、403、429）在 react-query 层不重试（`predictRetry`）；启用状态在进程内缓存，不再每次轮询都问 relayer `/deployed` 与 7 次 eth_call；登出时钥匙串清理失败不阻断登出；`services.predict` 缺失时资产页只把预测账户标为不可用；CLOB derive 只把 404 当"第一次"，其它错误原样抛；relayer 提交体去掉服务端不收的 `metadata`。

平台侧的两个隐患（App 不能单方面解决，联调前先与平台确认）：

- 登录 EIP-712 域名 `name: "PredictMarket"` 是 gamma 的配置项 `app_name`（`gamma-service/internal/config/config.go:90-91`，默认值 `:251`），**不在 `public-info` 里**。部署把它改掉，所有登录签名都会验签失败且 App 无从发现。要么平台在 `public-info` 暴露它，要么当作部署硬约束写进运维手册。
- CLOB 密钥的 `secret`：网页版与 App 都按 base64url 解码（`user-dapp/src/lib/hmac.ts:23-33`），服务端按标准 base64 解（`clob-service/.../middleware/auth.go:54-58`），只在 secret 不含 `-` / `_` 时一致。
- `USDC_UNDERLYING` / `USDW_WRAPPER` 不是服务端定义的合约名，只是 user-dapp 的查找键（`user-dapp/src/lib/contracts.ts:72-73`），要在平台管理端作为自定义合约行手工添加；缺了 App 报 `PredictPlatformContractMissingError`，不启用。

1. 联调租户：RN-Server 新建 dev 租户 + dev App 包，关联 prax1s。库里目前只有 anyfun（100000001）有 App 包与 bootstrap 配置；`test` 租户（100000003）没有域名 / 包。写库脚本已备好（scratchpad `link-prax1s.sh`：给 anyfun 写 `services.predict` 指向 prax1s、目录加 USDW、`modules.predict` 保持 false），需运维在 web4 执行；开模块前先发新版 App，否则老包会显示 Mock 预测市场。
2. 转入路径 B 要显示 EOA 的 USDW：租户目录上 USDW（`0x790e…6098`，6 位），管理端操作。
3. 主网前：平台把 Monad 的 `USDC_UNDERLYING` 加进 relayer 白名单；确认主网限流按租户放宽。
4. 主网 `unwrapDelay` 2 小时：做「可以领取了」提醒（现有推送链路登记定时提醒，或本地通知）。

## 6. 工作量（单人）

| 阶段 | 内容                                                                                                       | 估时   |
| ---- | ---------------------------------------------------------------------------------------------------------- | ------ |
| 0    | 平台侧准备：租户域名确认、给测试地址铸 USDC                                                                | 半天   |
| 1    | 三端 `services.predict` 下发 + 管理端页面（含测试连接）+ schema                                            | 1–2 天 |
| 2    | `predict-platform` client：租户头、public-info、登录 / 刷新、relayer、Safe / MultiSend 编码、ClobAuth / L2 | 4–5 天 |
| 3    | 链层合约调用 + 转入（A / B）+ faucet                                                                       | 2–3 天 |
| 4    | 转出两阶段 + 待领取列表 + 模型改动 + 划转页改造                                                            | 3–4 天 |
| 5    | 启用引导页 + 四步流程（可续做）+ 凭证存储与清理                                                            | 3–4 天 |
| 6    | `HttpPredictGateway` 其余读接口（行情 / 持仓 / 活动 / WS）                                                 | 4–6 天 |
| 7    | 测试（录制 dev 响应做夹具）、联调、文档                                                                    | 3 天   |

阶段 1–5 约 3 周；整个预测模块约 4–5 周。
