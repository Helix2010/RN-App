# 代币目录设计：不同链、不同租户的币种（2026-09-01，2026-09-02 修订）

修订记录：2026-09-02 增加**展示精度** `display_decimals`（表、接口、App 三处）；明确 `symbol` /
`decimals` 在添加合约时**由服务端从链上读取、不可编辑**；补充链上读取的安全约束、原生币与
主流币的初始数据、管理端表单的字段权限、App 侧的截断规则。

## 一、现状：这块目前没有设计

先把事实摆清楚，三个仓库都查过：

| 层 | 现状 | 证据 |
| --- | --- | --- |
| RN-Server | **完全没有代币概念**。没有代币表、没有代币 API、没有任何把代币下发给 App 的通路 | `internal/api/server.go` 的 `validateWalletSection` 只允许 `walletConnectProjectId` / `chains` / `networks` / `onchainSends` 四个键；迁移最大编号 27，无一与代币相关 |
| RN-Admin | **没有任何代币管理界面**。「钱包与链」页只能配 projectId、每条链的启用开关 / 自定义 RPC / 区块浏览器地址、链上转出开关 | `src/modules/app-config/wallet-page.tsx`；全仓搜 token/coin/币种，只命中测试网风险提示文案 |
| RN-App | 代币写死在 `src/features/wallet/fixtures/wallet.ts`，`verified` 是手写的字面量布尔值；**没有任何从服务端拉代币列表的代码** | `fixtures/wallet.ts:54-163`；`bootstrap.schema.ts` 的 wallet 段无代币字段 |

所以"不同链不同租户的币种会不一样"这件事**现在完全没有支撑**——所有租户看到的是同一份写死的演示币。

## 二、结论：应该独立一张表

不是"可以"，是"应该"，四条理由：

1. **它是行集合，不是几个标量。** 塞进 `app_configs` 的配置 JSON 里，改一个币就要整块读-改-写，乐观锁的冲突面从"一个币"放大成"整份租户配置"——运营改文案和改代币会互相顶掉。而且没法按链 / 合约建唯一键，管理端也做不了分页与搜索。

2. **需要"全局 + 租户覆盖"两层。** USDT / USDC 这类主流币应该平台维护一份，租户只做启用、停用、排序、展示精度，外加自己的自定义币。`language_document` 已经有 `tenant_id = 0 表示全局` 的先例（`internal/store/migrations.go:788-804`），照抄这个约定，团队不需要学一套新概念。

3. **需要唯一键防重复。** 同一条链上同一个合约只能有一条记录。注意合约地址**大小写不同会绕过唯一键**，所以入库前必须做 EIP-55 校验并规范化。

4. **审计与乐观锁不用另起炉灶。** 现成模式是 `app_configs.version` 乐观锁 + `audit_events` + 每次写操作必填 `reason`（≥3 字，`internal/api/localization.go:423,551`）。代币的写操作挂到同一套上即可。

## 三、表结构

```sql
CREATE TABLE IF NOT EXISTS chain_token_catalog (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '代币主键',
    tenant_id BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，0表示平台全局代币',
    chain VARCHAR(32) NOT NULL COMMENT '链 id，与平台链目录一致：bsc/eth/base/op-sepolia',
    contract_address VARCHAR(42) NOT NULL COMMENT '合约地址，入库前已做 EIP-55 规范化；native 表示原生币',
    symbol VARCHAR(32) NOT NULL COMMENT '代币符号。添加时由服务端从链上 symbol() 读取，不可编辑',
    name VARCHAR(128) NOT NULL DEFAULT '' COMMENT '代币全名。添加时从链上 name() 预填，可人工修订',
    decimals TINYINT UNSIGNED NOT NULL COMMENT '链上精度（协议事实）。添加时从链上 decimals() 读取，不可编辑；错一位金额差 10 倍',
    display_decimals TINYINT UNSIGNED NOT NULL COMMENT '展示精度：界面显示与输入保留的小数位，向下截断；0 ≤ display_decimals ≤ decimals；只影响显示，绝不参与金额换算',
    logo_color VARCHAR(16) NOT NULL DEFAULT '' COMMENT '列表占位色',
    sort_weight INT NOT NULL DEFAULT 0 COMMENT '展示排序，越大越靠前',
    enabled TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否下发给 App；租户可用一条覆盖行停用全局币',
    metadata_synced_at DATETIME(3) NULL COMMENT '最近一次从链上读取 symbol/decimals 的时间',
    ctime DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
    mtime DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '修改时间',
    deleted TINYINT(1) NOT NULL DEFAULT 0 COMMENT '软删除标记',
    PRIMARY KEY(id),
    UNIQUE KEY uk_chain_token(chain, contract_address, tenant_id),
    KEY ix_chain_token_tenant(tenant_id, chain, enabled, deleted)
) ENGINE=InnoDB COMMENT='全局与租户代币目录'
```

