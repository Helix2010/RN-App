# 钱包链上收款记录：独立扫链模块设计（2026-09-06）

> 结论：在 RN-Server 仓库内新增独立进程 `cmd/indexer`（同镜像、不同启动命令、单实例租约），按链轮询平台指定的 RPC 端点，用 `eth_getLogs` 索引目录内 ERC-20 的双向转账、用 Multicall3 余额差 + 定界扫块索引原生币入账，落 `wallet_transfer_index` 表；App 通过 `GET /v1/mobile/wallet/transfers` 读取并与本机转出账本合并。浏览器 API（Etherscan V2）和客户端扫链两个替代方案分析在 §3，均不采用。

## 1. 现状与目标

**现状**（`RN-App/src/features/wallet/api/embedded-wallet-gateway.ts:545-553`）：`listTransfers` = 本机转出账本（`onchain-transfers.ts`，已落存储 `foundation.wallet.sends.v1`）∪ Mock 账本；打到地址上的入账没有任何来源。记录页"钱包转账"Tab 只有本机发起的转出。

**目标**：

- 用户在任意已启用链上收到原生币或目录内代币，记录页出现一条入账（哈希、对手方、金额、时间、状态），并收到推送；
- 同一地址在别的钱包软件发起的转出（导入私钥的情形）也能出现在记录里（ERC-20 双向；原生币转出见 §4.4 的限制）；
- 记录从地址在本平台首次登录起算；更早的历史通过已有的浏览器地址链接查看（`wallet-runtime-config.ts:248` `explorerAddressUrl`），不索引。

## 2. 事实（2026-09-06 本机实测 + 源码）

### 2.1 平台默认 RPC 端点对扫链的限制

`RN-Server/internal/api/server.go:771-778` 的 `supportedNetworks` 默认端点，用 `probe2.py` / `probe3.py`（scratchpad）实测：

| 链 | 出块 | `eth_getLogs` 仅按 topic | 带 `address`（代币合约）过滤 | 最大区块跨度 | topic 里 2000 个地址 | Multicall3 | 批量 JSON-RPC |
|---|---|---|---|---|---|---|---|
| bsc `bsc-dataseed.bnbchain.org` | 0.45s | `limit exceeded`（50 块也拒） | 同左 | **0，不可用** | — | 有 | 20 条 OK |
| bsc `bsc-rpc.publicnode.com`（备选） | — | 未测 | 5000 OK | ≥5000 | — | 有 | OK |
| eth `ethereum-rpc.publicnode.com` | 12s | 拒绝：`Please specify an address` | 100 OK；1000 → `Archive requests require…` | **100** | — | 有 | OK |
| base `mainnet.base.org` | 2s | 10000 OK | 5000 OK | 10000（20000 拒） | OK | 有 | 每批 ≤10 |
| op-sepolia `sepolia.optimism.io` | 2s | 5000 OK | 5000 OK | 5000（10000 拒） | OK | 有 | 20 条 413 |
| monad `rpc.monad.xyz` | **0.30s** | 100 OK | 100 OK | **100** | OK | 有 | OK |

Multicall3 = `0xcA11bde05977b3631167028862bE2a173976CA11`，五条链 `eth_getCode` 均非空。

推论：

- **BSC 平台默认端点无法扫链**，ETH 默认端点只能带合约地址、100 块以内。扫链端点必须单独配置（§4.2），不能复用 `supportedNetworks` 的默认值，也不能用租户自配的 `wallet.networks[].rpcUrls`（理由同 `tokens.go:568-573`："租户能配 RPC，就能配一个返回假数据的节点"）。
- Monad 100 块 = 30 秒链上时间，索引器每 30 秒至少要跑一轮才能不落后；这决定了轮询节奏（§4.3）。
- 原生币转账没有日志，`eth_getLogs` 不覆盖；Monad 每天 28.8 万个区块，逐块 `eth_getBlockByNumber(full)` 不可持续（§4.4 用余额差触发）。

### 2.2 Etherscan V2 覆盖

`GET https://api.etherscan.io/v2/chainlist`（2026-09-06）：1 / 56 / 8453 / 11155420 / 143 五条链均在列（共 61 条）。免费档 5 req/s、10 万次/天/密钥（官方公开限额，未在本机验证）。

