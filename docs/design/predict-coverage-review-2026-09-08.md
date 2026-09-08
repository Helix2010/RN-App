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
| 状态筛选：交易中 / 全部 / 已结束 | 已对接 | `/events?active=&closed=` | 列表状态 chip：trading = `active=true&closed=false`、closed = `closed=true`、all 不带 |
| 24h 成交量排序与展示、流动性排序与展示 | 已对接 | `order=volume24hr`；流动性按当前页本地排序（与 C 端一致，分页各自排） | 卡片与详情显示 24h / 流动性 |
| 搜索 | 已对接 | 本地对已加载列表过滤（`event-search.ts`） | 搜索时收起策展与周期市场区块 |
| 收藏 | 已对接 | 本地星标（`favorites-store`，上限 50） | 收藏视图逐个取事件，单个失败只提示那几个 |
| 首页策展：英雄轮播、概率榜、今日成交榜、按分类分区 | 已对接 | `/curation/events`（featuredOrderHero / Highlight / Normal、featuredLevel） | hero 轮播、highlight"热门精选"、normal"突发"按运营位次排；高概率 / 今日热门榜按当前页本地算，只在默认排序下显示；按分类分区未做 |
| 事件 / 市场图片与图标 | 已对接 | `image`、`icon` | 列表卡 / 首页卡图标、精选轮播横幅、详情图标；没给或加载失败不占位（`predict-tier4-2026-09-08.md`） |
| 详情：完整标签列表、子分类导航 | 部分 | 事件 `tags` | 完整标签已显示；子分类导航（related-tags）未做 |
| 详情：每个结果的成交量、结算结果（NO Won / Market Ended） | 已对接 | 每个市场的 `volume`、`closed`、`result`、`acceptingOrders` | 多结果行显示成交量与结果徽章；不接单的市场不给买卖 |
| 详情：持有人分布（Top Holders） | 已对接 | data-service `GET /holders?market=<conditionId>&limit=` | Yes / No 两列各前 10，名字规则同网页版（name → pseudonym → 地址缩写） |
| 详情：价格图区间 | 已对接 | `/prices-history` | App 1h/6h/1d/1w/1m/all 比 C 端更多 |
| 详情：24h 涨跌 | 部分 | `oneDayPriceChange` 字段 | App 用历史序列自算 |
| 详情：相关市场、分享 | 未对接 | related-tags；分享为本地 | |
| 市场级规则（`rules-market`） | 已对接 | 市场 `description` | 与事件规则不同时在规则页签单独显示 |
| AI 翻译按钮 | 未对接 | C 端 Next 路由代理 Anthropic，密钥在服务端 | App 若要做需 RN-Server 代理，不能内置密钥 |
| 周期性加密市场（5m/15m/1h 涨跌、K 线、实时价、历史窗口、结果） | 部分 | `/series`（首页 8 个）、`/series/slug/{slug}?series_id=`、`/series/{id}/periods` | 系列卡 + 系列页（当期窗口、参考价、倒计时、历史窗口与结果）；K 线与实时价流未做，交易复用事件详情 |
| 体育枢纽（联赛导航、赛程、比分、盘口类型） | 部分 | `/sports-events`、`/config/sport-types` | App 只有对阵卡 |

### 3.2 账户与资金

| C 端 | App | 平台接口 | 备注 |
| --- | --- | --- | --- |
| 钱包登录、建 Safe、API key、授权 + wrap、协议签署 | 已对接 | gamma-auth、relayer、clob derive、`/agreements` | 启用页四步 |
| 转入、两阶段转出、待领取列表、水龙头 | 已对接 | relayer、`/faucet` | 在资产划转页 |
| 跨链桥转入（报价、路线、预计时间） | 未对接 | C 端 `bridge-*` 一整套，走桥服务 | 独立需求 |
| 地区限制横幅、禁止交易 | 已对接 | 管理端 `services.predict.endpoints.geo` → App 直连 `{geo}/geoblock` | 见 `predict-geoblock-2026-09-08.md`；线上租户未配地址，待平台给出 |
| 恢复 API key（换设备 / 重装） | 部分 | clob derive | App 重装即清凭证并重签，无引导页 |
| 免费签名额度、网络切换提示 | 未对接 / 不适用 | relayer 配额 | App 内置钱包无需切网 |

