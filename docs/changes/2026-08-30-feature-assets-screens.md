# 资产页面组（A-01 ~ A-05）

- 状态：In Progress
- 日期：2026-08-30
- 设计稿：`UI/src/50-assets.html`
- 决策：ADR 0007、ADR 0008

## 用户场景与现状证据

资产结构只有两层：钱包（多链链上余额）与预测账户（合约托管 USDC，仅 Predict 开启时出现）。旧 `portfolio/assets-screen.tsx` 为静态 demo-data（资金账户 / DEX 钱包 三账户模型，与新设计不符），已删除。

## Given / When / Then

- Given 未登录 When 进入资产页 Then 显示"登录后查看资产" + 连接钱包按钮（意图 `open_tab:assets`）。
- Given 已登录 When 进入资产页 Then 估值直接落在页面底色上；三个动作只有"收款"用品牌色；Predict 关闭时第三个动作由"划转"换成"兑换"；账户卡 1 + 1；币种列表副行标注所在账户，预测账户 USDC 单独一行并标注挂单占用；"隐藏小额"过滤 < $1。
- Given 点"划转" When 选择方向 / 输入数量（快捷比例、最大）/ 确认 Then 走 `usePredictDeposit` / `usePredictWithdraw`（同时扣减或增加钱包 USDC，跨精度换算），切到三段进度（已签名 → 已提交 → 已确认），可最小化。
- Given 点"收款" When 切链 chip Then 只改提示文案（二维码内容始终是纯地址）；复制 → toast；分享走系统面板。
- Given 点预测账户卡 Then 账户详情：账户总值、可用 / 挂单占用 / 持仓市值 三格、划转 / 取回钱包 / 拆分合并、合约地址 notice（可复制）、资金记录 / 领取记录 Tabs。
- Given 点钱包卡 Then 钱包详情：地址可复制、转出 / 兑换、按链筛选的代币列表。
- Given 点"转出" When 粘贴或从地址簿选地址 Then 实时格式校验 + 地址簿别名 pill；网络与币种联动（只列有余额的代币）；数量快捷比例；> $1,000 提示生物识别；确认 → 确认层复述地址 / 网络 / 数量 / 费用 / 实收 → 三段进度。

## UI 与交互状态

- `Sheet` 增加 Android 返回键处理：打开时返回键先关 sheet，`locked` 时吞掉返回。
- `PrimaryButton` / `SecondaryButton` 增加 `disabledStyle`（opacity 0.45）。
- `AppIcon` 增加 `onPrimary` 色 token。
- 新组件：`TxProgress`（三段进度，不跳外部区块浏览器，提供复制哈希）。

## 技术影响

- 新路由：`AccountDetail: { kind }`、`Send: { chain? }`；`Transfer` 参数化 `{ direction?, amount? }` 供"余额不足"预填与深链。
- `PredictGateway.getTx(id)` 新增；`usePredictTx` / `useWalletTransfer` 轮询到终态。
- Mock 的 tx / swap 查询改为返回副本（原地修改同一对象会让 React Query 认为数据未变而不重渲染）。
- 新依赖：`react-native-qrcode-svg`（纯 JS）。
- i18n 新键：`assets.*`、`transfer.*`、`tx.*`、`receive.*`、`send.*`；删除旧资产页专用重复键。注意：线上租户语言包已有 `assets.today`="今日收益"、`assets.available`="可用资产"，会覆盖内嵌值（架构如此，i18n seed 同步时统一）。

## 验证与发布

- `pnpm check` 全绿（jest 21 套件 87 例）。
- Android Development Build（`rn_smoke`，2026-08-30 15:10–15:16）：
  - A-01：总资产 $14,358.01 / 今日变动 / 收款·转出·划转 / 钱包卡 ($12,395.71 · 3 条链) / 预测账户卡 (可用 1,240.50 USDC · 持仓 $401.80) / 币种列表（预测账户 USDC 标注挂单占用 320.00；钱包 USDT / USDC / ETH…）/ 隐藏小额开关。✅ `assets-overview.png`
  - A-02：划转 sheet：从 钱包·BSC → 到 预测账户，对调按钮，USDC，快捷 50% → 1500，"确认存入 1,500.00 USDC" → 进度；钱包 USDC 3,000 → 1,500，预测可用 1,240.50 → 2,740.50，资金记录新增"从钱包存入 +1,500.00"。✅ `transfer-sheet.png` / `transfer-flow.png`
  - 修复：进度条曾卡在"已签名"（Mock 原地修改对象），改返回副本后到"已确认"。
  - A-04：收款 sheet：链 chip、二维码（react-native-qrcode-svg）、kenneth.eth + 全地址、复制 / 分享、警示条与支持说明。✅ `receive-sheet.png`
  - A-03：预测账户详情：账户总值 $3,465.30、三格、三按钮、合约托管 notice、资金记录 / 领取记录 Tabs 与流水。✅ `predict-account.png`
  - A-05：转出：地址簿选择 → "交易所 A" pill + "BNB Smart Chain 地址格式校验通过"；网络 / 币种联动；50% → 4060 USDT；> $1,000 出现生物识别提示；确认层复述 → toast「已提交转出」→ 已签名 / 已提交 / 已确认 → 完成。✅ `send.png` / `send-confirm.png` / `send-done.png`
  - 返回键：收款 sheet 打开时按返回 → 仅关闭 sheet，停留资产页。✅
  - 未验证：钱包详情页（A-03 DEX-only 变体）在设备上的截图；扫码入口（需 expo-camera，本轮未做）；保存图片到相册（未做，仅复制 / 分享）；余额不足 → 预填划转的跳转（尚无调用方）；iOS。
- 回滚：回退本分支提交；无数据迁移。