迁移编号取 **28**（当前最大 27 = `release_mandatory_flag`），表名 `chain_token_catalog`。乐观锁锚点是 `app_configs` 里独立的 `tokens` 键（照多语言用 `languages` 键的先例）：复用 bootstrap 的版本会让还在继承全局配置的租户因加一个币就被迫复制一份配置；首次写入 `expectedVersion=0`。上一版里的 `source` 列去掉了：
元数据只能来自链上，不存在"人工录入"这个来源，留着这一列只会诱导人去开一个手填入口。

### 两个精度是两回事，必须分开命名

| 列 | 含义 | 来源 | 谁能改 | 用在哪 |
| --- | --- | --- | --- | --- |
| `decimals` | **链上精度**，协议事实 | 添加时从链上 `decimals()` 读 | 谁都不能改；只能"重新从链上读取" | 最小单位与人类可读金额之间的换算、签名、余额比较 |
| `display_decimals` | **展示精度**，产品决定 | 添加时默认 `min(6, decimals)`（稳定币建议 2） | 运营 | 列表、余额、输入框、"全部转出"的截断 |

写死的规则：**展示精度只影响"显示成什么样"，任何一处金额换算都不允许读它。** 一旦有人拿
`display_decimals` 去算最小单位，就会出现 USDT 转 1.005 实际转 1.00 这类静默差错。App 侧
用类型把它们隔开：`Money.decimals` 永远是链上精度，展示精度只出现在格式化函数的参数里。

### `symbol` / `decimals` 为什么不可编辑

同一个 USDT，BSC 上是 18 位精度、以太坊上是 6 位——这是实测事实，凭直觉填必然出错，而
`decimals` 错一位金额就差 10 倍。所以管理端**没有**这两个字段的输入框：添加时只输入「链 +
合约地址」，服务端读链回填；需要更新时只提供「重新从链上读取」这一个动作。人工能改的只有
`name`、`display_decimals`、`logo_color`、`sort_weight`、`enabled`。

### 链上读取的安全约束（服务端）

读元数据这一步是把外部数据写进数据库，节点是不可信的，六条约束缺一不可：

1. **只用平台自己的节点，不用租户配置的端点。** 租户能配 RPC，就能配一个返回假 `decimals`
   的节点。读元数据必须走 `supportedNetworks` 里平台维护的默认端点。
2. **先核对链。** 调用前 `eth_chainId` 必须等于目录里该链的 chainId，防止端点指错链。
3. **地址必须有代码。** `eth_getCode` 为空说明是普通地址不是合约，直接拒绝——转给它的钱会永久
   丢失。
4. **超时与响应大小上限。** 每次 `eth_call` 5 秒超时、响应体 64KB 上限；恶意或故障的节点可以
   返回巨大响应打满内存。
5. **`symbol()` / `name()` 按返回长度分支。** 老代币（MKR）返回 `bytes32`，规范代币（USDC）返回
   ABI `string`，按一种解必然在另一种上出错。解出来的字符串再做一次清洗：只允许可打印字符、
   长度 ≤ 32 / 128，否则拒绝——链上的 symbol 是任何人都能写的，会有人把它写成 "USDT " 或带
   零宽字符。