### 2.3 RN-Server 已有的可复用部件

- JSON-RPC 客户端与端点核验：`internal/chain/reader.go`（`eth_chainId` 核对、`eth_call`、限时限量），扩展 `eth_getLogs` / `eth_getBlockByNumber` / `eth_blockNumber` 即可。
- 地址来源：`wallet_user(tenant_id, address, address_key)`（`migrations.go:212-226`），首次 SIWE 登录即写入（`wallet_auth.go:232`）。会话记录 `wallet_session.chains` 是登录时声明的链。
- 代币目录：`chain_token_catalog(chain, contract_address, decimals, enabled, tenant_id)`（`migrations.go:120-140`），`native` 表示原生币。
- 租户链配置：`app_configs` 的 `wallet.networks` / `onchainSends`（`server.go:841-1025`）。
- 后台进程与 outbox：`internal/push/dispatcher.go`（`app_push_outbox` 轮询投递），`cmd/server/main.go:47-56` 用 `PUSH_DISPATCH_ENABLED` 决定是否在 API 进程内启动；`docs/ARCHITECTURE.md` §7："worker 与 API 可以同仓、独立进程部署"。
- 移动端鉴权：`Authorization: Wallet <token>`（`wallet_auth.go:316-345` `authenticateWalletSession`），App 侧 `http-session-gateway.ts:148` 已带此头。
- 部署：单镜像 `./rn-server`（`Dockerfile:16`），`deploy/web4/compose.yaml` 一个 `server` 服务；`main.go:39-47` 已有 `migrate` 子命令先例。

### 2.4 推送的现状限制

`dispatcher.targets(ctx, tenant)`（`dispatcher.go:197-200`）按**租户**取全部有效安装的推送令牌，outbox 事件没有"发给某个地址"的概念；`app_installations` 与 `wallet_session` 之间没有关联列（`wallet_auth.go` 不读安装 id）。收款推送必须先补这条关联（§4.6）。

## 3. 方案比较

| | A. 独立扫链模块（推荐） | B. 浏览器 API（Etherscan V2） | C. App 端自扫 |
|---|---|---|---|
| 数据来源 | 平台指定 RPC 节点，链上事实 | 第三方索引，含内部交易与注册前历史 | 租户下发的 RPC |
| 原生币入账 | 余额差触发 + 定界扫块；合约内部转账只能记"来源未知"（§4.4） | `txlistinternal` 覆盖内部交易 | 同 A 但无后台 |
| 推送 | 有（§4.6） | 只能轮询才有 | 无 |
| 外部依赖 | 只要 RPC（BSC / ETH 要另配端点，§2.1） | 密钥 + 配额：5 req/s、10 万/天，按用户 × 链轮询不可持续，只能"打开页面时拉" | 无 |
| 一致性 | 表即唯一正式来源；重组回滚（§4.5） | 以对方为准，我们只是缓存 | 断网期间的入账要补扫：Monad 100 块上限，离线 1 天 = 2880 次请求，不可行 |
| 工作量 | 大（Go 模块 + 表 + 接口 + App 合并 + 推送关联） | 中（接口 + 缓存表 + App 合并） | 小但不满足目标 |
| 风险 | 端点限流 / 断连 → 索引落后，需可观测（§4.7） | 供应商可用性、Monad 数据延迟未知、密钥泄露 | 电量与流量 |

选 A。B 的两个明确好处（内部交易、注册前历史）在本产品里权重低：App 内建钱包的地址从创建起就在我们这里，注册前没有历史；内部转账入账（合约直接给 EOA 打原生币）在钱包场景是少数，且 A 会以"来源未知"记录金额而不是丢掉。B 保留为将来"记录详情里查看内部交易"的可选增强，不进正式来源。

## 4. 设计（A）

### 4.1 进程与部署