### 3.3 交易与持仓

| C 端 | App | 平台接口 | 备注 |
| --- | --- | --- | --- |
| 市价 / 限价、有效期 5m/1h/12h/永久、错误码映射 | 已对接 | `POST /order`、`/book` | 与 C 端 `orderExpiry.ts` 一致 |
| 卡片快捷下单 | 部分 | 无新增 | 卡片有 Yes/No，需进详情页下单 |
| 平仓（限价 / 市价卖出、预估盈亏） | 已对接 | 同下单 | 持仓页"卖出" |
| 领取、一键领取、零收益清仓、分步进度 | 部分 | `redeemPositions` 经 relayer | 一键领取、零收益清仓已做；进度对话框简化为按钮"领取中…"文案；dev 尚无已结算市场可验 |
| 活动类型 | 已对接 | data `/activity` | TRADE / SPLIT / MERGE / REDEEM / CONVERSION / MAKER_REBATE 都已映射（`ACTIVITY_TYPES`）；初稿误记为缺 conversion / rebate，已复核更正 |
| 持仓 / 挂单搜索与分类筛选、最大盈利 | 未对接 | 本地 | |
| 盈亏曲线区间 | 已对接 | `/user-pnl` | 1d / 1w / 1m / 全部 |
| 实时盘口推送 | 已对接 | `wss://clob-ws/ws/market` | C 端同样只有行情频道，无用户成交推送 |

### 3.4 结算生命周期

| C 端 | App | 平台接口 | 备注 |
| --- | --- | --- | --- |
| 争议（押金、证据、参考链接） | 已对接 | `POST /disputes/evidence` + 链上 | 待 dev 端到端 |
| 提交结果提案（用户作为提案人） | 未对接 | 链上 adapter | 网关无 propose |
| 市场取消 / 退款 | 已对接 | `adjudication.currentPhase` | `cancellation_pending` / `canceled` → 状态 canceled，结算页显示取消提示；持仓状态仍按 data-service 的 settled / redeemable 推，不会是 canceled |
| 13 种阶段文案（升级中、仲裁待定、取消中等） | 已对接 | 同上 | 结算页"当前阶段"行，13 种（gamma phase.go）全部有文案，未收录的原样显示 |

### 3.5 个人资料与设置、其他

| C 端 | App | 备注 |
| --- | --- | --- |
| 昵称、头像、简介、X 账号、匿名开关、公开主页 | 部分 | `/profiles/user_address/{address}`、`POST /profiles` | 核对 C 端后只有昵称有界面：App 做了昵称（排行榜"我"卡 + 个人页）与头像显示；C 端没有公开主页，不做 |
| API key 管理、自定义主题、语言 | 未对接 / 由 App 设置页承担 | |
| 排行榜、Top traders | 已对接 | C 端行不可点，App 同样不做公开主页 |
| Agent 页（策略跟单、新闻信号） | 不适用 | C 端也是 coming soon |

## 4. 方案与排期

所有条目都在 `modules.predict` 之下：新页面套 `ModuleGate`，共享入口的查询带 `enabled`。

1. **交易闭环小缺口（只改现有网关与页面）**：市场取消状态与阶段文案补全；零收益清仓与领取进度；盈亏曲线区间选择。
2. **发现层（字段已在本地）**：状态筛选、24h 成交量 / 流动性排序与展示、每个结果的成交量与结算结果、完整标签、市场级规则、本地搜索与收藏、持有人分布（接 data `/holders`）。
3. **需新接口的两块**：首页策展（`/curation/events`）、周期性加密市场（`/series` + periods）。
4. **独立需求**：个人资料与公开主页、体育枢纽、跨链桥转入、图片资源。（2026-09-08 决定：图片与昵称已做；公开主页 C 端没有，不做；体育枢纽、跨链桥留待需求 / 平台，见 `predict-tier4-2026-09-08.md`）
5. **需平台先确认后再排**：地区限制端点、AI 翻译代理、提案提交的链上入口与押金。