6. **`decimals()` 的合理范围是 0～36。** 超出直接拒绝。

`native` 这一行不读链：原生币没有合约，`symbol` / `decimals` 来自平台链目录。为此 `supportedNetworks`
要补两个字段 `nativeSymbol` / `nativeDecimals`（现在目录里没有），并随 `walletCatalog` 一起
下发，让管理端也能显示。

### 初始数据（随迁移 28 一起写入，`tenant_id = 0`）

- 每条链的原生币一行（`contract_address = 'native'`）。
- 五个已在链上核验过的主流稳定币：BSC USDT / USDC（18 位）、以太坊 USDT / USDC（6 位）、
  Base USDC（6 位）。这五个地址与精度**必须**和 App 客户端白名单
  `src/core/wallet/config/token-allowlist.ts` 逐字一致，服务端加一个测试把两份表对照。
- 测试链（op-sepolia）只有原生币，不预置任何代币。

### 几个不明显但重要的决定

**表里没有 `verified` 列，这是刻意的。** 客户端只认自己那份白名单（已接进 `getBalances` 与
`send`），**下发的 verified 一律不采纳**。加这一列的唯一后果是让人以为它有用——而它恰恰是
一个被攻破的服务端最想控制的字段：把攻击者的合约标成"已验证"，用户就没有了最后一道视觉
防线。管理端可以显示「这个地址在 App 客户端白名单内 / 不在」作为运营提示，但那是查客户端
那份表，不是读服务端这一列。

**`enabled` 和 `deleted` 是两个语义**，别合并：`enabled=0` 是"暂时不下发"，`deleted=1` 是
"这条记录作废"。租户要停用一个全局币，做法是插一条 `tenant_id=<租户>, enabled=0` 的覆盖行；
租户要给一个全局币换展示精度，同样插一条覆盖行——覆盖行的 `symbol` / `decimals` 由服务端从
全局行复制，不再读链。

## 四、合并规则（服务端做，App 只拿结果）

1. 取 `tenant_id IN (0, :tenant)` 且 `deleted=0`；
2. 按 `(chain, contract_address)` 分组，**租户行覆盖全局行**；
3. 过滤掉 `enabled=0` 的；
4. 只保留该租户已启用的链上的币（与 wallet 段的 `chains` 对齐）；
5. 按 `sort_weight DESC, symbol ASC` 排序。

合并只在服务端做一次。放两份实现，迟早会不一致。

## 五、接口

### 管理端（`/v1/admin/tokens`，全部走既有的 reason + expectedVersion + audit_events）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/v1/admin/tokens?chain=` | 合并视图（全局 + 本租户覆盖），每行标注 `scope: global \| tenant` |
| POST | `/v1/admin/tokens/preview` | 入参 `{chain, contractAddress}`。**只读链、不入库**，返回 `{symbol, name, decimals, codeSize, allowlisted}`，供表单预览 |
| POST | `/v1/admin/tokens` | 入参 `{chain, contractAddress, displayDecimals, name?, logoColor?, sortWeight?}`。服务端**再读一次链**回填 `symbol` / `decimals`（不信 preview 的结果——那是两个请求，中间可以被改） |
| PATCH | `/v1/admin/tokens/{id}` | 只接受 `name` / `displayDecimals` / `logoColor` / `sortWeight` / `enabled`；出现 `symbol` / `decimals` / `contractAddress` / `chain` 直接 400 |
| POST | `/v1/admin/tokens/{id}/resync` | 重新从链上读取 `symbol` / `decimals`；读到的值与库里不一致时**不覆盖**，返回差异让运营确认——精度变了意味着合约升级或地址被换，不该静默接受 |
| DELETE | `/v1/admin/tokens/{id}` | 软删除 |