- 新子命令 `./rn-server indexer`（`cmd/server/main.go` 与 `migrate` 并列），代码在 `internal/indexer/`；不在 API 进程内启动，避免 RPC 轮询占用 HTTP 进程的连接与超时预算。
- `compose.yaml` 增加 `indexer` 服务：同镜像、`command: ["./rn-server","indexer"]`、单副本、`depends_on: server`（迁移由 server 先跑）。多副本时靠 `wallet_index_cursor` 的租约（`lease_owner`, `lease_until`，每轮续约）保证一条链只有一个执行者。
- 开关 `INDEXER_ENABLED`（默认 false）；未启用时 API 的 `indexedUpTo` 为空，App 显示"此链未开启收款索引"（声明式状态，管理端可见，见 §4.8）。

### 4.2 配置（平台级，环境变量）

| 变量 | 含义 | 例 |
|---|---|---|
| `INDEXER_ENABLED` | 是否运行 | `true` |
| `INDEXER_RPC_URLS_<CHAIN>` | 该链扫链端点（JSON 数组，按顺序轮换） | `INDEXER_RPC_URLS_MONAD='["https://…"]'` |
| `INDEXER_POLL_SECONDS_<CHAIN>` | 轮询间隔（缺省按 §4.3 表） | `30` |

链级常量写在代码里的 `chainProfile`（不是配置，是 §2.1 实测的协议事实，随端点变化时改代码并重测）：`maxLogSpan`、`confirmations`、`addrChunk`。没有配置端点的链索引器直接标记 `unconfigured` 并在日志与管理端显示，不用默认端点顶上。

### 4.3 轮询节奏与确认深度

| 链 | 出块 | `maxLogSpan` | 轮询 | `confirmations`（写入深度） |
|---|---|---|---|---|
| monad | 0.3s | 100 | 30s | 5 |
| base / op-sepolia | 2s | 5000 | 30s | 10 |
| bsc（另配端点） | 0.45s | 5000 | 30s | 15 |
| eth | 12s | 100 | 60s | 12 |

每轮：`head = eth_blockNumber - confirmations`；从 `cursor.scanned_to + 1` 到 `head` 按 `maxLogSpan` 切片；每片先跑 §4.4 的两类查询，再原子更新游标（同一事务写行 + 游标）。落后时连续追赶不等待，追平后按轮询间隔休眠。

### 4.4 两类查询

**ERC-20（目录内代币，双向）**

```
eth_getLogs { fromBlock, toBlock,
  address: [该链 chain_token_catalog 里 enabled 且非 native 的合约],   // eth 端点必需，其它链无害
  topics: [Transfer, null, [被监听地址 ≤1000 个]] }                       // 入账
eth_getLogs { …, topics: [Transfer, [被监听地址 ≤1000 个], null] }        // 出账（别的钱包软件发起的）
```

被监听地址 = `wallet_index_watch` 中该链的地址（§4.5），按 1000 个一组分片（实测 2000 可用，留一倍余量）。目录外代币不索引：App 没有它的精度与符号，显示不了；这与余额页只显示目录币一致。

**原生币（余额差触发 + 定界扫块）**

1. 每轮对被监听地址分 500 个一组调 Multicall3 `aggregate3([getEthBalance(addr)…])`（一次 `eth_call`），与 `wallet_index_watch.native_balance_raw` 比较。
2. 余额**增加**的地址：在本轮区间 `(last_polled_block, head]` 内逐块 `eth_getBlockByNumber(full=true)`，收集 `to == addr && value > 0` 的交易，写 `in` 行（`asset='native'`）。Monad 一轮 100 块 × 约 17 笔，只在触发时发生。
3. 扫完区间仍无法解释的增量（合约内部转账、验证者奖励等）：写一条 `attribution='unattributed'` 的 `in` 行，金额 = 未解释差额，`tx_hash` 空，`block_number` = 区间末块。App 显示"来源未知（合约内部转账）"并给浏览器链接。不丢、不猜哈希。
4. 余额**减少**不触发扫块：App 自己发起的转出已在本机账本；别的钱包软件发起的原生币转出不索引（记录页文案说明）。这是刻意取舍：Monad 上每笔付 gas 的 `wrap` 都会让余额减少，若减少也触发就退化成逐块扫。
5. 更新 `native_balance_raw` 与 `last_polled_block`。

