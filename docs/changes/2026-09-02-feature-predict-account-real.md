# 预测账户与划转接真实平台（2026-09-02）

## 背景

App 里的预测账户余额、存入 / 取出此前全是 `MockPredictGateway` 的演示账本。用户要求把账号与划转按 `docs/design/predict-platform-integration-2026-09-02.md` 改成真实的：不再 Mock，不留任何兜底；行情、下单、持仓等后续逐步接入。

## 改动

### RN-Server / RN-Admin（已部署）

- 租户配置新增 `services.predict {domain, scopeId, chain}`；`modules.predict` 开启时必须完整有效，否则保存被拒、bootstrap 返回 503。
- 管理端「预测市场」页：开关、域名、scopeId、链；保存前必须「测试连接」通过（服务端探测 `gamma-api.{domain}/public-info`，核对 scopeId 与 chainId）。
- 规则「租户身份与外部系统的对应」写入三个仓库的 AGENTS.md：两边租户 id 不假定相等，只认显式配置的 scopeId。

### RN-App

- **配置层**：bootstrap schema 新增 `services.predict`；`core/predict-platform/config.ts` 保存下发的关联，变化时通知网关。
- **平台客户端** `core/predict-platform/*`：租户头 HTTP 客户端、public-info 校验、EIP-712 登录 + JWT 刷新、Safe / MultiSend 编码、relayer、CLOB L1/L2 认证、data-service、faucet、凭证保管（系统安全存储，按域名 + scopeId + 地址分键）。
- **链层**：`ContractCallService`（任意合约调用，EOA 付 gas，gas 上限与余额检查）、`eth_call`、回执日志读取；广播逻辑抽成 `broadcast.ts`。
- **账户网关** `HttpPredictAccountGateway`：四步启用（登录 / 建 Safe / CLOB 密钥 / 授权 MultiSend，幂等）、余额（Safe 的 USDW + clob 可用 / 冻结）、转入（USDC：按额 approve + wrap；USDW：transfer）、两阶段转出（initiate-unwrap → 等 `unwrapDelay`（链上读）→ claim-unwrap + USDC 回 EOA）、待领取列表（平台子图 ∪ 本机乐观记录）、faucet。平台关联变化时清空所有凭证；登出时丢掉该地址凭证。
- **界面**：
  - 启用引导页 `PredictEnable`：四步进度，一个按钮跑完缺的步骤；进入预测市场时每个地址在本次进程里自动弹一次，顶栏 / 账户页 / 划转表单都能再进。
  - 划转表单重写：转入选 USDC / USDW、估手续费、原生币不够不让提交、测试网 faucet；取回显示等待期与最小额，待领取列表带倒计时与领取按钮；账户未启用时只给启用入口。
  - 资产页 / 首页 / 账户详情：预测账户按「已启用 / 未启用」两态显示；账户详情显示 Safe 地址、可用 / 挂单占用 / 账户余额、待领取；去掉演示的持仓市值、可领取与资金记录。
  - 市场 / 下单 / 拆分合并 / 个人页改用真实账户余额；持仓页「可领取」改由持仓列表（仍是 Mock，待接入）自己算。
- **Mock 边界**：`MockPredictGateway` 只剩行情、下单、持仓；测试用 `InMemoryPredictAccountGateway` 只在 `src/test/` 存在，生产接线只有 `HttpPredictAccountGateway`。

## 对照设计核查与深度评审后的修正（2026-09-02 晚）

按设计文档 §3.3 / §3.4 / §3.7 逐条核对，再对照平台源码做了一轮评审，修正如下（每条都有 spec）：