校验：`displayDecimals` 必须是 `0 ≤ n ≤ decimals` 的整数；`contractAddress` 入库前 EIP-55
规范化；同一 `(chain, contractAddress, tenant)` 重复时 409。

### 下发（bootstrap 的 wallet 段）

```json
"wallet": {
  "walletConnectProjectId": "…",
  "onchainSends": false,
  "chains": ["bsc", "eth"],
  "networks": [ … ],
  "tokens": [
    { "chain": "bsc", "address": "native", "symbol": "BNB", "name": "BNB",
      "decimals": 18, "displayDecimals": 4, "logoColor": "#F0B90B" },
    { "chain": "bsc", "address": "0x55d398326f99059fF775485246999027B3197955", "symbol": "USDT",
      "name": "Tether USD", "decimals": 18, "displayDecimals": 2, "logoColor": "#26A17B" }
  ]
}
```

放进 bootstrap 而不单开接口：一条约 160 字节，60 条约 10KB；bootstrap 已经带着 740 键 × 2
语言的文案，这点增量可以忽略；冷启动少一次往返，而余额查询强依赖代币列表。单租户超过
200 条再拆成带版本号 / ETag 的独立接口，到那一步再拆不迟。

**下发里不带 `verified`**，理由见第三节。

## 六、App 侧

### schema 与类型

`bootstrap.schema.ts` 的 wallet 段加 `tokens`，**optional + 默认空数组**（老服务端不下发时按空
处理，不能因为服务端版本落后就让整个 bootstrap 解析失败）。每条：

```ts
{
  chain: chainIdSchema,
  address: z.string(),            // "native" 或 EIP-55 地址
  symbol: z.string().min(1).max(32),
  name: z.string().max(128).default(""),
  decimals: z.number().int().min(0).max(36),
  displayDecimals: z.number().int().min(0).max(36),
  logoColor: z.string().default(""),
}
```

解析后再做一遍客户端断言（和 chainId、https 一样属于"客户端自己能判断的事实"）：
`displayDecimals > decimals` 的条目把展示精度截到 `decimals`；`address` 不是 `native` 且不是
合法 EIP-55 地址的条目丢弃并 warn；已有的 `trustedTokens` 白名单继续在 `getBalances` 里
重写 `verified`、丢弃元数据不符的条目。

`TokenRef` 增加 `displayDecimals: number`。`Money.decimals` 保持链上精度不变。

### 展示规则：向下截断，不四舍五入

新增 `formatTokenAmount(value: Money, displayDecimals: number, locale)`：按展示精度**向下截断**
后再做本地化格式化。截断而不是四舍五入，因为四舍五入会把 0.999 显示成 1.00——用户看到
"1.00 USDT"却转不出 1 个。

| 位置 | 用什么 |
| --- | --- |
| 资产列表、账户详情、发送页的"余额 {amount}" | `formatTokenAmount`（展示精度） |
| 金额输入框 `AmountInput` 的 `decimals` | 展示精度（不能输入比能看到的更多位） |
| "全部转出" / 25%～100% 预设 | 先按整数算出精确值，再**截断到展示精度**填入输入框——所见即所签，多出来的尘埃留在余额里 |
| 确认页的金额行、进度页标题 | **精确值**（`toDecimalString` 全精度），已落地；这一处永远不截断 |
| 手续费 | 原生币的展示精度，但不足一个最小展示单位时显示 `< 0.0001 BNB` 而不是 `0.0000 BNB` |

第四行是关键：之前"全部转出"填的是全精度余额，现在输入框只能显示展示精度，两者不一致会
让用户看到 `1.23` 却签出 `1.234567`。统一成"填进输入框的就是要签的"。

### 余额查询失败时的行为：报错，不退回演示账本

