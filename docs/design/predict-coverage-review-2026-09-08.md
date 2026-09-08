# 预测市场：对照 pm-cup2026 C 端的覆盖评审与补齐方案

日期：2026-09-08
关联：`predict-platform-integration-2026-09-02.md`（接入设计）、ADR 0009（已知缺口）

## 1. 结论

- App 已打通预测市场的核心闭环：登录 → 启用 → 转入 / 转出 → 浏览 → 盘口与实时推送 → 下单 → 持仓 / 挂单 / 历史 / 盈亏 → 领取、拆合、争议 → 排行榜。
- 与 C 端（`apps/user-dapp`）逐页对照后，未对接的能力分三类：市场数据展示层、交易生命周期里的少数动作、整块未做的产品区域（周期性加密市场、体育枢纽、个人资料与设置、跨链桥转入）。§3 是完整矩阵，§4 是排期，§5 是必须先向平台确认的事项。
- **预测市场受租户开关 `modules.predict` 限制是硬约束**。本次评审把开关当作独立审计项（§2）：入口层原本已按开关隐藏，但栈内页面无条件注册、首页热门榜在开关关闭时仍会向平台发请求、DEX 兑换页"余额不足，去划转"会进入预测划转页。三处已修，并加了测试。以后所有新增能力都必须落在同一套闸门之下。

## 2. 模块开关合规（硬约束）

### 2.1 规则

1. 服务端只在 `modules.predict` 为真时下发 `services.predict`（RN-Server `services_config.go` `predictServiceFor`）；配置校验要求 predict / dex 至少一个开着。
2. App 入口层按 `config.modules.predict` 隐藏：底部页签（`app-tabs.ts`）、首页快捷入口与热门榜、资产页预测账户卡与"划转"、记录页预测页签、个人中心 / 设置 / 通知设置里的预测项。
3. 栈内页面统一套 `ModuleGate`（`features/foundation/module-gate.tsx`）：开关关闭时不渲染模块内容并 `popToTop`，页面内的行情 / 账户请求随组件卸载停止。覆盖 `PredictEvent`、`Leaderboard`、`Positions`、`PredictSettlement`、`PredictEnable`、`Transfer`、`AccountDetail(kind=predict)`；DEX 侧对称套用（`DexToken`、`Swap`、`Approvals`、`SwapHistory`）。
4. 开关关闭时不得有任何请求打到预测平台：共享入口的查询（首页热门榜 `usePredictEvents`）必须传 `enabled: config.modules.predict`。
5. 生产网关没有 Mock 兜底：`HttpPredictGateway` / `HttpPredictAccountGateway` 在 `services.predict` 缺失时如实报错、启用页显示"未配置"，不展示演示数据。
6. 新增能力（§4 的每一项）都挂在 predict 页签或上述被闸门包住的页面之下；新增的共享入口（首页、资产页）必须同时满足第 2、4 条。

### 2.2 审计结果

| 面 | 闸门 | 状态 |
| --- | --- | --- |
| 底部页签、页签内容可用性 | `buildAppTabs` / `isAppContentAvailable` | 原有 |
| 首页快捷入口、热门榜渲染 | `config.modules.predict` | 原有 |
| 首页热门榜查询 | `usePredictEvents(…, { enabled })` | **本次补**：此前开关关闭仍发请求 |
| 资产页账户卡、划转按钮、总览 | `config.modules.predict` | 原有 |
| 记录页预测页签 | `predictOn` 强制回钱包页签 | 原有 |
| 个人中心 / 设置 / 通知设置 | `config.modules.predict` | 原有 |
| 栈内预测页面（详情、排行、持仓、结算、启用、划转、预测账户详情） | `ModuleGate` | **本次补**：此前无条件注册，开关在页面停留期间被关掉不会退出 |
| DEX 兑换页"余额不足，去划转" | 开关关闭时只显示"余额不足"且禁用 | **本次补** |
| 启用引导自动弹出 | 只在预测页签触发 | 原有 |
| 深链 / 推送直接打开预测页 | 当前没有 linking 配置；有了也被 `ModuleGate` 挡住 | 原有 + 闸门 |
| 生产网关 Mock 兜底 | 无 | 原有 |

### 2.3 测试

- `module-gate.spec.tsx`：开着渲染、关着不渲染并 `popToTop`、栈底不弹、`module={null}` 放行。
- `foundation-home-screen.spec.tsx`：预测关闭时 `listEvents` 不被调用。
- 既有 `app-tabs` / 资产页 / 记录页的模块关闭用例保持通过。