可靠性说明：第 1、2 项的数据都已由现有接口返回并被 App 解析，风险在界面；第 3 项端点在 gamma OpenAPI 中存在，但租户维度的可用性要在 dev 联调时核对；第 5 项在 C 端也是部署环境变量或服务端代理，App 不能绕过服务端直接实现。

## 5. 需平台确认

- `/curation/events`、`/series`、`/series/{id}/periods`、data `/holders` 在租户头下的可用性与限流。
- 地区限制：见 `predict-geoblock-2026-09-08.md`（已实现管理与展示，等平台给地理服务地址）。

可直接转发给平台的确认清单（2026-09-08）：

1. 正式租户是否开放 gamma `GET /curation/events`、`GET /series`、`GET /series/slug/{slug}?series_id=`、
   `GET /series/{id}/periods?current|closed`（后者是本平台扩展，不在 Polymarket 原版里）；是否要求 `X-Tenant-Domain`。
2. data-service `GET /holders?market=<conditionId>&limit=10` 是否对租户开放；`displayUsernamePublic` 为 false 时服务端是否已脱敏 name。
3. 上述接口按 IP 的限流阈值（每秒 / 每分钟）；手机用户共用运营商出口 IP，App 侧 429 退避 3 次后报错。
4. 地理检查服务：正式地址；`GET /geoblock` 是否按来源 IP 判定、响应是否只有 `{restricted}`；是否需要租户头；限流。

用户已定（2026-09-08）：

- 提案提交（propose）：App 与 C 端都没有这个功能，不列为待办。
- AI 翻译代理：不做。
- 事件 / 市场图片：不是阻塞项。原生图片加载没有跨域限制；dev 平台 12 个活跃事件都带 `image` / `icon`，
  域名是华为云 OBS 与 Polymarket S3 公开桶，市场级图片为空。schema 已解析字段，何时在卡片 / 轮播 / 详情渲染只是排期。
- 产品取舍维持现状：持有人名字规则与网页一致（name → 化名 → 地址缩写）；本地"高概率 / 今日热门"榜保留，
  只在默认排序下显示；领取进度保持按钮"领取中…"文案，不做分步弹层。
- 沿用 `predict-platform-integration-2026-09-02.md` §5 的四项：dev 水龙头阈值、`POST /order` 成交额、EIP-712 `app_name` 不在 public-info、CLOB secret 编码。

## 6. 验证

### 6.1 开关合规（2026-09-08 上午）

- 单元 / 组件测试：`module-gate.spec.tsx`（4 例）、`foundation-home-screen.spec.tsx` 新增"预测关闭不发请求"；全量 jest、lint、typecheck、format 通过。
- 开关关闭时的人工核对项：底部无预测页签；首页无热门榜且无 `/events` 请求；资产页无预测账户卡与划转；兑换页余额不足只显示"余额不足"且不可点；停留在预测详情页时把开关关掉，页面退回首页。

### 6.2 第 1–3 项实施（2026-09-08 下午）

实施范围：§4 第 1、2、3 项全部落地；第 4 项（个人资料 / 体育枢纽 / 跨链桥 / 图片）与第 5 项（需平台确认）
**未实施**，仍按 §5 等平台答复。

- 数据层：`gamma.ts` 增 `status` / `volume24hr` 排序、`/curation/events`、`/series`、`/series/slug/{slug}`、
  `/series/{id}/periods`；新增 `data-holders.ts`（data `/holders`）；模型增 `canceled` 状态、市场级
  `volume24hUsd / liquidityUsd / closed / result / acceptingOrders / description`、事件级 `tags / volume24hUsd /
  liquidityUsd / closed`、`CuratedEvent / HolderGroup / Series / SeriesPeriod`；网关接口增
  `listCuratedEvents / getHolders / listSeries / getSeries / listSeriesPeriods`，Http 与 Mock 两套实现。
- 页面：市场列表（本地搜索、交易中 / 已结束 / 全部、收藏、24h 成交量 / 流动性排序、策展精选轮播、高概率 / 今日热门榜、
  周期市场卡）；详情（完整标签、24h / 流动性、每个结果的成交量与结算结果、市场级规则、持有人页签、收藏星标、
  不接单时隐藏下单）；持仓（盈亏区间 1d / 1w / 1m / 全部、零收益清仓、领取中文案）；结算（取消提示、阶段文案）；
  新页面 `PredictSeries`（`ModuleGate module="predict"`，`system-back.ts` 登记）。
