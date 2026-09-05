# 体验整改：锁屏 / 资产渐进加载 / 资金记录 / 启用流程 / 验证策略 / 行情与下单

- 日期：2026-09-05
- 设计与决策：`docs/design/ux-overhaul-2026-09-05.md`
- 对照：pm-cup2026 user-dapp `origin/dev`（只读）

## 现状与问题

1. 锁屏"解锁"按钮左偏（`PrimaryButton` 的 `alignSelf: stretch` 抵消了父级居中），且以按钮触发验证不直观。
2. 资产页要等所有链 + 平台余额都返回才渲染；链筛选是一排全名药丸按钮；划转的对调箭头挂在"从"行右侧；划转 / 充值 / 提现没有记录，确认后看不到中间状态；预测账户页三个次级按钮挤在一行被截断。
3. 启用引导只在整轮结束后才刷新勾选；授权那一步因公共节点落后偶发"闪回"；敏感操作先弹系统验证、签名时再弹一次（双重）。
4. 行情图无交互无刻度、成交列表是用走势点伪造的、盘口是左右两列份数条、下单面板显示 mid 而非可成交价、限价不跟盘口、无有效期。

## Given / When / Then

- Given 应用锁开启并已上锁 When 系统验证被取消 Then 锁屏显示居中的指纹 / 面容 / 密码图标，轻触即重试；验证失败图标变红并显示"验证未通过"。
- Given 已登录 When 打开资产页 Then 立即列出下发目录里的币种（金额骨架），每条链余额返回即填入；总额随到达累加并带转圈；链筛选为短名 chip。
- Given 划转面板 Then 对调按钮压在从 / 到两行的分界线上竖直居中。
- Given 发起转入 / 取回 / 领取 Then 记录页与账户页"最近记录"出现对应记录，状态依次 处理中 → 已完成 / 等待解包 → 可领取 → 已领取，失败显示原因；转入进度页与表单底部有"查看记录"。
- Given 启用引导运行中 When 网关进入下一步 Then 上一步立即打勾；全部成功后四步全勾。
- Given 已在链上核实过授权 Then `enablement()` 不再逐次读链，划转表单不再闪回"去启用"。
- Given 交易前验证 = 智能（默认） When 5 分钟内验证过身份 Then 下单 / 划转 / 转出不再弹系统验证，只剩钱包签名验证；= 每次双重验证 Then 每次都弹并让签名再验一次；= 关闭 Then 不弹（大额仍验）。
- Given 事件详情 When 横向拖动走势图 Then 竖线 + 插值点 + 时间标签，头部概率跟随；松手恢复；竖直拖动仍滚动页面。
- Given 盘口 Tab Then 卖盘在上买盘在下、三列（价格 / 数量 / 累计）、深度条按累计额、中间行最新价 + 价差；Yes / No 切换取镜像；点档位打开下单面板并预填限价。
- Given 下单面板 Then Yes / No 卡显示按方向可成交的价（买看卖一、卖看买一）；限价默认跟随卖一并可 ± tick；市价买有 +2 / +20 / +100 快捷加额；限价有 撤单前 / 5 分钟 / 1 小时 / 12 小时 有效期。

## 技术影响

- 删除 `features/assets/api/{assets-overview-gateway,gateway}.ts` 与 `Gateways.assets`；新增 `features/assets/model/overview.ts`（`composeOverview`）与 `hooks/use-assets.ts`（`useQueries` 逐链）。
- 设计系统：`ChipRow`、`ActionTile`、`PriceLineChart`、`PageScroll.scrollEnabled`；`SegmentedControl` 改轨道式。
- 预测账户网关契约新增 `listFundRecords`；`PredictCredentials.approvedSafe`；本机账本 `FundLedger`（普通存储键 `foundation.predict.fund-records.v1.<domain>.<scopeId>.<address>`）。
- 偏好存储 `foundation.preferences.v1` 升到 version 2：`txConfirm: boolean` → `txVerification: "smart" | "always" | "off"`（true → smart，false → off）。
- `core/security/app-lock.ts`：`biometricKind`、`noteVerified` / `verifiedWithin` / `forgetVerification`、`RECENT_VERIFICATION_WINDOW_MS`。
- 行情：`OrderBook.lastTradeCents`、`Trade` 类型与 `PredictGateway.listTrades`（data-service `/trades`）、`MarketEvent.last_trade`、`/price-history` 带 fidelity、稀疏历史用成交补点、簿同价合并 + 排序。
- 路由新增 `Records`（`{ tab?: "predict" | "wallet" }`）。
- i18n 新键 ≈ 70 个（`security.unlock.hint.*`、`security.txVerification.*`、`records.*`、`predict.book.*`、`predict.trades.*`、`predict.order.expiry.*` 等），`i18n/seed` 已导出。
- 无原生依赖变化；可走 OTA。