- 设计缺口：429 指数退避三次；登录 40101 重取 nonce 再签一次；CLOB 401 丢本地密钥、回到"缺 CLOB 密钥"由用户重签；重装后首次启动清凭证（普通存储安装标记）；同一 Safe 的 SafeTx 串行；启用页展示平台协议并要求接受必读项（`GET {gamma}/agreements`，本机按 scopeId 记接受版本）。
- 严重缺陷：读不到的代币余额曾被当成 0；划转金额精度写死 6 位（改从平台代币 `decimals` 取，输入精度随之，最小取出额 0.001 USDW 能输入）；`withdraw` 在节点落后时误报"没有事件"（先等回执）；待领取合并只问了未领列表，网页版领掉的记录永远删不掉（改为两个列表都问）；转入绕过了租户 `onchainSends` 开关（加门禁）。
- 重要：报价低估（approve 费 + wrap 4 倍上界）；配置错误与限流在查询层不重试（`predictRetry`）；每次轮询重跑整套启用检查（进程内缓存）；登出时凭证清理失败会卡住登出；`services.predict` 缺失拖垮整个资产页；CLOB derive 空 catch 吞掉一切错误。
- 死代码：relayer 提交体的 `metadata`（服务端 `SubmitRequest` 无此字段）、`MultiSendOp.value`、`AssetsOverview.predict.safe`、`ActivityType "WITHDRAW"`、若干只在文件内使用的 export；英文 `transfer.note` 过时文案。
- 平台侧隐患（已写入设计文档 §5）：EIP-712 域名 `PredictMarket` 是 gamma 配置项且不在 `public-info`；CLOB secret 的 base64url / base64 解码不一致；`USDC_UNDERLYING` / `USDW_WRAPPER` 需在平台管理端手工加自定义合约行。

## 阶段 6 读侧：行情 / 持仓 / 订单接真实平台（2026-09-02 深夜）

事实先从平台源码提取写入设计文档 §2.9（gamma 事件 / 标签、clob 订单簿 / 历史 / 费率、data-service 持仓 / 活动 / 盈亏 / 排行榜、下单签名与提交、领取 / 拆合走 relayer），再实现：

- `core/predict-platform/{gamma,clob-market,clob-orders,data-positions}.ts`：zod 严格解析（数值可能是字符串、`outcomes/clobTokenIds` 可能是 JSON 串、多语言是按语言分键的 JSON 串），查询参数照网页版（active、未 closed、排除 recurring、排序字段与方向、`is_carousel` 标签、`sizeThreshold=0` 等）。
- `HttpPredictGateway`：`Market.id` = conditionId、事件 id = gamma id、价格换整数分、金额 6 位 USDW（后经联调改正，见下）；展示价按网页版规则（mid → ask → bid → 最新成交，缺就 null 不编 0.5）；持仓 / 活动按 Safe 地址查；我的挂单走 L2、"未完成"判据同网页版；撤单 `DELETE /order`。
- 生产接线从 `MockPredictGateway` 切到 `HttpPredictGateway`（Mock 只剩测试用）；市场列表默认标签改为平台给的第一个标签（原来写死 `hot`）。
- 模型：平台不给的字段改为可空 / 可选并在界面保护——持有人数、排行榜胜率、争议保证金；活动类型加 `CONVERSION` / `MAKER_REBATE`。
- **写侧（同日稍后落地）**：下单——EIP-712 Order（domain `Prediction Market Protocol` v1，verifyingContract 按 negRisk 选 exchange；maker = Safe、signer = EOA、signatureType 2、salt 随机 uint32、GTD 才带 expiration），金额换算是 user-dapp `orderAmounts.ts` 的逐行移植（`order-amounts.ts` + 契约测试），市价单 = FAK 取对手盘最优价并按 tick 向上对齐，`POST /order` 带 L2 头（path + body），响应 `success=false` 抛 `OrderRejectedError`，成交量按 BUY taking = 份数 / SELL making = 份数换算成 filled / partial / open；预览沿簿估算并按 `/fee-rate` 的 bps 估手续费。领取——同 conditionId 合并一条 `CTF.redeemPositions`（negRisk 走 adapter 的 `redeemPositions(conditionId, amounts)`），数量以链上 ERC1155 余额为准，MultiSend 经 relayer。拆合——直接 SafeTx 调 CTF / adapter（operation 0）。账户网关新增 `relaySafe` / `tradingContext` / `platformContext` 供复用。
- **WS 推送**：`core/predict-platform/market-ws.ts` 接 `wss://clob-ws.{domain}/ws/market`，协议照 `wsservice/market_channel.go` 与 user-dapp `lib/ws/polymarket.ts`——首帧 `{assets_ids, type:"market", custom_feature_enabled:true, initial_dump:true, level}`、增量 `{operation, assets_ids, level}`、每 10 秒文本 `PING`、断线 1s → 30s 指数退避（握手成功即归零）并重发全部订阅；`book`（初始 dump 在 `data` 里）与 `price_change` 映射成 `PredictGateway.subscribeMarkets` 的事件，没有订阅者时不建连接、最后一个取消即断开。假 socket 的 spec 覆盖订阅帧、映射、心跳与重连。
- **未接**：平台网页没有争议提交入口，`submitDispute` 抛 `PredictUnsupportedError`。