### 4.5 表结构（迁移 24 `wallet_transfer_index`）

```sql
CREATE TABLE wallet_transfer_index (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT UNSIGNED NOT NULL,
  chain VARCHAR(32) NOT NULL,
  address_key VARCHAR(42) NOT NULL COMMENT '小写地址，同 wallet_user.address_key',
  direction ENUM('in','out') NOT NULL,
  asset ENUM('native','erc20') NOT NULL,
  contract_address VARCHAR(42) NOT NULL COMMENT 'EIP-55；原生币为 native',
  amount_raw DECIMAL(65,0) NOT NULL COMMENT '最小单位整数，不做精度换算',
  counterparty VARCHAR(42) NOT NULL DEFAULT '' COMMENT 'unattributed 时为空',
  tx_hash CHAR(66) NOT NULL DEFAULT '',
  log_index INT NOT NULL DEFAULT -1 COMMENT 'ERC-20 日志序号；原生币为交易序号；unattributed 为 -1',
  block_number BIGINT UNSIGNED NOT NULL,
  block_hash CHAR(66) NOT NULL,
  block_time DATETIME(3) NOT NULL,
  attribution ENUM('tx','unattributed') NOT NULL DEFAULT 'tx',
  status ENUM('confirmed','orphaned') NOT NULL DEFAULT 'confirmed',
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_transfer(chain, tx_hash, log_index, address_key, direction),
  KEY ix_transfer_address(tenant_id, address_key, chain, block_number DESC)
) COMMENT='扫链得到的钱包转账记录；唯一正式来源，App 本机账本只补充未上链的进行中状态';

CREATE TABLE wallet_index_watch (
  tenant_id BIGINT UNSIGNED NOT NULL,
  chain VARCHAR(32) NOT NULL,
  address_key VARCHAR(42) NOT NULL,
  from_block BIGINT UNSIGNED NULL COMMENT '首次纳入监听时的游标；NULL = 等索引器下一轮填',
  native_balance_raw DECIMAL(65,0) NULL,
  last_polled_block BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY(chain, address_key, tenant_id)
) COMMENT='被监听地址；登录时由 API 写入';

CREATE TABLE wallet_index_cursor (
  chain VARCHAR(32) PRIMARY KEY,
  scanned_to_block BIGINT UNSIGNED NOT NULL,
  scanned_to_hash CHAR(66) NOT NULL,
  lease_owner VARCHAR(80) NOT NULL DEFAULT '',
  lease_until DATETIME(3) NULL,
  last_error VARCHAR(512) NOT NULL DEFAULT '',
  error_count INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME(3) NOT NULL
) COMMENT='每链扫描游标与单实例租约';
```

- 监听登记：`walletAuthVerify` 成功后（`wallet_auth.go:232` 附近）对会话声明的每条链 `INSERT IGNORE wallet_index_watch`，`from_block = NULL`，索引器下一轮把它填成当前游标。存量用户由迁移一次性登记（同样 `from_block = NULL`）：他们的记录从索引器上线起算，文档与记录页都这么说。
- 只登记 `onchainSends = true` 租户启用的链：演示模式（`onchainSends=false`，见 AGENTS.md 正式场景原则）的记录来自 Mock 账本，真实入账混进去会误导。
- 重组：每轮先 `eth_getBlockByNumber(scanned_to_block)` 核对 `scanned_to_hash`；不一致则游标回退 `confirmations` 块，并把该区间的行标 `orphaned`（不删，App 不显示 orphaned），重新扫描后再插入（唯一键保证幂等）。写入深度已是 `confirmations`，正常情况不会触发。

### 4.6 推送

前置：给 `wallet_session` 加 `installation_id`（登录请求带已有的安装凭证头，服务端记录），outbox 事件 payload 增加 `targetInstallationIds`，`dispatcher.targets` 有该字段时只取这些安装。事件 `wallet.transfer.received {chain, addressKey, symbol, amountRaw, decimals, txHash}`，文案走 `push_notification_copy` 现有机制；`unattributed` 行也推送（"收到 X，来源未知"）。这是独立的小改动，可先于索引器上线。

### 4.7 接口