真链上读不到余额（节点限流、Multicall revert）时 `getBalances` **抛错**，而不是"沿用上一次
的值"——这里没有上一次的值，能拿到的只有演示账本里种下的数字，把它当余额显示等于在真链上
撒谎，而且 React Query 会用这个"成功"结果覆盖掉缓存里上一次真实的链上数据。抛错的话缓存
保留、界面显示"暂时读不到"，重试后自然恢复。Multicall 里单条缺失的代币不显示，也不退回
演示数字。参考价只给白名单内的币：任何合约都能把 `symbol()` 写成 ETH。

### 余额查询

`getBalances` 对开了 `onchainSends` 的链：原生币走 `getNativeBalance`（已落地），代币走
`ChainClient.getTokenBalances`（Multicall3，已落地）——代币列表来自下发的 `tokens`，不再来自
演示夹具。价格来源另议，第一版 `usdValue` 沿用现有做法。

## 七、管理端配套：需要新增一页

新增一页要动 5 处（模块注册机制见 `RN-Admin/src/plugin-system/registry.ts`）：

1. `src/modules/token-management/token-page.tsx` — 页面
2. `src/modules/token-management/plugin.ts` — 导出 `AdminPlugin`
3. `src/app/App.tsx` — `registerAdminPlugin(...)` + `iconMap` 补图标
4. `src/core/api.ts` — zod schema + `adminApi` 方法
5. `token-page.spec.tsx` — 测试

页面结构对齐既有的 `localization-page.tsx`（同一套 `Card` / `SidePanel` / `ConfirmDialog` /
`EmptyState` / `StatusPill`，reason 输入 + `expectedVersion` 乐观锁）。

**列表**：按链分组；全局币与租户覆盖行用徽标区分；测试链的币显式标注；每行显示
symbol、精度（`18 位 · 展示 2 位`）、启用状态、白名单提示（「不在 App 客户端白名单内，用户
转出时会看到未验证警示」）。

**添加表单（三步，字段权限写死）**：

| 步骤 | 字段 | 可编辑 |
| --- | --- | --- |
| 1 | 链（下拉，来自 `walletCatalog`）、合约地址 | 是 |
| 2 | 点「读取链上信息」→ 调 `preview` → 显示 symbol / name / decimals / 是否在白名单 | **symbol、decimals 只读灰显**；name 预填可改 |
| 3 | 展示精度（默认 `min(6, decimals)`，上限 = decimals，界面上写明"只影响显示"）、排序、颜色、启用 | 是 |

「读取链上信息」失败时（不是合约、超时、链不匹配）表单不能进入第三步——没有链上数据就没有
这条记录。

**编辑表单**：symbol / decimals / 合约地址 / 链四项只读灰显，旁边一个「重新从链上读取」按钮
走 `resync`；有差异时弹确认框把新旧值并排展示，运营确认后才写入。

## 八、落地顺序，以及必须先说的一个风险

**当前状态：链上转出由管理端的 `onchainSends` 开关控制（默认关）。** 打开后转出走真链、
原生币余额来自真链，但代币（ERC-20）余额仍是演示数据。用户会遇到"界面上有 500 USDT，
转出却说余额不足"——`TransferService` 用链上真实余额做预检，所以**不会转错钱**，但这个体验
是自相矛盾的。

**结论：在代币目录与链上代币余额落地之前，不要在管理端打开任何生产租户的 `onchainSends`。**
要验证真链路径就用 OP Sepolia（它已经带 `testnet` 标记贯穿管理端与 App，且默认不启用）。

顺序：

1. 服务端：目录补 `nativeSymbol` / `nativeDecimals`；迁移 28（建表 + 初始数据）；链上元数据
   读取器（平台节点、链核对、代码检查、超时、大小上限、bytes32 分支、字符串清洗）；六个
   管理接口；合并下发 `wallet.tokens`
2. App：schema 与客户端断言；`TokenRef.displayDecimals`；`formatTokenAmount` 与四处展示规则；
   `getBalances` 的代币余额改用 Multicall3；删掉演示夹具里的代币表
3. 管理端：代币管理页（列表 / 三步添加 / 只读编辑 + 重新读取）
4. 以上都完成后，才在管理端为生产租户打开 `onchainSends`