- 开关：新页面套 `ModuleGate`；列表页只在预测页签内挂载；`useCuratedEvents / useSeriesList` 带 `enabled`，
  在非默认标签 / 非交易中 / 收藏视图下不发请求；收藏与搜索是本地能力，不新增平台请求。
- 测试：`http-predict-gateway.spec.ts` 新增状态 / 排序参数映射、策展位掩码、持有人分组、系列与分期映射、取消阶段；
  `mock-predict-gateway.spec.ts` 新增状态过滤 / 排序 / 策展 / 持有人 / 分期；`market-list-screen.spec.tsx` 新增搜索、
  已结束视图、收藏、周期市场；新增 `favorites-store.spec.ts`、`event-search.spec.ts`、`series-card.spec.ts`。
  全量 jest（99 套 / 693 例）、lint、typecheck、format 通过。
- 死代码清理：删除无人抛出的 `PredictUnsupportedError`、无人使用的 `EventQuery.featured` 查询参数（列表页改用策展接口）、
  失效文案 `predict.special` / `predict.today`；ADR 0009 去掉已在用的 `getPnl` 条目；`event.holders` 计数字段由
  `/holders` 榜替代。
- 文案链路：fallback-config → `pnpm i18n:seed` → RN-Server `sync-rn-app-i18n-seed.mjs` → 推送部署。

### 6.3 对抗审计与修复（2026-09-08 下午）

对着本文档跑了一轮对抗审计（读 pm-cup2026 user-dapp 与 gamma / data-service 源码核对契约），无 Critical；
开关合规（§2）逐项通过。High / Medium 项已全部修复：

- **策展只用了一半**：hero 轮播没按运营位次排，highlight / normal 两区没用 → `curationZone` 按位次（同位次按 id）排，
  highlight 进"热门精选"、normal 进"突发"；本地"高概率 / 今日热门"只在默认排序下显示（按"最新"排的一页取前三没意义）。
- **发现层失败被吞**：策展 / 系列 / 分期请求失败只是区块消失或永远骨架 → 各区块有错误行 + 重试；下拉刷新一并刷新策展与系列。
- **不接单只藏了底栏**：详情页的 Yes / No 大块与盘口点价仍能开单 → 统一 `canOrder = trading && acceptingOrders`，
  三处入口一起关，并给出"暂不接单"提示；卡片对不接单的市场也换成徽章。
- **收藏视图一个失败全黑**：改为已加载的照常显示、失败的只提示条数并可重试；上限 200 → 50（平台按 IP 限流）。
- **系列卡定时器与轮询**：每张卡一个 `setInterval` → 全局共用一个秒表；首页系列数上限 8（网页版同上限），当期仍 15 秒轮询。
- **`/series/slug/{slug}` 没带 `series_id`**：路由参数带上 id，请求带 `series_id`，避免同名 slug 打开别的系列。
- **阶段文案**：补 `manual_needed`，删掉平台没有的 `arbitrated`。
- **持有人名字规则**：改成与网页版一致（name → pseudonym → 地址缩写），不再按 `displayUsernamePublic` 额外隐藏。
- **契约收紧（不写兜底）**：分期 `result` 只接受 up / down（其它值让 schema 报错），持有人 `outcomeIndex` 只接受 0 / 1、
  `amount` 必须是数字；没带事件的分期 `marketId` 为 null 而不是 gamma 数字 id。
- **24h 成交量口径**：与网页版 adapters.ts 一致，多结果先累加各市场再退到事件级。
- **窗口已结束但下一期未生成**：显示"已结束"，不再显示"00:00:00 后开始"；历史期按 `stage` 显示结算失败 / 已暂停。
- **死代码**：`Series.active / closed` 未使用已删；`predict.outcome.notAccepting` 现在可达（不接单徽章）；
  gamma.ts / use-predict.ts 里被挪走的 JSDoc 归位。
- 已知未做（记录在 §5 与 ADR 0009）：`/series` 周期市场的 K 线与实时价流；持仓状态不会是 canceled（data-service 不带裁决）；
  流动性排序是当前页本地排序。
