# 钱包链上交易记录：独立扫链模块设计（2026-09-06，v2）

> 结论（用户 2026-09-06 拍板）：独立扫链模块。RN-Server 仓库内新增独立进程 `./rn-server indexer`（同镜像、不同启动命令、按链租约），扫链端点是**与 App 端 RPC 无关的独立属性**，平台级、支持多个端点、管理端维护、热加载；ERC-20 用 `eth_getLogs` 双向索引，原生币按链配置 `blocks`（逐块精确）或 `balance`（Multicall3 余额差触发）两种模式；游标 + 唯一键保证服务中断后从断点追块不遗漏；新增链有一条从服务端目录到 App 版本门禁的固定流程；管理端有配置、体检、状态、补扫、告警。
>
> 2026-09-06 用户决定：主网扫链端点由用户自己在管理端维护，本设计只提供管理功能；平台管理员身份沿用配置文件里的管理员账号（`.env` 的 `ADMIN_USERNAME`），新增 `PLATFORM_ADMIN_USERNAMES` 明确列出可进"扫链管理"的账号；"来源待确认"的收款照常推送。v1（浏览器 API / App 自扫的否决理由与五条链默认端点实测）保留在 §2、§3。

## 1. 目标

1. 用户在任意已启用链上收到原生币或目录内代币，记录页出现入账（哈希、对手方、金额、时间），并收到推送。
2. 同一地址在别的钱包软件发起的转出也出现在记录里（ERC-20 双向；原生币转出见 §4.6 的模式说明）。
3. 扫链用的 RPC 端点独立于 App 端（租户 `wallet.networks[].rpcUrls`）与服务端元数据读取（`supportedNetworks` 默认端点），可配多个，故障自动切换。
4. 索引器进程崩溃、端点故障、数据库短时不可用、链重组、配置错误，都不能造成记录遗漏或重复；恢复后自动追块，进度可见。
5. 后端新增一条链，有固定流程把目录、App 版本、租户启用、扫链配置、监听地址串起来，旧版本 App 不受影响。
6. 管理端可配置、可体检端点、可看状态与落后、可暂停 / 重扫 / 补扫、有告警。
7. 记录从地址在本平台首次登录起算；更早历史用已有的浏览器地址链接（`wallet-runtime-config.ts:248`），不索引。

## 2. 事实

### 2.1 五条链平台默认端点对扫链的限制（2026-09-06 本机实测，`scratchpad/probe2.py` / `probe3.py`）

| 链（`server.go:771-778` 默认端点） | 出块 | `eth_getLogs` 仅按 topic | 带代币合约 `address` 过滤 | 最大区块跨度 | topic 中 2000 地址 | Multicall3 | 批量 JSON-RPC |
|---|---|---|---|---|---|---|---|
| bsc `bsc-dataseed.bnbchain.org` | 0.45s | `limit exceeded`（50 块也拒） | 同左 | **0，不可用** | — | 有 | 20 条 OK |
| bsc `bsc-rpc.publicnode.com`（备选） | — | 未测 | 5000 OK | ≥5000 | — | 有 | OK |
| eth `ethereum-rpc.publicnode.com` | 12s | 拒绝：`Please specify an address` | 100 OK；1000 → `Archive requests require…` | **100** | — | 有 | OK |
| base `mainnet.base.org` | 2s | 10000 OK | 5000 OK | 10000（20000 拒） | OK | 有 | 每批 ≤10 |
| op-sepolia `sepolia.optimism.io` | 2s | 5000 OK | 5000 OK | 5000（10000 拒） | OK | 有 | 20 条 413 |
| monad `rpc.monad.xyz` | **0.30s** | 100 OK | 100 OK | **100** | OK | 有 | OK |

Multicall3 `0xcA11bde05977b3631167028862bE2a173976CA11` 五条链均已部署。结论：默认端点不能直接拿来扫链（bsc 完全不行、eth 只能 100 块），扫链端点必须单独配置；Monad 100 块 = 30 秒链上时间，决定了轮询节奏；原生币转账没有日志。

### 2.2 Etherscan V2 覆盖

`GET https://api.etherscan.io/v2/chainlist`（2026-09-06）：1 / 56 / 8453 / 11155420 / 143 均在列（共 61 条）。免费档 5 req/s、10 万次/天/密钥（官方公开限额，未验证）。

### 2.3 RN-Server / RN-Admin / RN-App 可复用与受约束的部件

