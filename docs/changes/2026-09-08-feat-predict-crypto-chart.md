# 周期市场（加密涨跌）走势图

日期：2026-09-08 · 设计：`docs/design/predict-crypto-chart-2026-09-08.md`

## 需求

网页版周期市场页有价格 / 概率 / K 线三种图，App 系列页没有。

## 现有行为

系列页只有当期窗口卡（参考价、倒计时、涨跌价）与历史窗口。

## 预期行为

- 系列页当期卡下方增加走势图卡：当前价（RTDS 实时，5 秒无新价显示 —）、较参考价涨跌、价格 / 概率 / K 线切换。
- 价格：标的 tick（`/prices/history` 回填 360 条 + WS 追加），只画当期窗口，参考价做基准线。
- 概率：当期市场 1 小时 Yes 价，50¢ 基准线。
- K 线：最近 30 根 1 分钟蜡烛（binance），20 秒重拉。
- 标的认不出来提示"无法识别该系列的标的"，不猜成 BTC。

## 配置

- RN-Server / RN-Admin：预测平台服务地址增加 `rtds`（https，默认 `rtds.{domain}`）与 `rtdsWs`（wss，默认 `rtds-ws.{domain}`）。
- anyfun 租户接的 dev 平台经主域代理：`rtds = https://predict.prax1s.xyz/rtds`、`rtdsWs = wss://predict.prax1s.xyz/rtds-ws`。

## 开关

只在系列页（`PredictSeries`，`ModuleGate module="predict"`）内请求 RTDS；离开页面即退订并断开 WS。

## 风险

- RTDS 对租户的开放与限流未确认；失败时图表区显示错误行可重试，不影响窗口与交易。
- 取价源按当期 `resolutionSource` 解析，平台标 `declared=false` 时是按周期兜底映射（网页版同样），涨跌方向可能与结算不同源。

## 验证

- `rtds.spec.ts`：标的解析、三条 REST 契约与参数、schema 拒绝、WS 订阅帧 / PING / 消息路由 / 退订断开。
- `series-screen.spec.tsx`：当前价与参考价基准线、三种模式切换、标的认不出来的提示。
- 全量 jest / lint / typecheck / format 通过；模拟器记录见设计文档 §5。

## 发布

- anyfun 租户配置：`services.predict.endpoints.rtds / rtdsWs` 已通过管理接口写入（配置版本 15 → 16），bootstrap 已下发。
- OTA rev 12（`ota_qpB5O5xem74OdUCouPX43g`，applyStrategy immediate，source 7c25fe6）已发布到 anyfun production 渠道。
