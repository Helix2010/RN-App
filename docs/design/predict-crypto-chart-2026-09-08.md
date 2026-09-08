# 周期市场（加密涨跌）走势图设计

日期：2026-09-08 · 范围：RN-Server / RN-Admin（RTDS 服务地址）、RN-App（系列页图表）

## 1. 结论

- 网页版周期市场页有三种图：**价格**（标的实时价折线 + 参考价基准线）、**概率**（当期市场 Yes 价折线）、**K 线**（1 分钟蜡烛）。
  数据来自平台的实时数据服务 RTDS（`rtds-service`），App 之前没有接 RTDS，所以系列页没有图。
- 本轮 App 补齐三种图，数据源与网页一致；RTDS 地址作为预测平台的第 8、9 个服务地址交给管理端（`endpoints.rtds` / `endpoints.rtdsWs`）。
- 只在系列页（`PredictSeries`，`ModuleGate module="predict"`）内请求；离开页面即断开 WS。

## 2. 网页版实现（核对 `app/predict/crypto/[seriesSlug]/_content.tsx`、`lib/api/rtds.ts`、`lib/ws/rtds.ts`）

| 环节 | 实现 |
| --- | --- |
| 标的 | `resolveCryptoSymbol(series)`：`ticker`（如 `BTCUSD`）→ slug / 标题里的 `btc` / `bitcoin` 等别名 → 兜底 `BTCUSD` |
| 取价源 | `GET /api/v1/recurring/live-source?symbol&recurrence&resolutionSource`：返回 `source / topic / subscription{topic,type,filters}`；带上当期 `resolutionSource`（gamma 分期字段，如 `…btc-usd-twap-60s-streams`）让"当前价"与结算同源；认不出来时 `declared=false` 并按 recurrence 兜底 |
| 当前价 | `GET /api/v1/prices/latest?symbol&source` 首屏 + WS 推送；5 秒没新价视为过期（`RTDS_PRICE_STALE_AFTER_MS`） |
| 价格图 | `GET /api/v1/prices/history?symbol&source&limit=360` 回填 + WS tick 追加；只画当期窗口 `[windowStart, windowEnd]`；参考价画基准线 |
| 概率图 | 当期市场的 `/prices-history`（与事件详情同一条） |
| K 线 | `GET /api/v1/candles?symbol&interval=1m&limit=30&source=binance`（binance 是 dev 上唯一有 K 线的源；chainlink 回 400）；WS tick 合并进最后一根 |
| WS | `wss://…/api/v1/ws`：`{"action":"subscribe","subscriptions":[{topic,type:"*",filters}]}`，推送 `{"topic","type":"update","timestamp","payload":{symbol,value,timestamp,source}}`；客户端发文本 `PING`，服务端回 `PONG` |
| 地址 | 直连租户域：REST `https://rtds.{domain}`、WS `wss://rtds-ws.{domain}`；通过主域代理时：`https://{domain}/rtds`、`wss://{domain}/rtds-ws`。dev 只有后一种可达 |

## 3. 方案

### 3.1 服务地址（RN-Server + RN-Admin）

- `services.predict.endpoints` 增 `rtds`（https 基址，不填按 `https://rtds.{domain}` 派生）与 `rtdsWs`（wss 基址，不填按 `wss://rtds-ws.{domain}` 派生），
  校验规则同 clob / clobWs。管理端服务地址列表相应多两行。
- anyfun 租户（dev 平台）需要填代理路径：`rtds = https://predict.prax1s.xyz/rtds`、`rtdsWs = wss://predict.prax1s.xyz/rtds-ws`。

### 3.2 App 数据层

- `core/predict-platform/rtds.ts`：`resolveCryptoSymbol`（移植网页版别名表；**认不出来返回 null**，界面提示"无法识别标的"，不兜底成 BTC）、
  `fetchLiveSource`、`fetchLatestPrice`、`fetchPriceHistory`、`fetchCandles`（zod 校验）、`RtdsWsClient`（订阅 / 退订 / PING / 重连，
  与 `market-ws.ts` 同一套 SocketLike 抽象）。
- 模型：`Series.ticker`、`SeriesPeriod.resolutionSource`；`CryptoLiveSource`、`CryptoTick`、`CryptoCandle`。
- 网关：`getCryptoLiveSource / getCryptoLatest / getCryptoPriceHistory / getCryptoCandles / subscribeCryptoPrice`；Mock 用随机游走生成。
- hooks：`useCryptoLiveSource`、`useCryptoPriceHistory`、`useCryptoCandles`（20 秒刷新）、`useCryptoLivePrice`（WS，过期 5 秒判定）。

### 3.3 App 界面（系列页当期卡下方）

- 模式切换：价格 / 概率 / K 线（`SegmentedControl`），默认价格。
- 价格：`PriceLineChart`，一条线 = 当期窗口内的 tick（历史回填 + 实时追加），`baseline` = 参考价；头部显示当前价（过期显示 —）与相对参考价的涨跌。
- 概率：`PriceLineChart`，当期市场 1 小时 Yes 价，`baseline` 50¢。
- K 线：`CandleChart`，最近 30 根 1 分钟蜡烛。
- 失败：每种图各自显示错误行 + 重试；标的认不出来显示提示，不画图。

## 4. 与网页版差异

- 标的认不出来不兜底成 BTC（规则：不写兜底）。
- K 线不做 tick 合并，20 秒重拉一次（RN 端先保证正确，动画后续再说）。

## 5. 验证

- 单测：symbol 解析、四个 REST 契约（参数、租户头、schema 拒绝）、WS 客户端（订阅帧、PING、消息解析、退订断开）、系列页三种模式渲染与错误行。
- 模拟器：anyfun 租户配置 rtds 地址后，系列页价格图有实时曲线与参考价线、当前价每秒跳动、K 线 30 根、概率图有线。

### 5.1 结果（2026-09-08）

- RN-Server d403734 / RN-Admin 719f48f：`rtds` / `rtdsWs` 地址；anyfun 租户已写入代理路径（配置版本 16），bootstrap 下发核对通过。
- RN-App d590999 / 7c25fe6：`rtds.spec.ts`、`series-screen.spec.tsx` 通过；全量 jest 106 套 723 例、lint、typecheck、format 通过。
- 模拟器（OTA rev 12，连线上租户 → prax1s dev RTDS）：价格图有当期窗口内的实时曲线与参考价虚线，当前价与"较参考价"每秒跳动
  （$78,378.22 / -$98.41）；K 线 30 根 1 分钟蜡烛；概率图对刚生成的 5 分钟市场显示"暂无行情"（该市场没有成交，与平台一致）。
- 复核后修的两处版式：五位数美元价把右侧刻度截成 "$78,475."（刻度栏加宽到 78）；模式切换的英文 "Probability" 被截断（切换条改为整行）。