| 部件 | 位置 | 与本设计的关系 |
|---|---|---|
| JSON-RPC 客户端与端点核验（`eth_chainId` 核对、限时限量、顺序失败切换） | `internal/chain/reader.go:97-135, 246-290` | 扩展 `eth_getLogs` / `eth_getBlockByNumber` / `eth_blockNumber`，端点切换逻辑升级为 §4.4 的健康度模型 |
| 链目录（代码常量：id、chainId、默认 App RPC、浏览器、原生币） | `internal/api/server.go:771-778` `supportedNetworks`；管理端目录 `walletCatalog()` | 新链先加这里；本设计给每条目录项加 `minBuild`（§4.8） |
| 租户链配置校验（`chains` 必须在目录内、`networks[].rpcUrls` 只能 https） | `server.go:855-925` | 租户 RPC 只给 App 用，扫链不读它 |
| 代币目录 `chain_token_catalog(chain, contract_address, decimals, enabled, tenant_id)` | `migrations.go:120-140` | ERC-20 查询的 `address` 过滤列表 |
| 钱包用户 `wallet_user(tenant_id, address, address_key)`；登录写入 | `migrations.go:212-226`、`wallet_auth.go:232` | 监听地址来源 |
| 会话鉴权 `Authorization: Wallet <token>` | `wallet_auth.go:316-345`；App `http-session-gateway.ts:148` | 移动端记录接口复用 |
| App 每个请求带 `X-App-Version` / `X-Build-Number`；服务端已读 `x-app-version` / `x-build-number` | `RN-App/src/core/network/api-client.ts:88-89`；`internal/api/*.go` | 新链按构建号门禁下发（§4.8） |
| App 链 id 是硬编码枚举，bootstrap 出现未知 id 整份解析失败 | `bootstrap.schema.ts:4`、`core/gateways/types.ts:27` | 新链必须先发 App，再由服务端按构建号下发 |
| outbox 推送按**租户**广播，安装与钱包会话无关联 | `push/dispatcher.go:197-200`；`wallet_auth.go` 不读安装 id | 定向推送要先补关联（§4.10） |
| 管理端：只有租户作用域（域名解析租户），没有平台级页面；`app-config` 插件下有"钱包与链"页（目录 + 租户启用 + RPC 覆盖草稿） | `server.go:130-146`、`RN-Admin/src/modules/app-config/plugin.ts`、`wallet-page.tsx` | 扫链管理是平台级，需要新的路由组与插件页（§4.12） |
| 管理员账号来自配置文件：`.env` 的 `ADMIN_USERNAME` / `ADMIN_PASSWORD_HASH`（登录）与 `ADMIN_API_KEY`（自动化，`x-admin-id` 指明操作人）；会话表 `admin_sessions.actor_id` 存的就是该用户名 | `config.go:80-84`、`server.go:348-360`、`server.go:308-323`、`deploy/web4/prepare-env.sh` | 平台管理员用同一套配置声明（§4.11） |
| 审计 `audit_events`、乐观锁 `version`、后台 worker 与 outbox 的既有模式 | `server.go:1314`、`tokens.go:585-600`、`docs/ARCHITECTURE.md` §7 | 配置写入走同一套 |
| 单镜像 `./rn-server`，已有 `migrate` 子命令 | `Dockerfile:16`、`cmd/server/main.go:39-47` | 加 `indexer` 子命令 |

## 3. 方案比较（v1 结论，保留）

| | A. 独立扫链模块（采用） | B. Etherscan V2 | C. App 自扫 |
|---|---|---|---|
| 原生币入账 | `blocks` 模式精确；`balance` 模式余额差精确、归属可能延后 | 含内部交易 | 同 A 无后台 |
| 推送 | 有 | 需轮询 | 无 |
| 外部依赖 | 只要 RPC | 密钥 + 配额，按用户 × 链轮询不可持续 | 无 |
| 一致性 | 表是唯一正式来源，重组回滚 | 以对方为准 | Monad 离线一天补扫 2880 次请求 |

B 只保留为将来"记录详情看内部交易"的可选增强，不进正式来源；C 否决。

## 4. 设计

### 4.1 进程与部署

- `./rn-server indexer`（`cmd/server/main.go` 与 `migrate` 并列），代码 `internal/indexer/`；不在 API 进程内启动。
- `deploy/web4/compose.yaml` 增加 `indexer` 服务：同镜像、`command: ["./rn-server","indexer"]`、`depends_on: server`（迁移由 server 先跑）。
- 开关 `INDEXER_ENABLED`（默认 false）。多副本允许：每条链一把租约（`chain_scan_cursor.lease_owner / lease_until`，每轮续约，超时可被接管），链在副本间自然分摊。

### 4.2 三类 RPC 端点的边界

| 用途 | 来源 | 谁能改 | 用在哪 |
|---|---|---|---|
| App 端读余额 / 发交易 | 租户 `wallet.networks[].rpcUrls`（未配时 `supportedNetworks` 默认） | 租户管理员 | 只下发给 App |
| 服务端读代币元数据（symbol / decimals） | `supportedNetworks` 默认端点 | 代码 | `tokens.go:568-573`，维持现状 |
| **扫链** | `chain_scan_config.endpoints`（§4.3） | 平台管理员 | 只给 indexer |

三者互不读取。理由：租户可控的节点能伪造记录；默认公共端点扫不了链（§2.1）；扫链端点通常带付费密钥，不能下发到 App。

### 4.3 扫链配置模型（平台级、库内、热加载）

表 `chain_scan_config`（平台级，无 tenant_id）：

| 列 | 说明 |
|---|---|
| `chain` PK | 目录 id（`supportedNetworks`） |
| `enabled` | 平台是否对这条链扫链 |
| `paused` | 运维手动暂停（游标保留，恢复后追块） |
| `endpoints` JSON | 有序数组 `[{url, label, rps, maxLogSpan?}]`；`rps` 每端点限速；`maxLogSpan` 端点级覆盖 |
| `max_log_span` | 链级日志跨度（体检结果写入，§4.12） |
| `confirmations` | 写入深度（区块） |
| `poll_seconds` | 轮询间隔 |
| `addr_chunk` | 每次 `eth_getLogs` 的地址数（默认 1000） |
| `native_mode` ENUM('blocks','balance') | 原生币模式（§4.6） |
| `start_block` | 启用时的起扫区块（默认 = 启用时刻链头 − confirmations） |
| `native_gap_cap` | `balance` 模式下，缺口超过多少块改为"先记差额、后台归属"（§4.7） |
| `version`, `updated_by`, `updated_at` | 乐观锁 + 审计 |

