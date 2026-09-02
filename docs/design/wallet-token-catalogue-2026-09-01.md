# 代币目录设计：不同链、不同租户的币种（2026-09-01）

## 一、现状：这块目前没有设计

先把事实摆清楚，三个仓库都查过：

| 层 | 现状 | 证据 |
| --- | --- | --- |
| RN-Server | **完全没有代币概念**。没有代币表、没有代币 API、没有任何把代币下发给 App 的通路 | `internal/api/server.go:786` 的 `validateWalletSection` 只允许 `walletConnectProjectId` / `chains` / `networks` 三个键；迁移最大编号 27，无一与代币相关 |
| RN-Admin | **没有任何代币管理界面**。「钱包与链」页只能配 projectId、每条链的启用开关 / 自定义 RPC / 区块浏览器地址 | `src/modules/app-config/wallet-page.tsx:552-703`；全仓搜 token/coin/币种，只命中测试网风险提示文案 |
| RN-App | 代币写死在 `src/features/wallet/fixtures/wallet.ts`，`verified` 是手写的字面量布尔值；**没有任何从服务端拉代币列表的代码** | `fixtures/wallet.ts:54-163`；`bootstrap.schema.ts:141-160` 的 wallet 段无代币字段 |

所以"不同链不同租户的币种会不一样"这件事**现在完全没有支撑**——所有租户看到的是同一份写死的演示币。

## 二、结论：应该独立一张表

不是"可以"，是"应该"，四条理由：

1. **它是行集合，不是几个标量。** 塞进 `app_configs` 的配置 JSON 里，改一个币就要整块读-改-写，乐观锁的冲突面从"一个币"放大成"整份租户配置"——运营改文案和改代币会互相顶掉。而且没法按链 / 合约建唯一键，管理端也做不了分页与搜索。

2. **需要"全局 + 租户覆盖"两层。** USDT / USDC 这类主流币应该平台维护一份，租户只做启用、停用、排序，外加自己的自定义币。`language_document` 已经有 `tenant_id = 0 表示全局` 的先例（`internal/store/migrations.go:788-804`），照抄这个约定，团队不需要学一套新概念。

3. **需要唯一键防重复。** 同一条链上同一个合约只能有一条记录。注意合约地址**大小写不同会绕过唯一键**，所以入库前必须做 EIP-55 校验并规范化。

4. **审计与乐观锁不用另起炉灶。** 现成模式是 `app_configs.version` 乐观锁 + `audit_events` + 每次写操作必填 `reason`（≥3 字，`internal/api/localization.go:423,551`）。代币的写操作挂到同一套上即可。

## 三、表结构

```sql
CREATE TABLE IF NOT EXISTS chain_token (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '代币主键',
    tenant_id BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，0表示平台全局代币',
    chain VARCHAR(32) NOT NULL COMMENT '链 id，与平台链目录一致：bsc/eth/base/op-sepolia',
    contract_address VARCHAR(42) NOT NULL COMMENT '合约地址，入库前已做 EIP-55 规范化；native 表示原生币',
    symbol VARCHAR(32) NOT NULL COMMENT '代币符号，从链上 symbol() 读取',
    name VARCHAR(128) NOT NULL DEFAULT '' COMMENT '代币全名，可人工修订',
    decimals TINYINT UNSIGNED NOT NULL COMMENT '精度，从链上 decimals() 读取；错一位金额差 10 倍',
    logo_color VARCHAR(16) NOT NULL DEFAULT '' COMMENT '列表占位色',
    sort_weight INT NOT NULL DEFAULT 0 COMMENT '展示排序，越大越靠前',
    enabled TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否下发给 App；租户可用一条覆盖行停用全局币',
    source TINYINT NOT NULL DEFAULT 0 COMMENT '元数据来源：0=链上读取 1=人工录入',
    ctime DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
    mtime DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '修改时间',
    deleted TINYINT(1) NOT NULL DEFAULT 0 COMMENT '软删除标记',
    PRIMARY KEY(id),
    UNIQUE KEY uk_chain_token(chain, contract_address, tenant_id),
    KEY ix_chain_token_tenant(tenant_id, chain, enabled, deleted)
) ENGINE=InnoDB COMMENT='全局与租户代币目录'
```

迁移编号取 **28**（当前最大 27 = `release_mandatory_flag`）。

### 几个不明显但重要的决定

**表里没有 `verified` 列，这是刻意的。** 客户端只认自己那份白名单（`RN-App/src/core/wallet/config/token-allowlist.ts`，已接进 `getBalances` 与 `send`），**下发的 verified 一律不采纳**。加这一列的唯一后果是让人以为它有用——而它恰恰是一个被攻破的服务端最想控制的字段：把攻击者的合约标成"已验证"，用户就没有了最后一道视觉防线。管理端可以显示「这个地址在 App 客户端白名单内 / 不在」作为运营提示，但那是查客户端那份表，不是读服务端这一列。