### 模拟器对 prax1s 联调后的修正（2026-09-03）

用 anyfun 租户配置出的 debug 包（1.2.7 / code 21，`EXPO_PUBLIC_TENANT=anyfun` 下 prebuild，Metro 8081）在 `rn_smoke` 上直连线上 bootstrap → prax1s，真实标签 / 事件 / 详情 / 订单簿都能出来，同时暴露出四个只有真数据才会出现的问题，均已修：

- **分类标签显示成数字**：界面直接把 `categoryTagId.toUpperCase()` 当文案（Mock 的 id 是 `crypto` 这类 slug，gamma 的是 `209`）。`PredictEvent` 新增 `category: LocalizedText`（首个标签的多语言名称，`categoryTagId` 只用于筛选），事件卡 / 置顶卡 / 详情页头 / 持仓行 / 首页卡都改用它。
- **无报价被显示成 0%**：gamma 对没有买卖盘缓存也没有成交的市场返回空价，`cents(null)` 编成 0，列表出现 "Buy Yes 0¢ / No 100¢"。`Market.yesPriceCents` 改为 `number | null`，`formatCents / formatPercentCents` 对 null 显示 "—"，详情页涨跌与最大收益在无价时不算，下单页无价不预填限价、按网页版顺序回落到订单簿 mid / 单边。
- **WS 没有消费者**：`subscribeMarkets` 接好了但没有任何界面调用。新增 `useMarketStream(marketIds)`：`book` 事件写入 `predict-book` 缓存，`price_change` 写回已缓存的事件 / 事件列表；网关收到 `book` 时再按网页版 `resolveFirstOptionProbability`（mid → ask → bid，只认 0 < p < 100）推一条价格，所以 gamma 没缓存价的市场在初始 dump 后也能显示概率。详情页订阅全部结果，市场列表 / 置顶卡订阅每个事件前 3 个结果，首页热门订阅前 2 个。
- **首页热门写死 `tagId: "hot"`**：平台没有这个标签。改为不带标签、按成交量排序。

WS 协议用 node `ws` 直连 prax1s 复核过：初始 dump 的 `timestamp` 是 ISO 串（原来按毫秒数解析会得到 1970，已改 `bookTimestamp`）、会来空的 `price_change` 与 `last_trade_price`（有簿价时忽略成交价，无簿价时用它兜住显示，同网页版回落顺序）、`PING`→`PONG`；gamma 的 0 / 1 价按网页版视为没数据。

**账户流程联调（同日，模拟器建钱包 → SIWE → 启用）**：四步启用对 prax1s 跑通（登录签名、relayer 建 Safe、CLOB 密钥、relayer MultiSend 授权），协议列表与必读门禁正常。又修了三处：

- **预测账户详情页崩溃**：`HttpPredictGateway` 把成交额 / 持仓市值 / 盈亏标成 `USDC`，账户余额是 `USDW`，下单页比较两者时 `Money` 断言不同币种直接抛错（Mock 时期两边都是 USDC 所以没暴露）。预测账户内一切金额统一为 USDW（抵押品），Mock 与 spec 同步。
- **启用第一次跑完仍显示未启用**：relayer 报授权交易已上链后，App 读链的公共节点（Pocket）还没看到授权，`enable()` 立刻读到"未授权"却按成功返回，界面提示完成并退出，再进来还是"启用"。现在 relayer 报上链后轮询链上授权可见（最多 10 × 1.5 秒），看不到按失败抛错，与建 Safe 那步的校验一致。
- **水龙头失败提示**：平台拒绝领取时（实测 "USDC balance must exceed the required minimum"）toast 前缀原来是"划转失败"，改为"领取测试网 gas 失败"。
- **两处演示数字残留**：持仓页"今日盈亏"写死 `+$41.20`，改为平台盈亏曲线（`/user-pnl` 1d 序列末值 − 首值，新 hook `usePredictPnl`），没数据显示 "—"；排行榜"我的排名 #1,204 · 本周盈亏 +$312.40 · Vol $4,860" 全是写死的，改为在返回榜单里按 Safe（`proxyWallet`）找自己，找不到显示"暂未上榜"与 "—"（平台没有查单人名次的接口）。
- **备份助记词页报重复 key**：12 词里同一个词出现两次是合法的，列表 key 改为带位置。