- 保存时校验（拒绝即 400，不容忍）：每个端点 `eth_chainId` 必须等于目录 `chainId`；`https://` 或私网 `http://`（仅 `INDEXER_ALLOW_PLAIN_HTTP=true` 时）；`confirmations ≥ 1`；`max_log_span ≥ 1`；`enabled=true` 时至少一个端点。
- 索引器每 30 秒读一次 `version`，变化即重建该链的 worker（端点、节奏、模式立即生效，不重启进程）。
- 出于安全，端点 url 里的密钥在管理端只显示脱敏形式；`GET` 接口返回 `urlMasked` 与 `hasSecret`。
- 端点的选型、申请、更换由运营（用户本人）在管理端完成，代码里不内置任何扫链端点；没有配置端点的链就是 `unconfigured`。

### 4.4 多端点策略

每条链的 worker 维护端点健康度（内存 + 落表 `chain_scan_endpoint_status` 供管理端）：

- **选择**：按配置顺序取第一个 `healthy` 的端点；同一轮内的所有请求固定同一端点（避免不同节点视图混用）。
- **健康度**：连续失败 ≥3 → `cooling`（退避 30s × 2^n，上限 10 分钟）；冷却到期先做探活（`eth_chainId` + `eth_blockNumber`）再回 `healthy`。`eth_chainId` 不符 → `mismatch`，永久剔除直到配置修改。
- **头高度一致性**：切换端点后，若新端点 `eth_blockNumber < cursor.scanned_to_block`（落后节点），跳过它；若 `≥` 但小于上一端点头 `confirmations` 以上，仍可用（写入深度已保证安全）。
- **限速**：每端点令牌桶（`rps`），追块时也不超；超限等待而不是换端点。
- **错误分类**：超时 / 5xx / 连接失败 → 计入失败；`-32614`（跨度过大）之类的参数错误 → 不计失败，把本片跨度减半重试并在状态里记 `spanRejected`（提示体检值过大）；重组 / 数据不一致 → 走 §4.5。
- **全部不可用**：worker 进入 `stalled`，游标不动，状态与告警可见（§4.14），恢复后从断点追块。

### 4.5 轮询、分片、游标、重组

- 每轮：`head = eth_blockNumber − confirmations`；从 `scanned_to_block + 1` 到 `head` 按 `max_log_span` 分片；每片执行 §4.6 的查询，**同一事务**写记录 + 推进游标（`scanned_to_block / scanned_to_hash`）。
- 追块时片与片之间不休眠，只受端点限速；追平后按 `poll_seconds` 休眠。
- 重组：每轮开始先取 `scanned_to_block` 的区块头核对 `scanned_to_hash`；不一致则游标回退 `confirmations` 块，把该区间的行标 `orphaned`（不删，App 不显示），重扫后再插入（唯一键幂等）。写入深度已是 `confirmations`，正常不会触发；触发即告警。
- 时间戳取区块 `timestamp`，不用服务器时钟。

### 4.6 两类查询

**ERC-20（目录内代币，双向）**

```
eth_getLogs { fromBlock, toBlock,
  address: [该链 chain_token_catalog 里 enabled 且非 native 的合约],
  topics: [Transfer, null, [被监听地址 ≤ addr_chunk]] }   // 入账
eth_getLogs { …, topics: [Transfer, [被监听地址 ≤ addr_chunk], null] }   // 出账（别的钱包软件发起）
```

目录外代币不索引：App 没有它的精度与符号；与余额页只显示目录币一致。代币目录变更（新增代币）不回溯：从生效那轮起纳入过滤列表，管理端"重扫区间"可补历史（§4.12）。

**原生币，按 `native_mode`**

| 模式 | 做法 | 适用 | 成本 |
|---|---|---|---|
| `blocks` | 每片逐块 `eth_getBlockByNumber(full=true)`，匹配 `to ∈ 监听` 或 `from ∈ 监听` 且 `value > 0`；双向、精确、零延迟 | 出块慢或有自建 / 付费节点的链（eth 7200 块/天；base、op-sepolia 4.3 万/天） | 每块 1 请求 |
| `balance` | 每轮 Multicall3 `aggregate3([getEthBalance…])`（500 地址一次 `eth_call`）与 `wallet_index_watch.native_balance_raw` 比较；**只有增加**才对本轮区间逐块扫、写 `in` 行；扫不到对应交易的增量写 `attribution='unattributed'` 行（金额 = 差额、无哈希、区块 = 区间末块）；减少不处理（App 自己的转出在本机账本，别的软件发起的原生币转出不索引，记录页文案说明） | 出块快、只有公共端点的链（monad 28.8 万块/天、bsc 19.2 万/天） | 每轮 N/500 次 `eth_call`，触发时才扫块 |

两种模式都是声明式配置，语义写进管理端提示，不是回退。

### 4.7 追块与缺口（"服务异常了要追块防止遗漏"）

保证：**ERC-20 永不遗漏**（日志按区块精确，游标之前的区间要么已入库要么会被重扫）；**原生币金额永不遗漏**（`blocks` 精确；`balance` 的余额差精确），归属可能延后。

