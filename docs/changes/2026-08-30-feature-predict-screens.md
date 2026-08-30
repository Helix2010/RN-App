# 预测市场页面组（P-01 ~ P-06）

- 状态：In Progress
- 日期：2026-08-30
- 设计稿：`UI/src/30-predict.html`
- 决策：ADR 0007、ADR 0008

## 用户场景与现状证据

一期只做二元市场（Yes / No）、市价 + 限价单；多结果事件由多个二元市场组成；体育为三向。价格即概率（¢）。裁决走"商户提交 → 争议期 → 自动确认"。旧 `mock-detail-screens` 的 PredictEvent / PredictOrder / PredictSettlement 与 `module-overview-screen` 的静态列表已删除。

## Given / When / Then

- P-01 Given 进入预测页 Then 顶栏右侧常驻预测账户余额 chip（点击去划转；余额 0 → "去充值"品牌色按钮；游客不显示）、排行榜 / 持仓入口（双模块时）；分类 chip 选中反色实底；排序（成交量 / 即将截止 / 最新）；专场 banner 品牌色 26% 渐变；二元 / 多结果 / 体育三种卡型；卡内 Yes/No 直接进详情并自动拉起下单 sheet。
- P-02 Given 打开事件 Then 状态徽章四态、Yes 概率大数字 + 今日变动、Yes 价格面积图（1H/6H/1D/1W/1M/全部）、多结果事件用段控切市场、Yes/No 选择器卡、盘口（仅 Yes 侧，5 档深度背景条，价差 / 档位）/ 成交 / 规则（裁决方、争议期、手续费、数据源）/ 持有者 Tabs；非交易中显示结算入口；底部双 CTA 常驻，副文案"最多赢 x%"。
- P-03 Given 点 CTA Then 半屏下单 sheet：买入 / 卖出 segmented，市价 / 限价小切换；市价买入输入金额派生份额与均价；限价输入价格（盘口提示）+ 份额（+10/+50/+100）派生金额，多一行 GTC / GTD；卖出输入份额（持有上限）派生回款；手续费按事件费率；"若结果为 Yes 可得"唯一强调行；按钮文案带动作 + 方向 + 数量；余额不足 → 按钮变"去充值"并预填金额跳划转；未登录 → 记录意图拉起登录 sheet，成功后自动重开。
- P-04 Given 打开结算进度 Then 四步进度（交易截止 / 商户已提交结果 + 依据 / 争议期倒计时（唯一 warn 色）或等待商户裁决 / 自动确认并结算）、商户提交的结果、你的持仓（成本、若维持当前结果 → 归零或兑付）、"知道了"，可争议时显示描边"提出争议 · 锁定 50 USDC 押金" → 理由 sheet → 押金锁定 toast → 徽章变争议中。
- P-05 Given 打开持仓 Then 汇总卡（持仓价值、总盈亏、今日、可领取收益品牌色行 + 领取、拆分合并 / 划转）、持仓（带数量徽标）/ 挂单 / 历史 Tabs；持仓项排序 可领取 → 争议中 → 交易中；隐藏已归零开关；行内 领取 / 进度 / 卖出（卖出复用下单 sheet 的卖出态）；挂单行可撤单；历史为资金流水。
- P-06 Given 打开排行榜 Then 时间段 Tabs + 盈亏 / 成交量排序，前三名头像品牌色；底部常驻"我的排名"卡（游客 → 连接钱包）→ 查看持仓。

## 技术影响

- 路由：`PredictEvent: { eventId, marketId?, outcome? }`、`PredictSettlement: { marketId }`、`Leaderboard`、`Positions`；移除 `PredictOrder`（下单是 sheet）。
- `Position.closed`：已领取仓位默认从持仓列表与盈亏合计中排除（`listPositions` 不带 `includeClosed` 时过滤）。
- 下单 / 撤单 / 领取后失效 `predict-event` / `predict-book` / `predict-adjudication` 查询，价格推动即时可见。
- i18n 新键 `predict.*`（~150 个）已加入 `fallback-config.ts` 双语表，并清理旧页面的重复键。

## 验证与发布

- `pnpm check` 全绿（jest 87 例）。
- Android Development Build（`rn_smoke`，2026-08-30 15:25–15:31）：
  - P-01：余额 chip 2,740.50 USDC、分类 chip、排序 pill、专场 banner（世界杯 3 行 Yes/No 小钮）、二元卡（BTC 67% 概率 + 买 Yes/No）、多结果卡（FOMC 3 行）。✅ `market-list.png`
  - P-02：CRYPTO / 交易中徽章、问题、截止 + 成交、67% + 今日变动、面积图、1D 段控、Yes 67¢ / No 33¢ 卡、盘口 5 档深度条（价差 1¢ · 深度 0.5¢）、底部 买 Yes 67¢（最多赢 49%）/ 买 No 33¢（最多赢 203%）。✅ `event-detail.png`
  - P-03：点 CTA 弹下单 sheet；25% → 685.13 USDC → 预计 1020.53 份 @ 67¢，手续费 1.37，若 Yes 可得 1,020.53 (+49.0%)；提交 → toast「已成交 1020.53 份 @ 67¢」，sheet 关闭。✅ `order-sheet.png` / `order-filled.png`
  - P-05：持仓价值 / 总盈亏 / 今日 / 可领取 186.00 USDC；持仓 4 · 挂单 2；可领取（已结算 · 你赢了）→ 争议中（等待商户裁决 · 结算暂缓）→ 交易中（均价 65.6¢ → 70¢，+$50.18）。点"领取" → toast「已领取 186.00 USDC」，可用 2,055.37 → 2,241.37。✅ `positions.png` / `claimed.png`
  - P-04：曼联 vs 利物浦 结算进度：Yes 商户提交、交易截止 ✓ / 商户已提交结果 ✓ / 等待商户裁决（warn）/ 自动确认并结算，你的持仓 No · 200 份 · 成本 76.00 · 若维持 Yes 此持仓归零 (−76.00)。✅ `settlement.png`
  - P-06：本周 / 按盈亏，7 行（前三名品牌色头像），我的排名 #1,204 · 本周盈亏 +$312.40 → 查看持仓。✅ `leaderboard.png`
  - 修复：已领取仓位仍在列表且把总盈亏拖成负数 → 引入 `closed`。
  - 未在设备验证：限价单挂单与撤单 UI（单测覆盖撮合 / 解锁）、卖出态、争议提交 sheet（`canDispute` 需结果提交且在争议期内的市场，Mock 里 ETH 今日市场需推进时钟）、多结果事件段控、游客态下单 → 登录 → 回放意图、iOS。
- 回滚：回退本分支提交；无数据迁移。
