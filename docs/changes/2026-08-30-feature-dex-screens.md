# DEX 页面组（D-01 ~ D-06）

- 状态：In Progress
- 日期：2026-08-30
- 设计稿：`UI/src/40-dex.html`
- 决策：ADR 0007、ADR 0008

## 用户场景与现状证据

DEX 模块 = 多链代币的"发现 → 看 → 换"，没有现货订单簿，唯一交易动作是兑换。旧 `module-overview-screen` 的静态行情 / 兑换与 `mock-detail-screens` 的 DexToken / Swap / SwapHistory 已删除，`module-overview-screen` 现在只是底栏页签到领域页面的接线。

## Given / When / Then

- D-01 Given 进入 DEX / 行情 Then 标题随配置（双模块"DEX"，仅 DEX"行情"）；顶栏钱包地址 chip（绿点已连接，点击进兑换记录；游客 → "创建钱包"）；链筛选 chip 带链色圆标，代币头像右下角同色小圆标；热门 / 涨幅榜 / 新币 / 自选 Tabs；"流动性 > $100K" 默认开启可关；每行 名称 + 市值 · 流动性 / 迷你走势 / 价格 + 24h pill；新币 warn 色"新"标；长按加入 / 移出自选。
- D-02 Given 打开代币 Then 价格前导零折叠（$0.0₄1232）、24h 高低、四格统计（市值 / 流动性 / 24h 成交 / 持有人）、15M–1W K 线、安全检测卡（4 项 + 合约地址复制；不过则 warn 边框 + CTA 上方风险提示）、成交 / 持有者 / 信息 Tabs、底部 买入（用 BNB / USDT 兑换）/ 卖出（余额 x）→ 预填方向进 D-03。
- D-03 Given 进入兑换 Then 顶栏链选择器切单链上下文；支付 / 获得两块（余额、最大、代币选择器 sheet、对调）；获得侧美元估值 + 相对差额（> 3% warn，> 10% down）；报价明细全部展开（汇率 / 价格影响 / 最少获得 / 滑点 / 网络费 / 服务费 / 路由）；12s 倒计时自动刷新；ERC-20 首次需"授权 {symbol}"；余额不足 → "余额不足，去划转"；游客 → 登录 sheet。
- D-04 Given 点兑换 Then 确认层复述支付 / 获得（放大）与明细、接收地址"DEX 钱包"、报价有效期倒计时；≤ 1s 时按钮变"重新报价"；确认 → toast「已提交，等待链上确认」→ 三段进度（成功后显示实际成交数量）→ "兑换记录"。
- D-05 Given 打开兑换记录 Then 全部 / 进行中 / 成功 / 失败 + 链过滤；按 今天 / 昨天 / 日期 分组；双币叠放图标；失败项行内写原因与"资金未扣除"。
- D-06 Given 打开代币授权管理 Then 每行 代币 + 链标、额度（无限额度 warn pill）、被授权合约（名称 + 短地址）、授权时间 / 最近使用（> 30 天 warn）、撤销；底部"撤销全部无限额度授权（n）"。入口：兑换记录页（S-08 资金安全的入口待 S 组）。

## 技术影响

- 路由：`DexToken: { chain, address }`、`Swap: { chain?, sellAddress?, buyAddress? }`、`SwapHistory`、`Approvals`。
- `Quote.spender`（路由合约地址）新增，供授权步骤使用。
- 设计系统：`TokenAvatar`（链色小圆标）、`TokenPrice`（前导零折叠）位于 `dex/ui/shared.tsx`。
- i18n 新键 `dex.*`、`swap.*`、`approvals.*`，并清理与旧页面重复的键。

## 验证与发布

- `pnpm check` 全绿（jest 87 例）。
- Android Development Build（`rn_smoke`，2026-08-30 15:39–15:52）：
  - D-01：DEX 标题、钱包 chip、链 chip（全部链 / BNB Smart Chain / Ethereum / Base）、Tabs、流动性开关、UNI / PEPE（$0.0₄1236）/ MOG（新）/ AERO / CAKE / ZORA 行含走势与 24h pill。✅ `market.png`
  - D-02：PEPE 详情：$0.0₄1232 +12.40%、24h 高低、四格、4H K 线、安全检测 4/4（合约已开源 / 无增发权限 / 买卖税 0% / 前 10 持仓 18%）、合约地址、成交列表、买入 / 卖出 CTA（余额 8.1M PEPE）。✅ `token-detail.png`
  - D-03：买入 → 兑换页预填 BNB → PEPE；输入 0.5 → 获得 25,286,967.04 PEPE（≈ $312.04，−0.11%）、汇率 / 价格影响 0.01% / 最少获得 / 滑点 0.5% 自动 / 网络费 / 服务费 / 路由 BNB → WBNB → PEPE · 2 跳池、"报价 9 秒后自动刷新"。✅ `swap.png`
  - D-04：确认层复述全部数字 + 接收地址 DEX 钱包 + 倒计时；确认 → toast「已提交，等待链上确认」→ 已签名 / 已提交 / 已确认，实际成交 25,284,438.34 PEPE。✅ `swap-confirm.png` / `swap-done.png`
  - D-05：今天（新成交 BNB → PEPE 成功）/ 昨天（USDT → PEPE、BNB → CAKE 成功，ETH → AERO 失败 + 原因）。✅ `swap-history.png`
  - D-06：USDT 无限额度 / USDC 无限额度（58 天未使用 warn）/ AERO 120；"撤销全部无限额度授权（2）" → toast「已撤销授权」，仅剩 AERO。✅ `approvals.png` / `approvals-revoked.png`
  - 修复：支付输入框未撑满、超大数量精度过长、报价最后 1 秒提交与过期竞争（改为 ≤ 1s 显示"重新报价"）。
  - 未在设备验证：ERC-20 授权步骤 UI（USDT → PEPE 需两步；Mock 逻辑有单测）、代币选择器 sheet、链切换后默认对、失败态（`nextSwapOutcome` 仅单测）、差额 > 3% 的 warn 文案、iOS。
- 回滚：回退本分支提交；无数据迁移。