**`symbol` 与 `decimals` 必须从链上读，不能人工填。** 同一个 USDT，BSC 上是 18 位精度、以太坊上是 6 位——这是实测事实，凭直觉填必然出错，而 decimals 错一位金额就差 10 倍。管理端只输入「链 + 合约地址」，服务端调 RPC 读 `symbol()` / `decimals()` 回填；人工只能改 name、排序、启用状态。`source` 字段记录这条到底是读来的还是填的。

**读链时节点是不可信的**，三件事必须做：调用要有**超时**；响应要有**大小上限**（恶意或故障的节点可以返回巨大响应打满内存）；`symbol()` 的返回要**按长度分支**——老代币（MKR）返回 `bytes32`，规范代币（USDC）返回 `string`，按一种解必然在另一种上出错。

**`enabled` 和 `deleted` 是两个语义**，别合并：`enabled=0` 是"暂时不下发"，`deleted=1` 是"这条记录作废"。租户要停用一个全局币，做法是插一条 `tenant_id=<租户>, enabled=0` 的覆盖行。

## 四、合并规则（服务端做，App 只拿结果）

1. 取 `tenant_id IN (0, :tenant)` 且 `deleted=0`；
2. 按 `(chain, contract_address)` 分组，**租户行覆盖全局行**；
3. 过滤掉 `enabled=0` 的；
4. 只保留该租户已启用的链上的币（与 wallet 段的 `chains` 对齐）；
5. 按 `sort_weight DESC, symbol ASC` 排序。

合并只在服务端做一次。放两份实现，迟早会不一致。

## 五、下发通路：放进 bootstrap，不单开接口

建议加在 bootstrap 的 wallet 段：`wallet.tokens: [{chain, address, symbol, name, decimals, logoColor}]`。

- **体积不是问题**：一条约 142 字节，60 条约 8KB；bootstrap 已经带着 740 键 × 2 语言的文案（本地 seed 各 40KB），这点增量可以忽略。
- **冷启动少一次往返**，而余额查询强依赖代币列表——单开接口意味着进入资产页之前多一个串行请求。
- **拆分阈值**：单租户超过 200 条（约 28KB）就该改成带版本号 / ETag 的独立接口。到那一步再拆不迟，现在拆是给一个不存在的规模提前付代价。
- App 侧 schema 加在 `bootstrap.schema.ts` 的 wallet 段，**optional + 默认空数组**：老服务端不下发时按空处理，不能因为服务端版本落后就让整个 bootstrap 解析失败（这是既有约定）。

## 六、管理端配套：需要新增一页

现在没有任何代币管理功能。新增一页要动 5 处（模块注册机制见 `RN-Admin/src/plugin-system/registry.ts`）：

1. `src/modules/token-management/token-page.tsx` — 页面
2. `src/modules/token-management/plugin.ts` — 导出 `AdminPlugin`
3. `src/app/App.tsx` — `registerAdminPlugin(...)` + `iconMap` 补图标
4. `src/core/api.ts` — zod schema + `adminApi` 方法
5. `token-page.spec.tsx` — 测试

页面结构对齐既有的 `localization-page.tsx`（同一套 `Card` / `SidePanel` / `ConfirmDialog` / `EmptyState` / `StatusPill`，reason 输入 + `expectedVersion` 乐观锁）：

- 按链分组的列表；全局币与租户币用徽标区分；测试链的币显式标注（测试链代币没有价值，和主网并排出现时用户会当成真资产）
- 「按合约地址添加」：输入链 + 地址 → 服务端读链回填 symbol / decimals → 人工确认后入库。**不提供手填精度的输入框**
- 启用 / 停用、排序、软删除
- 一条运营提示：「这个地址不在 App 客户端白名单内，用户转出时会看到未验证警示」

## 七、落地顺序，以及必须先说的一个风险

**当前状态：链上转出由管理端的 `onchainSends` 开关控制（默认关）。** 打开后转出走真链、原生币余额来自真链，但代币（ERC-20）余额仍是演示数据。用户会遇到"界面上有 500 USDT，转出却说余额不足"——`TransferService` 用链上真实余额做预检，所以**不会转错钱**，但这个体验是自相矛盾的。

**结论：在代币目录与链上代币余额落地之前，不要在管理端打开任何生产租户的 `onchainSends`。** 要验证真链路径就用 OP Sepolia（它已经带 `testnet` 标记贯穿管理端与 App，且默认不启用）。

顺序：

1. 服务端：迁移 28 + 链上元数据读取器（超时 / 大小上限 / bytes32 分支）+ 合并下发
2. App：bootstrap schema 加字段；`getBalances` 改用 `ChainClient.getTokenBalances`（Multicall3 已落地）
3. 管理端：代币管理页
4. 以上都完成后，才在管理端为生产租户打开 `onchainSends`