| 异常 | 影响 | 处理 |
|---|---|---|
| 索引器进程崩溃 / 部署重启 | 游标停在最后一次事务 | 启动即从 `scanned_to_block + 1` 追，不需要人工 |
| 所有端点故障 | `stalled`，游标不动 | 告警；恢复后追块；落后量与 ETA 在管理端可见 |
| 数据库不可用 | 本片事务失败，游标不推进 | 重试；不会出现"记录写了游标没推"或反之 |
| 链重组 | 最近 `confirmations` 块内数据作废 | §4.5 哈希核对 + 回退 + `orphaned` |
| 配置错误（端点错链、跨度过大） | 拒绝保存 / 片跨度自动减半 | §4.3 / §4.4 |
| 缺口很大（`balance` 模式，如停机一天，Monad 28.8 万块） | 逐块归属太贵（28.8 万请求） | 缺口 > `native_gap_cap` 时：本轮只做余额比对，增量先写 `unattributed(gap: from–to)` 行，**立即可见且金额正确**；同时建一条后台任务 `attribute`（§4.9 `chain_scan_job`）在低优先级、限速下逐块扫该缺口，找到交易后用真实行替换 `unattributed` 行（同事务：插入真实行、删除占位行）。ERC-20 在缺口内照常按日志精确追 |
| 缺口内某地址先收后付、净额 ≤ 0 | `balance` 模式当轮不触发 | 同上：`attribute` 任务对整个缺口一次扫过所有监听地址，能补上；正常轮询窗口 30 秒内出现这种情况概率很低，记录页文案不承诺原生币出账 |

追块吞吐（Monad，`max_log_span=100`，每片 2 次 `getLogs` + 1 次 `eth_call`，端点 5 rps）：停机 1 小时 = 1.2 万块 = 120 片 ≈ 1.2 分钟；停机 1 天 = 2880 片 ≈ 29 分钟。管理端显示"落后 N 块 / 预计 M 分钟追平"。

### 4.8 新增链的接入流程

现状里链 id 在服务端目录（代码）与 App 枚举（代码）两处硬编码，bootstrap 出现 App 不认识的 id 会让整份配置解析失败。因此新链的正式流程：

1. **App**：`ChainId` 与 `chainIdSchema` 加 id，出新构建（Android / iOS 各自的构建号）。
2. **RN-Server 目录**：`supportedNetworks` 加条目，新增字段 `minBuild {android, ios}` = 第 1 步的构建号；`walletCatalog()` 一并下发给管理端。
3. **bootstrap 门禁**：`GET /v1/mobile/bootstrap` 读 `x-platform` / `x-build-number`，`chains / networks / tokens` 只下发构建号 ≥ `minBuild` 的链；旧 App 看不到新链，不会解析失败。管理端"钱包与链"页对低于门槛的租户活跃安装（`app_installations` 有 `build_number`）显示"仍有 N 个安装看不到该链"。
4. **租户启用**：租户管理员在"钱包与链"启用（现有校验 `supportedNetwork(id)` 不变）。
5. **扫链配置**：平台管理员在"扫链管理"为该链建 `chain_scan_config`（端点、体检、模式、`start_block`），`enabled=true` 后索引器热加载建 worker，游标从 `start_block` 起。
6. **监听地址**：`enabled` 变为 true 时，服务端把所有 `onchainSends=true` 且启用该链的租户的 `wallet_user` 一次性写入 `wallet_index_watch`（`from_block = start_block`）；之后由登录写入。
7. **代币目录**：`chain_token_catalog` 加该链的原生币行与代币；ERC-20 过滤列表随之生效。

去掉一条链：先 `paused` 观察，再 `enabled=false`（游标与记录保留，不删）；目录移除是代码变更，需先确认没有租户启用。

### 4.9 表结构（迁移 24）

沿用仓库约定（`internal/store/migrations.go`）：每张表、每一列都带 `COMMENT`，说明含义、来源与取值；金额一律最小单位整数，不做精度换算；地址统一小写 `address_key`（与 `wallet_user` 一致），合约地址 EIP-55。