## 3. 覆盖矩阵（C 端 → App）

"平台接口"一列写的是 gamma / clob / data / relayer 的真实端点或 C 端的实现方式，用来判断每一项是否可靠落地。

### 3.1 市场发现与市场数据

| C 端 | App | 平台接口 | 备注 |
| --- | --- | --- | --- |
| 分类标签条、精选、按成交量 / 临近截止 / 最新排序、分页 | 已对接 | `/tags?is_carousel`、`/events?order=…` | |
| 状态筛选：交易中 / 全部 / 已结束 | 未对接 | `/events?active=&closed=` | App 写死 `active=true&closed=false`，已结算市场从列表消失 |
| 24h 成交量排序与展示、流动性排序与展示 | 未对接 | `order=volume24hr`；流动性 C 端本地排序；字段已解析 | |
| 搜索 | 未对接 | C 端在本地对已加载列表过滤（`MarketList.tsx`） | App 可同样本地过滤，不依赖平台 |
| 收藏 | 未对接 | C 端本地星标 | 本地存储即可 |
| 首页策展：英雄轮播、概率榜、今日成交榜、按分类分区 | 未对接 | `/curation/events`（featuredOrderHero / Highlight / Normal、featuredLevel） | App 只取 `featured=true` 一条 |
| 事件 / 市场图片与图标 | 未对接 | `image`、`icon` 字段；App schema 未解析 | 需确认图片域名可被 App 直连 |
| 详情：完整标签列表、子分类导航 | 未对接 | `tagIds` 已有、`/tags/{id}/related-tags` | App 只显示首个标签 |
| 详情：每个结果的成交量、结算结果（NO Won / Market Ended） | 未对接 | 每个市场的 `volume`、`closed`、`adjudication` 已解析 | 只在事件级显示一个状态徽章 |
| 详情：持有人分布（Top Holders） | 未对接 | data-service `GET /holders?market=<conditionId>&limit=` | 纠正此前"平台不提供持有人数"的判断：事件对象不带，但 data 接口有 |
| 详情：价格图区间 | 已对接 | `/prices-history` | App 1h/6h/1d/1w/1m/all 比 C 端更多 |
| 详情：24h 涨跌 | 部分 | `oneDayPriceChange` 字段 | App 用历史序列自算 |
| 详情：相关市场、分享 | 未对接 | related-tags；分享为本地 | |
| 市场级规则（`rules-market`） | 部分 | 市场 `description` | App 只显示事件 `description` |
| AI 翻译按钮 | 未对接 | C 端 Next 路由代理 Anthropic，密钥在服务端 | App 若要做需 RN-Server 代理，不能内置密钥 |
| 周期性加密市场（5m/15m/1h 涨跌、K 线、实时价、历史窗口、结果） | 未对接 | `/series`、`/series/{id}/periods`、`SeriesPeriodPrice` | App 主动 `exclude_tag_slug=recurring` |
| 体育枢纽（联赛导航、赛程、比分、盘口类型） | 部分 | `/sports-events`、`/config/sport-types` | App 只有对阵卡 |

### 3.2 账户与资金

| C 端 | App | 平台接口 | 备注 |
| --- | --- | --- | --- |
| 钱包登录、建 Safe、API key、授权 + wrap、协议签署 | 已对接 | gamma-auth、relayer、clob derive、`/agreements` | 启用页四步 |
| 转入、两阶段转出、待领取列表、水龙头 | 已对接 | relayer、`/faucet` | 在资产划转页 |
| 跨链桥转入（报价、路线、预计时间） | 未对接 | C 端 `bridge-*` 一整套，走桥服务 | 独立需求 |
| 地区限制横幅、禁止交易 | 未对接 | C 端 `/api/geoblock` 代理到部署环境变量 `GEO_CHECK_URL`，**不在 public-info 里** | 需平台暴露端点或 RN-Server 代理 |
| 恢复 API key（换设备 / 重装） | 部分 | clob derive | App 重装即清凭证并重签，无引导页 |
| 免费签名额度、网络切换提示 | 未对接 / 不适用 | relayer 配额 | App 内置钱包无需切网 |

### 3.3 交易与持仓