`GET /v1/mobile/wallet/transfers?chain=&cursor=&limit=50`，鉴权 `Authorization: Wallet <token>`（复用 `authenticateWalletSession`，地址 = 会话地址，租户 = 域名）。

```json
{
  "items": [{
    "chain": "monad", "direction": "in", "asset": "erc20",
    "contractAddress": "0x…", "amountRaw": "1500000", "counterparty": "0x…",
    "txHash": "0x…", "blockNumber": 102317141, "blockTime": "2026-09-06T02:11:03.000Z",
    "attribution": "tx"
  }],
  "nextCursor": "…",
  "indexedUpTo": { "monad": { "block": 102317141, "time": "…" }, "base": null }
}
```

`indexedUpTo[chain] = null` 表示该链未开启索引（未配置端点或 `INDEXER_ENABLED=false`）；落后超过 10 分钟时 App 显示"已索引到 N 分钟前"。只返回 `status='confirmed'`。加入 `contracts/openapi.json` 并同步 RN-App 的 `contracts/rn-server.openapi.json`（`scripts/check-api-contract.mjs` 会校验）。

### 4.8 管理端可见性（RN-Admin）

租户"钱包"页增加"收款索引"卡片：每条链的 `indexedUpTo`、落后时长、`last_error` / `error_count`、`unconfigured` 状态。数据来自新增的 `GET /v1/admin/wallet/index-status`。没有这块，索引落后就只有用户能发现。

### 4.9 App 合并规则

- `WalletGateway.listTransfers(address)` = 服务端索引 ∪ 本机转出账本，按 `(chain, txHash)` 去重：服务端有行以服务端为准（终态、时间、区块）；本机独有的行只保留 `pending` / `failed`（未上链或失败的进行中记录），本机 `confirmed` 且服务端已有 → 丢弃本机行。
- `WalletTransfer` 增加 `attribution`、`blockTime`；`kind: "receive"` 的行来源只能是服务端。
- 记录页：每条链一行"已索引到 …"状态；`indexedUpTo` 为 null 的链在列表顶部说明"此链未开启收款索引"，并保留浏览器链接。
- 收款页（二维码）在前台时每 15 秒轮询一次 `listTransfers`，出现新的 `in` 行即 toast 并刷新余额；推送到达也走同一刷新。
- `records.indexing` 文案（"等待平台索引"）继续给预测资金记录用，不复用。

### 4.10 幂等、失败与可观测

- 唯一键 + 同事务写游标 → 任意重启都可从游标重扫，不重复、不遗漏。
- 端点错误：切换到下一个端点；连续失败 `error_count++`、指数退避（上限 5 分钟），`last_error` 落表并打日志；不切换到默认端点。
- 指标（日志字段即可，OTel 后续）：每链落后块数、每轮请求数、每轮耗时、`unattributed` 行数。

### 4.11 测试

- Go 单测（假 RPC）：日志分片与地址分组边界、游标推进与同事务写入、重组回退与 `orphaned`、余额差触发的扫块与 `unattributed` 生成、租约互斥、端点轮换与退避。
- dev 端到端（OP Sepolia，prax1s 租户）：给模拟器钱包转 USDC 与 ETH → 表中出现两行 → 接口返回 → App 记录页显示 → 推送到达；模拟落后（停索引器 10 分钟）看 App 的"已索引到"提示。
- 主网前置：为 bsc / eth 提供可扫链的端点（§2.1），在 §4.3 表里复核 `maxLogSpan` 后再启用。

## 5. 分期

1. 迁移 24 + `internal/indexer`（ERC-20 + 原生币）+ `indexer` 子命令 + compose，dev 只开 op-sepolia。
2. 接口 + 契约同步 + App 合并与记录页状态。
3. 会话 ↔ 安装关联 + 定向推送。
4. 管理端索引状态卡片。
5. 主网链端点与启用。

## 6. 未决

- 主网扫链端点选型（付费节点或自建），由运营决定；bsc / eth 的公共默认端点已实测不可用于扫链。
- 是否把 `unattributed` 行在推送里也发出：本文默认发（用户看到余额涨了却没通知更奇怪）。