**交易流程联调（2026-09-03，铸 1000 测试 USDC 后）**：转入 100 USDC × 2（approve + wrap，EOA 付 gas）→ 账户 200 USDW；市价买 Yes 三笔（5 / 2 / 2 USDW，全部成交，平台活动与持仓核对一致）。又修了六处：

- **成交 toast 显示 "@ 100¢"**：`POST /order` 应答的 `takingAmount` / `makingAmount` 按 `match_dispatcher.go:1915-1921` 应是 Σ 抵押品 / Σ 结果 token，与方向无关（原代码按方向对调）；且 prax1s 实测两者都等于份数，成交额拿不到。现在 making 当份数，两者相等就不编价：`OrderResult.avgPriceCents / cost / fee` 可空，toast 只说"已成交 N 份"。
- **小额单被 400 拒绝**：clob 对每个代币有最小下单份数（`/book` 的 `min_order_size`，该市场 5 份；gamma `orderMinSize` 同值）。`OrderBook` 新增 `minOrderShares`，下单页不足时提示"最少 N 份"并禁用提交；WS 簿事件不带该字段，保留 REST 拉到的值。
- **平台纯文本错误被吞**：clob 的 400 是纯文本，原来解析不成 JSON 就丢掉，toast 只剩 "HTTP 400"。现在原文留作错误详情。
- **持仓 / 挂单 / 历史 / 结算 / 拆合全都回查静态夹具**：真实持仓因为 conditionId 不在夹具里而整行不渲染（头部却显示 1 笔）。`Position` / `Order` 自带 `title` / `outcomeLabel` / `endsAt`，结算页由来路传 `eventId`，拆合从持仓里选市场，卖出按持仓的事件 id 现取 `Market`；`fixtures/events` 只剩 Mock 用。
- **手续费标签写死**：事件级 `feeBps` 恒为 0 / 20，与预览里按 clob `/fee-rate` 算出的金额不一致（实测 5%）。删掉事件级字段，新 hook `useFeeBps(marketId)`，下单页与规则页同源。
- **转入后"可用"要等几分钟**：clob 的虚拟余额按周期从子图同步，平台有 `GET /balance-allowance/update` 强制刷新（网页版没用）。转入确认、领取完成后调一次。

**限价挂单 / 撤单 / 两阶段取回（同日稍后）**：限价买 Yes 10 份 @ 20¢（GTC）挂上，Positions → Orders 显示 "Buy Yes · 10 @ 20¢ · Filled 0/10"，可用减 2 USDW；撤单后列表清空、可用恢复。取回 50 USDW：relayer MultiSend [approve, initiateUnwrap] 上链后待领取列表出现 "50.00 USDC" 与倒计时（dev `unwrapDelay` 60 秒、`minUnwrapUsdw` 0.001），到期按 Claim，[claimUnwrap, USDC.transfer] 上链后钱包 USDC 800 → 850、列表清空。观察：撤单后几分钟内 clob 的 `/balance-allowance` 曾把已撤订单的 2 USDW 重新算进 locked（子图周期同步覆盖了内存状态），领取后调 `/balance-allowance/update` 即恢复——平台侧现象，App 已在下单 / 撤单后同时失效 `predict-account` 余额查询以便及时重读。

**挂单 / 撤单 / 取回联调（同日稍后）**：限价买 10 份 @ 20¢（低于买一，挂在簿上）→ Positions › Orders 显示 "Buy Yes · 10 @ 20¢ · GTC · Filled 0/10"，可用余额扣 2 USDW → 撤单后列表清空、余额回补。取回：initiate-unwrap 50 USDW 后账户页"待领取"显示 "50.00 USDC · Ready to claim"（dev `unwrapDelay` 链上读到 60 秒）→ Claim 约 7 秒完成，待领取清空，钱包 USDC 链上 800 → 850。