```sql
CREATE TABLE chain_scan_config (
  chain VARCHAR(32) NOT NULL COMMENT '链 id，与平台链目录 supportedNetworks 一致：bsc/eth/base/op-sepolia/monad…',
  enabled TINYINT(1) NOT NULL DEFAULT 0 COMMENT '平台是否对这条链扫链：0 不扫（unconfigured），1 扫',
  paused TINYINT(1) NOT NULL DEFAULT 0 COMMENT '运维手动暂停：1 时 worker 停止推进游标，恢复后从断点追块',
  endpoints JSON NOT NULL COMMENT '扫链端点有序数组 [{url,label,rps,maxLogSpan?}]；url 含密钥时只在此表明文，接口返回脱敏；rps 每端点每秒请求上限；maxLogSpan 端点级覆盖',
  max_log_span INT UNSIGNED NOT NULL COMMENT '链级 eth_getLogs 最大区块跨度，来自端点体检（§4.12）；请求被拒会自动减半但不回写',
  confirmations INT UNSIGNED NOT NULL COMMENT '写入深度：只索引 head−confirmations 之前的区块，也是重组回退的块数',
  poll_seconds INT UNSIGNED NOT NULL COMMENT '追平后的轮询间隔（秒）；追块期间不生效',
  addr_chunk INT UNSIGNED NOT NULL DEFAULT 1000 COMMENT '每次 eth_getLogs 携带的监听地址数上限（实测 2000 可用，默认留一倍余量）',
  native_mode ENUM('blocks','balance') NOT NULL COMMENT '原生币索引模式：blocks 逐块读全部交易（精确、双向）；balance 用 Multicall3 余额差触发（只记入账，归属可能延后）',
  native_gap_cap BIGINT UNSIGNED NOT NULL DEFAULT 20000 COMMENT 'balance 模式下缺口超过多少块改为先记差额、后台任务归属（§4.7）',
  start_block BIGINT UNSIGNED NOT NULL COMMENT '首次启用时的起扫区块；游标不存在时以它初始化，之后不再使用',
  version INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '乐观锁版本；索引器每 30 秒比对，变化即重建该链 worker',
  updated_by VARCHAR(120) NOT NULL COMMENT '最后修改人（管理员用户名或 x-admin-id）',
  updated_at DATETIME(3) NOT NULL COMMENT '最后修改时间（UTC）',
  PRIMARY KEY(chain)
) ENGINE=InnoDB COMMENT='平台级扫链配置：端点、节奏、模式；由管理端"扫链管理"维护，索引器热加载';

CREATE TABLE chain_scan_cursor (
  chain VARCHAR(32) NOT NULL COMMENT '链 id，同 chain_scan_config.chain',
  scanned_to_block BIGINT UNSIGNED NOT NULL COMMENT '已完整索引到的区块号（含）；与记录同一事务推进，是追块的唯一断点',
  scanned_to_hash CHAR(66) NOT NULL COMMENT 'scanned_to_block 的区块哈希；每轮核对，不一致即判定重组',
  head_block BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '最近一次从端点观察到的链头区块号，用于计算落后',
  state ENUM('idle','scanning','catching_up','stalled','paused','unconfigured') NOT NULL COMMENT '运行状态：idle 追平等待；scanning 正在扫本轮；catching_up 落后追块中；stalled 全部端点不可用；paused 手动暂停；unconfigured 未启用或无端点',
  lease_owner VARCHAR(80) NOT NULL DEFAULT '' COMMENT '持有租约的索引器实例标识（主机名+进程 id）；空表示无人持有',
  lease_until DATETIME(3) NULL COMMENT '租约到期时间（UTC）；到期后其他实例可接管',
  last_error VARCHAR(512) NOT NULL DEFAULT '' COMMENT '最近一次错误（已截断），成功一轮后清空',
  error_count INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '连续失败轮数；成功后归零',
  reorg_count INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '累计检测到的重组次数，用于告警与排查',
  updated_at DATETIME(3) NOT NULL COMMENT '最后更新时间（UTC）',
  PRIMARY KEY(chain)
) ENGINE=InnoDB COMMENT='每条链的扫描游标、运行状态与单实例租约';

CREATE TABLE chain_scan_endpoint_status (
  chain VARCHAR(32) NOT NULL COMMENT '链 id',
  url_hash CHAR(64) NOT NULL COMMENT '端点 url 的 SHA-256；不落明文，避免密钥进入状态表',
  label VARCHAR(80) NOT NULL COMMENT '配置里的端点显示名，供管理端对应',
  health ENUM('healthy','cooling','mismatch','unknown') NOT NULL COMMENT '健康度：healthy 可用；cooling 连续失败后冷却中；mismatch eth_chainId 与目录不符，剔除；unknown 尚未探测',
  consecutive_failures INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '连续失败次数；成功后归零；≥3 进入 cooling',
  cooling_until DATETIME(3) NULL COMMENT '冷却到期时间（UTC），到期先探活再恢复',
  last_ok_at DATETIME(3) NULL COMMENT '最近一次成功响应时间（UTC）',
  last_error VARCHAR(512) NOT NULL DEFAULT '' COMMENT '最近一次错误（已截断）',
  latency_ms INT UNSIGNED NULL COMMENT '最近一次成功请求耗时（毫秒）',
  head_block BIGINT UNSIGNED NULL COMMENT '该端点最近报告的链头，用于识别落后节点',
  span_rejected INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '因区块跨度过大被拒的次数，提示 max_log_span 配高了',
  updated_at DATETIME(3) NOT NULL COMMENT '最后更新时间（UTC）',
  PRIMARY KEY(chain, url_hash)
) ENGINE=InnoDB COMMENT='扫链端点健康度，由索引器写、管理端读';

CREATE TABLE chain_scan_job (
  id VARCHAR(80) NOT NULL COMMENT '任务 id（job_ 前缀随机串）',
  chain VARCHAR(32) NOT NULL COMMENT '链 id',
  kind ENUM('rescan','attribute','rebuild_watch') NOT NULL COMMENT '任务类型：rescan 重扫区间（幂等）；attribute 对 unattributed 行逐块定位交易并替换；rebuild_watch 按 wallet_user 重建监听地址',
  from_block BIGINT UNSIGNED NOT NULL COMMENT '处理区间起始区块（含）；rebuild_watch 填 0',
  to_block BIGINT UNSIGNED NOT NULL COMMENT '处理区间结束区块（含）；rebuild_watch 填 0',
  progress_block BIGINT UNSIGNED NOT NULL COMMENT '已处理到的区块，供进度条与断点续跑',
  tenant_id BIGINT UNSIGNED NULL COMMENT 'rebuild_watch 限定的租户；NULL 表示全部租户',
  state ENUM('pending','running','done','failed','cancelled') NOT NULL COMMENT '任务状态：pending 排队；running 执行中；done 完成；failed 失败（见 last_error）；cancelled 管理端取消',
  created_by VARCHAR(120) NOT NULL COMMENT '发起人：管理员用户名，或 system（索引器自动建的 attribute 任务）',
  reason VARCHAR(500) NOT NULL DEFAULT '' COMMENT '管理端填写的操作原因，同步写审计',
  last_error VARCHAR(512) NOT NULL DEFAULT '' COMMENT '最近一次错误（已截断）',
  created_at DATETIME(3) NOT NULL COMMENT '创建时间（UTC）',
  updated_at DATETIME(3) NOT NULL COMMENT '最后更新时间（UTC）',
  PRIMARY KEY(id),
  KEY ix_job_chain_state(chain, state)
) ENGINE=InnoDB COMMENT='扫链后台任务：重扫、原生币归属、重建监听；限速执行、可取消、断点续跑';

CREATE TABLE wallet_transfer_index (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '记录主键',
  tenant_id BIGINT UNSIGNED NOT NULL COMMENT '租户 ID，来自 wallet_index_watch',
  chain VARCHAR(32) NOT NULL COMMENT '链 id',
  address_key VARCHAR(42) NOT NULL COMMENT '被监听的钱包地址（小写），同 wallet_user.address_key',
  direction ENUM('in','out') NOT NULL COMMENT '方向：in 入账（to = 本地址）；out 出账（from = 本地址）',
  asset ENUM('native','erc20') NOT NULL COMMENT '资产类型：native 原生币；erc20 目录内代币',
  contract_address VARCHAR(42) NOT NULL COMMENT '代币合约地址（EIP-55）；原生币为 native，与 chain_token_catalog 一致',
  amount_raw DECIMAL(65,0) NOT NULL COMMENT '金额，最小单位整数；精度看代币目录 decimals，此处不换算',
  counterparty VARCHAR(42) NOT NULL DEFAULT '' COMMENT '对手方地址（小写）：in 为 from，out 为 to；unattributed 为空',
  tx_hash CHAR(66) NOT NULL DEFAULT '' COMMENT '交易哈希；unattributed 为空',
  log_index INT NOT NULL DEFAULT -1 COMMENT 'ERC-20 为日志在区块内的序号；原生币为交易在区块内的序号；unattributed 为 -1',
  block_number BIGINT UNSIGNED NOT NULL COMMENT '区块号；unattributed 为覆盖区间的末块',
  block_hash CHAR(66) NOT NULL COMMENT '区块哈希，重组回滚时据此比对',
  block_time DATETIME(3) NOT NULL COMMENT '区块时间戳（UTC），来自链，不用服务器时钟',
  attribution ENUM('tx','unattributed') NOT NULL DEFAULT 'tx' COMMENT '归属：tx 已定位到交易；unattributed 只有余额差额、交易待后台任务定位（balance 模式）',
  gap_from_block BIGINT UNSIGNED NULL COMMENT 'unattributed 覆盖区间的起始区块；tx 行为 NULL',
  status ENUM('confirmed','orphaned') NOT NULL DEFAULT 'confirmed' COMMENT '有效性：confirmed 有效；orphaned 因重组作废，保留供排查，接口不返回',
  created_at DATETIME(3) NOT NULL COMMENT '入库时间（UTC）',
  PRIMARY KEY(id),
  UNIQUE KEY uq_transfer(chain, tx_hash, log_index, address_key, direction, block_number),
  KEY ix_transfer_address(tenant_id, address_key, chain, block_number DESC)
) ENGINE=InnoDB COMMENT='扫链得到的钱包转账记录，唯一正式来源；App 本机账本只补充未上链的进行中状态';

CREATE TABLE wallet_index_watch (
  tenant_id BIGINT UNSIGNED NOT NULL COMMENT '租户 ID',
  chain VARCHAR(32) NOT NULL COMMENT '链 id',
  address_key VARCHAR(42) NOT NULL COMMENT '被监听地址（小写），同 wallet_user.address_key',
  from_block BIGINT UNSIGNED NOT NULL COMMENT '纳入监听时的游标区块；此前的历史不索引，记录页据此说明起算时间',
  native_balance_raw DECIMAL(65,0) NULL COMMENT 'balance 模式最近一次读到的原生币余额（最小单位）；NULL 表示尚未读取',
  last_polled_block BIGINT UNSIGNED NULL COMMENT 'balance 模式最近一次余额比对对应的区块，下次触发扫块的区间起点',
  created_at DATETIME(3) NOT NULL COMMENT '登记时间（UTC）：登录时由 API 写入，或 rebuild_watch 任务写入',
  PRIMARY KEY(chain, address_key, tenant_id)
) ENGINE=InnoDB COMMENT='被监听的钱包地址；只登记 onchainSends=true 且启用该链的租户用户';

CREATE TABLE chain_scan_alert (
  id VARCHAR(80) NOT NULL COMMENT '告警 id',
  chain VARCHAR(32) NOT NULL COMMENT '链 id',
  kind ENUM('stalled','lagging','reorg','endpoint_mismatch','job_failed') NOT NULL COMMENT '告警类型，触发条件见 §4.14',
  message VARCHAR(512) NOT NULL COMMENT '人类可读描述（已截断）',
  raised_at DATETIME(3) NOT NULL COMMENT '首次触发时间（UTC）',
  resolved_at DATETIME(3) NULL COMMENT '恢复时间（UTC）；NULL 表示仍在告警',
  webhook_sent_at DATETIME(3) NULL COMMENT 'webhook 投递成功时间；未配置或失败为 NULL',
  PRIMARY KEY(id),
  KEY ix_alert_open(chain, resolved_at)
) ENGINE=InnoDB COMMENT='扫链告警；管理端横幅与 webhook 的事实源';
```