| C 端 | App | 平台接口 | 备注 |
| --- | --- | --- | --- |
| 市价 / 限价、有效期 5m/1h/12h/永久、错误码映射 | 已对接 | `POST /order`、`/book` | 与 C 端 `orderExpiry.ts` 一致 |
| 卡片快捷下单 | 部分 | 无新增 | 卡片有 Yes/No，需进详情页下单 |
| 平仓（限价 / 市价卖出、预估盈亏） | 已对接 | 同下单 | 持仓页"卖出" |
| 领取、一键领取、零收益清仓、分步进度 | 部分 | `redeemPositions` 经 relayer | 有一键领取；缺零收益清仓与进度对话框；dev 尚无已结算市场可验 |
| 活动类型 | 部分 | data `/activity` | App：TRADE / SPLIT / MERGE / REDEEM；C 端另有 conversion、rebate |
| 持仓 / 挂单搜索与分类筛选、最大盈利 | 未对接 | 本地 | |
| 盈亏曲线区间 | 部分 | `/user-pnl` | App 固定 1d，C 端 今日 / 7d / 30d / 全部 |
| 实时盘口推送 | 已对接 | `wss://clob-ws/ws/market` | C 端同样只有行情频道，无用户成交推送 |

### 3.4 结算生命周期

| C 端 | App | 平台接口 | 备注 |
| --- | --- | --- | --- |
| 争议（押金、证据、参考链接） | 已对接 | `POST /disputes/evidence` + 链上 | 待 dev 端到端 |
| 提交结果提案（用户作为提案人） | 未对接 | 链上 adapter | 网关无 propose |
| 市场取消 / 退款 | 未对接 | `adjudication.currentPhase` | App 状态枚举无 canceled |
| 13 种阶段文案（升级中、仲裁待定、取消中等） | 部分 | 同上 | App 结算页步骤条覆盖主线 |

### 3.5 个人资料与设置、其他

| C 端 | App | 备注 |
| --- | --- | --- |
| 昵称、头像、简介、X 账号、匿名开关、公开主页 | 未对接 | gamma-auth profile / `/public-profile` |
| API key 管理、自定义主题、语言 | 未对接 / 由 App 设置页承担 | |
| 排行榜、Top traders | 已对接 | 点击交易员进入公开主页依赖上一项 |
| Agent 页（策略跟单、新闻信号） | 不适用 | C 端也是 coming soon |

## 4. 方案与排期

所有条目都在 `modules.predict` 之下：新页面套 `ModuleGate`，共享入口的查询带 `enabled`。

1. **交易闭环小缺口（只改现有网关与页面）**：市场取消状态与阶段文案补全；活动类型补 conversion / rebate；零收益清仓与领取进度；盈亏曲线区间选择。
2. **发现层（字段已在本地）**：状态筛选、24h 成交量 / 流动性排序与展示、每个结果的成交量与结算结果、完整标签、市场级规则、本地搜索与收藏、持有人分布（接 data `/holders`）。
3. **需新接口的两块**：首页策展（`/curation/events`）、周期性加密市场（`/series` + periods）。
4. **独立需求**：个人资料与公开主页、体育枢纽、跨链桥转入、图片资源。
5. **需平台先确认后再排**：地区限制端点、AI 翻译代理、提案提交的链上入口与押金。

可靠性说明：第 1、2 项的数据都已由现有接口返回并被 App 解析，风险在界面；第 3 项端点在 gamma OpenAPI 中存在，但租户维度的可用性要在 dev 联调时核对；第 5 项在 C 端也是部署环境变量或服务端代理，App 不能绕过服务端直接实现。

## 5. 需平台确认

- `GEO_CHECK_URL/geoblock` 是否对租户开放，或由 RN-Server 代理并纳入 bootstrap。
- `/curation/events`、`/series`、`/series/{id}/periods`、data `/holders` 在租户头下的可用性与限流。
- 事件 / 市场 `image`、`icon` 的资源域名与跨域策略。
- 提案提交（propose）的合约入口、押金币种与是否走 relayer 白名单（与争议同样受 LightOracle 白名单限制）。
- 沿用 `predict-platform-integration-2026-09-02.md` §5 的四项：dev 水龙头阈值、`POST /order` 成交额、EIP-712 `app_name` 不在 public-info、CLOB secret 编码。

## 6. 验证

- 单元 / 组件测试：`module-gate.spec.tsx`（4 例）、`foundation-home-screen.spec.tsx` 新增"预测关闭不发请求"；全量 jest、lint、typecheck、format 通过。
- 开关关闭时的人工核对项：底部无预测页签；首页无热门榜且无 `/events` 请求；资产页无预测账户卡与划转；兑换页余额不足只显示"余额不足"且不可点；停留在预测详情页时把开关关掉，页面退回首页。
