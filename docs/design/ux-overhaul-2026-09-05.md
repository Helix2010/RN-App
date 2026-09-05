# App 体验整改：锁屏 / 资产 / 划转记录 / 启用流程 / 验证策略 / 行情与下单（2026-09-05）

本文是对 2026-09-05 提出的五组问题的分析、决策与落地记录。结论以代码为准；每一条都标出对应实现。

## 1. 锁屏页

**问题**：锁屏只有一个"解锁"按钮，且左右不居中。

**根因**：`PrimaryButton` 的样式基类带 `alignSelf: "stretch"`，父容器的 `alignItems="center"` 对它不生效；再叠 `maxWidth={280}` 就被钉在左侧。

**方案（已落地，`src/features/security/app-lock-gate.tsx`）**：
- 去掉按钮。进入锁定态自动弹一次系统验证；用户取消后，轻触页面中央的 112px 圆形图标重试（testID `app-lock-unlock` 不变）。
- 图标按本机验证方式变化：指纹 / 面容 / 虹膜 / 设备密码（`biometricKind()`，`expo-local-authentication` 的 `supportedAuthenticationTypesAsync`），提示文案随之换（`security.unlock.hint.*`）。
- 布局改成三段：顶部品牌标 + 标题，中部图标 + 提示，底部副标题；所有元素只用 `alignItems="center"`，不再有 `alignSelf: stretch` 的元素。

## 2. 资产页

### 2.1 显示慢

**根因**：`AssetsOverviewGateway.getOverview` 用 `Promise.all([wallet.getBalances(全部链), predictAccount.getBalance])` 等所有链 + 平台余额都回来才返回一份总览；界面在此之前全是骨架。一条链的 RPC 慢，整页跟着等。

**方案（已落地）**：
- 删除 `AssetsOverviewGateway` / `AssetsGateway`；`useAssetsOverview`（`src/features/assets/hooks/use-assets.ts`）改成 `useQueries`：每条启用的链一个查询（键 `["wallet-balances", address, chain]`，与既有失效逻辑兼容），预测账户复用 `usePredictAccountBalance`。
- 纯函数 `composeOverview`（`src/features/assets/model/overview.ts`）把逐链结果拼成总览：还没返回的链先按下发目录（`deliveredTokens`）列出币种、金额留骨架；哪条链先到先填哪条；合计随到达累加，`loading` 时总额旁转圈，`partial` 只在全部到达后才标"部分合计"。
- 账户详情页（钱包）改用同一份数据按链筛选，不再单独发"全部链"的整批查询。

### 2.2 链筛选的样式

**问题**：链筛选是一排药丸按钮、全名（"BNB Smart Chain · 测试网"），一行放不下就换行。

**方案（已落地）**：设计系统新增 `ChipRow`（`src/design-system/controls.tsx`）：横向滚动、短名 + 链品牌色点 + 测试网小标、选中用文字色反白（主色留给操作按钮）。资产页、账户详情、收款页、DEX 授权 / 兑换记录、拆合面板的市场选择统一改用它。

`SegmentedControl` 重做成"一条轨道 + 选中段浮起"的分段控件，只用于 2–4 个互斥选项（买/卖、市价/限价、区间）。

### 2.3 划转

- **对调箭头不居中**：原来挂在"从"这一行右侧。改为 `DirectionCard`：从 / 到两行各 56px，对调按钮绝对定位在两行分界线上并按容器高度竖直居中（`transfer-swap-direction`）。
- **没有记录、不知道中间状态**：见第 3 节。

### 2.4 预测账户页

"划转 / 取回钱包 / 拆分 / 合并"三个次级按钮挤成一行、文案被截断。改成四个 `ActionTile`（图标在上、文字在下）：转入（主色）/ 取回 / 拆分合并 / 记录，与资产页的收款 / 转出 / 划转同一语言；下方新增"最近记录"三条 + "查看全部"。首页的存入 / 提现 / 划转三个按钮同样改成 `ActionTile`（英文 "Withdraw" 之前会截成 "Withdr…"）。

## 3. 资金记录（划转 / 充值 / 提现）

### 3.1 事实

| 操作 | 数据在哪里 |
| --- | --- |
| 转入预测账户（USDC approve + wrap / USDW transfer） | 只有链上交易；平台 data-service 的 `/activity` 不含 DEPOSIT 类型 |
| 取回（initiateUnwrap） | 平台子图 `GET /unwrap-requests?safe=&claimed=` 有索引（含已领取），但有延迟 |
| 领取（claimUnwrap + USDC.transfer） | 同上（`claimed=true` 时带 `claimTxHash`） |
| 钱包转出（走链） | 本机 `OnchainTransfers` 记录（`listTransfers`） |
| 钱包收款（走链） | **没有来源**：没有索引服务就列不出别人打给这个地址的转账 |