- 监听登记：`walletAuthVerify` 成功后对会话声明且该租户启用、且 `chain_scan_config.enabled` 的链 `INSERT IGNORE`，`from_block = 当前游标`（API 读 `chain_scan_cursor`，没有游标的链不登记并打日志）。只登记 `onchainSends=true` 的租户：演示模式的记录来自 Mock 账本。
- `unattributed` 行的唯一键用 `(chain, '', -1, address_key, 'in', block_number)`，同一区间只会有一条。
- `wallet_session` 加列 `installation_id VARCHAR(80) NULL COMMENT '登录时的 App 安装实例 ID，定向推送用；旧会话为 NULL'`（§4.10）。

### 4.10 推送

前置：`wallet_session` 加 `installation_id`（登录请求带现有安装凭证头），outbox payload 加 `targetInstallationIds`，`dispatcher.targets` 有该字段时只发这些安装。事件 `wallet.transfer.received {chain, addressKey, symbol, amountRaw, decimals, txHash, attribution}`，文案走 `push_notification_copy`。`unattributed` 也推送（"收到 X，来源待确认"，2026-09-06 用户确认），归属完成不再推。

### 4.11 接口

**移动端** `GET /v1/mobile/wallet/transfers?chain=&cursor=&limit=50`，鉴权 `Authorization: Wallet <token>`：