## 验证

- `pnpm check` 全绿（format / lint / typecheck / 89 套件 622 用例 / api / config / i18n）。
- 新增单测：`composeOverview` 3 例、`deriveBookView` 4 例、`mergeFundRecords` / `isFundRecordOpen` 2 例、`FundLedger` 2 例、`useRequireVerification` 10 例（三种策略 + 窗口 + 大额）；更新 `http-predict-gateway.spec`（簿带 `lastTradeCents`、`last_trade` 事件）、`assets-screen.spec` / `receive-sheet.spec`（chip）、`settings` / `security-center` spec（策略）。
- 模拟器（rn_smoke，anyfun 1.2.8 debug 包对 prax1s）：见下文"模拟器验证"。

## 模拟器验证

环境：`rn_smoke`（Android 16，手势导航），anyfun 1.2.8 debug 包（服务端已强更 1.2.8，1.2.7 会被升级弹窗挡住）连本机 Metro，对 dev 平台 prax1s；模拟器临时设 PIN 1234 以触发应用锁。截图在会话 scratchpad（`v1-*.png` / `v2-*.png` / `v3-*.png`）。

| 项 | 结果 |
| --- | --- |
| 锁屏 | 冷启动自动弹系统验证；取消后显示居中的密码图标（本机只有 PIN → `lock-outline`）+ "Tap the icon to enter your device passcode"；轻触图标 → PIN → 进入首页 ✅ |
| 首页 | 存入 / 提现 / 划转三格改成图标格，英文 "Withdraw" 不再截成 "Withdr…" ✅ |
| 资产页 | 打开即渲染（币种 + 金额），链筛选为 `All chains / ETH / OP Sep Testnet` chip；预测账户 USDW 行与钱包各币按链标注 ✅ |
| 预测账户页 | 四个操作格（Deposit / Withdraw / Split · merge / Records）+ 托管地址 + "最近记录"（平台索引到的一笔已领取的取回）✅ |
| 划转面板 | 从 / 到两行，对调按钮压在分界线上竖直居中；对调后方向互换；底部"查看记录"入口 ✅（第一版 "From" 在英文下折行，已把标签改成 `minWidth`） |
| 记录页 | 划转 Tab 列出平台索引的取回（Claimed），钱包 Tab 有"收款需索引"说明 ✅ |
| 事件详情 | 走势图带右侧百分比刻度、50% 基准线、末点；横向拖动出现竖线 + 插值点 + 时间标签，头部显示 26% / Sep 5, 05:25；松手恢复 ✅（第一版 1D 区间轴标签只有时分，看起来像 16:55 → 16:50 倒退，已改成"月日 时分"；刻度算法改为值域内取整步长） |
| 盘口 | 卖盘 32 → 28¢ 在上（红）、"Last 27¢ · Spread 2.5¢"、买盘 25.5 → 21.5¢ 在下（绿），三列 + 累计深度条；Yes / No 切换 ✅ |
| 下单面板（点卖一 28¢ 进入） | 自动切限价、预填 28、"Book 25.5 / 28"、−/+ 步进、Yes / No 卡显示 "Ask" 价、"Min 5 shares" 常驻、−10 / +10 / +100、有效期四选一 ✅（未真实下单，避免占用 dev 资金） |
| 设置 / 安全中心 | "Verify before trading" 显示当前策略（Smart），点开三选一面板，选 "Verify twice, every time" 后值列同步，再切回 Smart ✅ |
| 退出应用 | 首页返回键两次：第一次顶部提示 "Swipe again to exit"，第二次退出（焦点回到桌面）✅；边缘滑动路径见下文 |

### 未在模拟器复现的

- 启用引导逐步打勾与授权"闪回"：该设备已启用完成，无法重跑四步；由单测（`predict-enable-screen.spec` 原有用例 + hook 逻辑）覆盖，需在新钱包上复验。
- 转入 / 取回的记录状态流转：未在 dev 上发真实交易；`FundLedger` 单测 + 网关写入点代码审阅。
- 指纹 / 面容图标：模拟器只有 PIN；分支由 `biometricKind` 的类型判断决定。

## 未验证 / 遗留

- iOS（无 macOS）。
- 链上收款记录需要后端索引服务（设计文档 §3.3）。
- 多结果事件多线图与限价有效期在 dev 上没有合适市场，只有单测与 Mock 覆盖。

## 回滚

纯 JS 改动，OTA 回滚到上一版即可；偏好存储 v2 → v1 不可逆（旧包读到 `txVerification` 会忽略并按 `txConfirm` 缺省 true 处理，不影响启动）。