### 3.2 方案（已落地）

- `FundLedger`（`src/features/predict/api/fund-ledger.ts`）：本机资金账本，按 平台域名 + scopeId + 地址 分键存普通存储；记录模型 `FundRecord`（`model/fund-record.ts`）：kind = deposit / withdraw / claim，status = pending / confirmed / failed / waiting / claimable / claimed。
- 写入点（`HttpPredictAccountGateway`）：
  - 转入：签名前先记 pending，每一步（approve / wrap / transfer）更新 `step`，拿到哈希写 `hash`；失败写 `failed` + 原因；`getTx` 轮询到终态回写 confirmed / failed。
  - 取回：发起前记 pending；回执 + `UnwrapInitiated` 事件后改 `waiting` 并写 requestId / claimableAt；失败写 failed。
  - 领取：新增 claim 记录（confirmed），并把对应取回记录改成 claimed。
- 读取：`listFundRecords` = 本机记录 ∪ 平台解包请求（open + claimed），同一 requestId 以平台为准（`mergeFundRecords`）。
- 界面：`RecordsScreen`（路由 `Records`）两个 Tab：划转（上表前三行）/ 钱包转账（本机转出 + 账本收款）；点一行看详情（哈希复制、解包请求号、可领取时间、失败原因）。入口：资产页右上角、账户详情右上角与"记录"格、划转表单底部与进度页的"查看记录"。
- 有进行中的记录时 5 秒刷新一次（`useFundRecords`）。

### 3.3 未解决（需要后端）

链上收款记录需要索引服务（RN-Server 侧按租户启用的链扫 Transfer 事件，或接第三方索引）。App 端的钱包 Tab 只列本机发起的转出，并在页面顶部说明。**这是后端待办，不是 App 能单方面补的。**

## 4. 预测账户启用与验证策略

### 4.1 一步一勾

**根因**：引导页的勾选来自服务端状态（`usePredictEnablement`），而这个查询要等整个 `enable()` 结束才失效重取；进行中只有 spinner。

**方案（已落地）**：`useEnablePredict` 记录本次运行已完成的步骤——网关按顺序推进，`onStep(next)` 到来即意味着前面的都完成了；成功后四步全勾。引导页 `done = 服务端状态 ∪ 本次已完成`。

### 4.2 授权那一步"闪回"

**根因**：`enablement()` 每次都读链核对 7 项授权（4 个 `allowance` + 3 个 `isApprovedForAll`）。公共 RPC 节点落后几个块时，刚授权的账户被判成未授权，划转表单就显示"去启用"，下一次轮询又恢复。

**方案（已落地）**：授权是单向的（approve MAX + setApprovalForAll），链上核实一次后把 Safe 地址记进凭证（`PredictCredentials.approvedSafe`，安全存储，凭证丢弃时一起清）；之后 `enablement()` 不再逐次读链。`enable()` 等到授权可见后也写这个字段。

### 4.3 双重验证

**现状**：敏感操作先弹系统验证（`useRequireVerification`），随后钱包签名又由金库门控再弹一次（5 分钟解锁窗）。

**方案（已落地）**：偏好 `txVerification`（`src/core/preferences/preferences-store.ts`，存储版本 v2，老的布尔 `txConfirm` 迁移：true → smart，false → off）：

| 策略 | 行为 |
| --- | --- |
| `smart`（默认） | 最近 5 分钟内通过过系统验证（解锁应用 / 上一次操作 / 签名）就不再弹，只保留钱包签名那一道 |
| `always` | 每次先弹系统验证，并把金库锁上（`lockKeys()`），签名时再验一次 |
| `off` | 不弹；单笔超过大额阈值或规模未知仍验证 |

"最近验证过"记在 `core/security/app-lock.ts`（`noteVerified` / `verifiedWithin`），`authenticate()` 成功即记录，应用上锁时清零。设置页与安全中心的"交易前验证"行改为三选一面板（`TxVerificationSheet`）。

## 5. 行情图 / 盘口 / 下单（对照 user-dapp `origin/dev`）

对照文件：`components/markets/PriceChart.tsx`、`lib/markets/priceHistory.ts`、`priceHistoryConfig.ts`、`components/markets/OutcomeList.tsx`（OutcomeOrderbook）、`hooks/usePolyOrderBook.ts`、`lib/orderbookPricing.ts`、`components/markets/TradeForm.tsx`、`lib/orderExpiry.ts`、`lib/api.ts` fetchTrades。