```json
{
  "items": [{ "chain": "monad", "direction": "in", "asset": "erc20", "contractAddress": "0x…",
              "amountRaw": "1500000", "counterparty": "0x…", "txHash": "0x…",
              "blockNumber": 102317141, "blockTime": "2026-09-06T02:11:03.000Z", "attribution": "tx" }],
  "nextCursor": "…",
  "index": { "monad": { "state": "idle", "block": 102317141, "time": "…", "lagSeconds": 12 },
             "base":  { "state": "unconfigured" } }
}
```

只返回 `status='confirmed'`；`index[chain].state` 取 `chain_scan_cursor.state`。契约进 `contracts/openapi.json`，同步 RN-App `contracts/rn-server.openapi.json`（`check-api-contract.mjs`）。

**管理端（平台级，新路由组 `/v1/admin/platform/scan`，走 `authenticate()` 不走 `domainTenantScope()`，再加 `requirePlatformAdmin()`）**

平台管理员用配置文件声明：`.env` 新增 `PLATFORM_ADMIN_USERNAMES`（逗号分隔的管理员用户名，`prepare-env.sh` 生成时预填为 `ADMIN_USERNAME`）。`requirePlatformAdmin()` 取会话的 `actor_id`（登录）或 `x-admin-id`（`ADMIN_API_KEY` 自动化）核对是否在列表内，不在 → 403 `PLATFORM_ADMIN_REQUIRED`；变量为空 → 平台路由一律 403 `PLATFORM_ADMIN_NOT_CONFIGURED`，管理端页面显示同样提示，不默认放开。将来引入多账号时只需扩展这个列表的来源。

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/chains` | 目录 × 配置 × 游标 × 端点健康 × 运行中任务 一览 |
| PUT | `/chains/:chain` | 保存配置（乐观锁 `version`、校验、审计） |
| POST | `/chains/:chain/probe` | 端点体检：对每个端点跑 `eth_chainId`、`eth_blockNumber`、Multicall3 `eth_getCode`、`eth_getLogs` 跨度二分探测（100 → 10000）、`eth_getBlockByNumber(full)` 耗时；返回建议 `maxLogSpan` 与 `native_mode` |
| POST | `/chains/:chain/pause` / `resume` | 暂停 / 恢复 |
| POST | `/chains/:chain/jobs` | 建任务：`rescan {from,to}`（重扫区间，幂等）、`attribute {from,to}`（补原生币归属）、`rebuild_watch {tenantId?}`（按 `wallet_user` 重建监听） |
| GET / POST | `/jobs`、`/jobs/:id/cancel` | 任务列表与取消 |
| GET | `/transfers?chain=&address=` | 客服查询某地址的索引记录（含 `orphaned` / `unattributed`） |

**管理端（租户级，挂在现有 `registerTenantRoutes`）**：`GET /wallet/index-status`（本租户启用链的状态、监听地址数、最近 24h 记录数）。

### 4.12 管理端功能（RN-Admin）

新插件页 **"扫链管理"**（平台级，与"应用配置"并列；沿用 `app-config` 插件的页面注册与 `useQuery` / 草稿 / 乐观锁形态）：

1. **链卡片列表**：每条目录链一张卡：`enabled / paused`、状态（`idle / catching_up / stalled / unconfigured`）、游标块与链头、落后块数与时长、预计追平时间、最近错误、重组次数、24h 记录数、`unattributed` 未归属数、监听地址数、运行中任务。
2. **配置编辑**：端点有序列表（增删、拖动排序、label、rps、脱敏显示），链级参数（`max_log_span / confirmations / poll_seconds / addr_chunk / native_mode / native_gap_cap / start_block`），保存前必须"体检通过"（体检按钮逐端点显示 chainId 是否相符、头高度、延迟、getLogs 可用跨度、Multicall3 有无），体检建议一键填入。
3. **端点健康表**：`healthy / cooling / mismatch`、连续失败、冷却到期、最近成功、延迟、头高度、`spanRejected` 次数。
4. **操作**：暂停 / 恢复；重扫区间（填 from/to，说明"幂等，不会重复"）；补归属（对 `unattributed` 行一键生成 `attribute` 任务）；重建监听；每个操作要填 `reason`，写审计。
5. **任务列表**：进度条（`progress_block / (to − from)`）、取消。
6. **地址查询**：输入地址与链，列出索引记录（含 `orphaned` / `unattributed`），给客服排查"我收到了钱但没记录"。
7. **新链向导**（§4.8 的可视化）：显示该链的 `minBuild`、当前各租户低于门槛的活跃安装数、是否已有配置 / 代币目录 / 监听地址，按步骤打勾。

页面入口只对 `PLATFORM_ADMIN_USERNAMES` 内的账号显示（前端按 `GET /v1/admin/auth/session` 返回的 `platformAdmin: true` 判断，接口侧仍以 `requirePlatformAdmin()` 为准）。

租户级"钱包与链"页增加只读区块 **"收款索引"**：本租户启用链的状态与落后、监听地址数；`unconfigured` 的链提示"平台未开启该链扫链，App 记录页会显示未开启"。

### 4.13 App 合并规则

- `WalletGateway.listTransfers(address)` = 服务端索引 ∪ 本机转出账本，按 `(chain, txHash)` 去重：服务端有行以服务端为准；本机独有的行只保留 `pending / failed`；本机 `confirmed` 且服务端已有 → 丢弃本机行。
- `WalletTransfer` 加 `attribution`、`blockTime`；`kind: "receive"` 只能来自服务端。
- 记录页：每链一行"已索引到 …"（`lagSeconds > 600` 才显示落后），`unconfigured / stalled` 的链在顶部说明并保留浏览器链接；`unattributed` 行显示"来源待确认（合约内部转账或服务中断期间）"。
- 收款页在前台每 15 秒轮询一次，新 `in` 行即 toast 并刷新余额；推送到达走同一刷新。
- `records.indexing` 文案继续给预测资金记录用，不复用。

### 4.14 可观测与告警

- 结构化日志字段：`chain, state, cursor, head, lag_blocks, lag_seconds, endpoint_label, rps_wait_ms, rows_written, unattributed_rows, reorgs`。
- 告警条件（索引器自查，每轮）：`stalled` 持续 > 5 分钟；`lag_seconds` > 30 分钟；重组发生；某端点 `mismatch`；任务 `failed`。动作：写 `chain_scan_alert`（管理端顶部横幅 + 卡片红标）+ 可选 webhook `INDEXER_ALERT_WEBHOOK`（企业微信 / Slack 通用 JSON）。恢复时写"已恢复"。
- 指标暴露留给 OTel（`docs/ARCHITECTURE.md` §7 的既定方向），本期只做日志 + 表。

### 4.15 测试

- Go 单测（假 RPC）：分片与地址分组边界；同事务写行 + 游标；重组回退与 `orphaned`；端点健康度状态机（失败计数、冷却、chainId 不符、落后节点跳过、限速等待）；`-32614` 跨度减半；`balance` 模式的余额差触发、`unattributed` 生成与 `attribute` 任务替换；缺口 > `native_gap_cap` 的分支；配置热加载重建 worker；租约互斥与接管；bootstrap 按构建号过滤链。
- 集成（dev，OP Sepolia，prax1s 租户）：转 USDC 与 ETH 到模拟器钱包 → 表 → 接口 → App 记录页 → 推送；停索引器 10 分钟再启动看追块与"已索引到"提示；配置里换成错链端点看保存被拒；两端点其一断网看切换与健康表。
- 主网前置：为 bsc / eth 提供可扫链端点并体检通过后再启用。

## 5. 分期

1. 迁移 24（全部表）+ `internal/indexer`（ERC-20 + 原生币两种模式 + 游标 / 重组 / 多端点 / 热加载 / 租约）+ `indexer` 子命令 + compose；dev 只开 op-sepolia。
2. 平台级管理接口 + RN-Admin"扫链管理"页（配置、体检、状态、暂停、任务、地址查询）+ 审计。
3. 移动端接口 + 契约同步 + App 合并与记录页状态 + 收款页轮询。
4. 追块任务（`attribute` / `rescan` / `rebuild_watch`）+ 告警。
5. 会话 ↔ 安装关联 + 定向推送。
6. 新链门禁（目录 `minBuild` + bootstrap 过滤 + 向导）。
7. 主网链启用：端点由用户在管理端填入并体检通过后 `enabled=true`，无代码变更。

## 6. 已决事项（2026-09-06）

- 主网扫链端点：由用户在管理端维护，本设计只提供配置、体检、健康度与切换；代码不内置端点。bsc / eth 的公共默认端点已实测不可用于扫链，仅作说明。
- 平台管理员身份：沿用配置文件里的管理员账号，用 `PLATFORM_ADMIN_USERNAMES` 明确列出；未配置即拒绝，不按租户过滤。
- `unattributed` 收款推送：推送。