**卖出 / 拆合联调（同日）**：持仓页 Sell → 市价卖 10 份 @ 买一 25¢，可用余额 +2.33 USDW（2.45 − 5% 手续费），平台持仓 31.64 → 21.64（data-service 索引约 15–30 秒后跟上）。拆分 5 USDW（relayer SafeTx 直接调 CTF）约 10 秒 Submitted → Confirmed → Done，平台持仓多出 No 5；再合并 5 份，No 归零、活动记录 SPLIT / MERGE 各一条。顺手修了拆合 sheet 的两处：默认市场写死 Mock 夹具 id `m-btc-120k`（平台报 unknown market，toast 只说"加载失败"）→ 默认第一个持有的市场、错误显示原文；提示文案 USDC → USDW。

**显示精度（同日）**：价格从整数分改为保留一位小数（`cents = round(price × 1000) / 10`）——簿的 tick 到 0.1¢，24.5¢ 的档位原来显示成 25¢，0.1¢ 的价显示成 0%；概率格式同网页版 `formatProbability`（最多一位小数）。转入报价小于显示精度时显示 "< 0.000001 ETH" 而不是 "≈ 0 ETH"。

平台侧观察：dev 水龙头对持有 800 USDC 的 EOA 仍报 "USDC balance must exceed the required minimum"，与 `faucet.go` 的检查（EOA 的 `chain.usdcAddress` 余额 > `minUsdcBalanceRaw`）对不上，疑为 dev 配置的 USDC 地址或阈值——App 侧无事可做，已记入设计文档 §5。

联调环境事实：prax1s `public-info.chain.contracts` 已含 `USDW_WRAPPER` / `USDC_UNDERLYING`；测试 USDC（`0x2eA6…c3AD`）的 `mint(address,uint256)` 无权限限制，EOA 有少量 OP Sepolia ETH 即可自铸后联调转入 / 下单。

## 不做的事

- 没有任何「平台不可用就用演示数据」的路径：关联缺失显示未配置，public-info 对不上直接报错。
- 主网 `unwrapDelay` 到期提醒、持仓 / 行情 / 下单接入：后续阶段。

## 运维记录

- 2026-09-03 直接写库（web4，用户授权）：anyfun（100000001）`services.predict` 指向 `predict.prax1s.xyz` / `0xfb05…454a` / op-sepolia，op-sepolia 目录加 USDW（`0x790e…6098`，6 位），`tokens` 锚点 +1；`modules.predict` 保持 false。线上 bootstrap 已核实 `wallet.tokens` 含 USDW、`services` 仍空。
- 同日稍后按用户要求直接把 `modules.predict` 置 true（版本号守卫 UPDATE）；现网 1.2.7 老包在新包发出前会显示 Mock 预测市场。已核实币种下发只看 `chain_token_catalog` 自身的 enabled 与链开关（RN-Server `internal/api/tokens.go` 不读 `modules.predict`）。

- 2026-09-03 模拟器 `rn_smoke` 上的测试钱包：EOA `0x75D26308e8E47519C0dE6Cbe444c20430013d3F4`（OP Sepolia，Safe `0x9047…fb34` 已建并授权，余额 0 ETH / 0 USDC）。继续联调转入 / 下单 / 取回前，需要给这个 EOA 打少量 OP Sepolia ETH（≈0.01 即可）：随后在 App 里先自铸测试 USDC（`0x2eA6…c3AD` 的 `mint` 无权限）或由运维直接铸给它，再走转入。

## 验证

- RN-App `pnpm check` 全绿；新增 spec：`http-predict-account-gateway.spec.ts`（假平台 + 假链，覆盖启用 / 余额 / 转入 / 两阶段转出 / 关联变化清凭证）、`transfer-form.spec.tsx`、`predict-enable-screen.spec.tsx`，`market-list-screen.spec.tsx` 改为账户网关状态驱动。
- 真机对 dev 环境的端到端联调待 dev 租户建好后进行。