| 网页版逻辑 | App 现状 | 落地 |
| --- | --- | --- |
| `/price-history` 带 fidelity（1D 5 分钟 / 7D 30 / 1M 180 / ALL 720） | 不带 | `HISTORY` 表加 fidelity |
| 历史 ≤ 1 个点时用最近 50 笔成交补线（`loadSparseTradeFallback`） | 空图 | `getPriceHistory` 同样补点；新增 `listTrades`（data-service `/trades?market=`） |
| 簿按 tick 聚合、买盘降序 / 卖盘升序 | 原样透传 | `mapBook` 同价合并 + 排序 |
| 盘口：卖盘在上（远→近）、中间最新价 / 价差、买盘在下；价格 / 数量 / 累计三列；深度条按累计额 | 左右两列、只按份数画条 | `OrderBookView` + `deriveBookView`；Yes / No 切换取镜像；点档位按该价挂单 |
| 图表可 hover：竖线 + 各线插值 + 时间标签，头部数字跟随 | 无交互 | `PriceLineChart`：横向拖动刻度，头部概率与时间跟随；竖直拖动仍滚动页面 |
| 右侧百分比刻度 + 虚线网格 + 末点 | 无刻度 | 同上 |
| 多结果事件最多 4 条线 + 图例 | 只画选中市场 | `usePriceHistories` + 图例 |
| 成交列表来自 `/trades` | 用走势点 + `index % 3` 假装买卖 | 真实成交 |
| 买入看卖一、卖出看买一（`resolveTradePrice`） | 两边都显示 mid | Yes / No 卡按方向取盘口价 |
| 限价默认跟随盘口，用户改过就不再覆盖；−/+ tick 步进 | 打开时预填一次 | 已加 |
| 快捷金额：市价买 +2 / +20 / +100 / Max；限价份数 ±；卖出 25% / 50% / Max | 25/50/75/100% | 已对齐 |
| 有效期：撤单前 / 5 分钟 / 1 小时 / 12 小时（GTD ≥ 120 秒） | GTC / GTD 两个字，GTD 没有到期时间 | 已加 |
| 最小份数常驻提示 | 只在出错时显示 | 输入框 helper 常驻 |

WS：`book` 初始 dump 带的 `last_trade_price` 与独立的 `last_trade_price` 事件都进 `OrderBook.lastTradeCents`（盘口"最新"一行），并触发成交列表重取；展示价仍以簿的 mid 为准（同网页版）。

## 6. 设计系统变化

- 新增：`ChipRow`、`ActionTile`、`PriceLineChart`、`PageScroll.scrollEnabled`。
- 重做：`SegmentedControl`（轨道式）。
- 原则：主色只给"操作"；筛选 / 切换用反白 chip 或分段控件；一排超过 3 个文字按钮就改成图标格。

## 7. 验证

见 `docs/changes/2026-09-05-feature-ux-overhaul.md`。

## 8. 退出应用（追加需求，2026-09-05）

首页（AppShell 的 home 标签）上的返回——不论是屏幕边缘滑动（手势导航 / 自研 `useEdgeBackGesture`）还是返回键——第一次只在顶部提示"再滑一次退出应用"，2 秒内再来一次才 `BackHandler.exitApp()`（`resolveExitAttempt`，`src/features/foundation/app-shell-back.ts`）。其它标签上的返回仍是回首页。iOS 没有退出应用的概念，首页上的返回什么都不做。

## 9. 代码审阅与死代码清理（2026-09-05）

- 删除：`AssetsOverviewGateway` / `AssetsGateway` 与 `Gateways.assets`（被逐链查询替代）；设计系统 `AreaChart`（事件详情改用 `PriceLineChart` 后无引用）与 `HairlineCard`（从未被引用）；17 个无引用的文案键（`predict.book.yes/bid/ask`、`predict.order.gtc/gtd`、`assets.withdrawToWallet`、`transfer.noPending` 由本轮改动产生；`home.update`、`home.claimable`、`profile.claimable`、`action.details/collapse/later`、`predict.order.title/estimated/confirm`、`assets.locked` 为历史遗留）。判定方法：全量源码字面量匹配 + `t(\`prefix.${…}\`)` 动态前缀白名单，逐个复核没有字符串拼接用法。
- 保留：`Sparkline` / `CandleChart` / `SnapCarousel` / `HorizontalScroll` / `useWalletBalances` 等仍有引用；`InMemoryPredictAccountGateway` 只在测试里。
- 未动：`mock-predict-gateway.ts`（测试与演示夹具仍依赖）。
