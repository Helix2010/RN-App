# Feature: data-gateway-foundation

状态：In Progress

## 用户场景与现状证据

- 用户/角色：Predict / DEX 白标 App 用户；以及后续接入自有 Predict / DEX 服务的工程师。
- 当前行为或复现：7 个页面文件直接 `import` `features/demo-data` 的 17 个 mock 常量（预格式化字符串，如 `"62¢"`、`"12,480.36"`），没有 gateway / hook / 领域模型；接真实接口等于重写每页数据流（见 `UI/docs/rn-implementation-plan.md §2.3 S1/S2`）。
- 代码调用链：`FoundationHomeScreen -> mockHomeData`；`ModuleOverviewScreen -> mockPredictMarkets / mockDexTokens`；`mock-detail-screens -> mock*`。
- 非目标：本轮不改页面视觉、不接任何后端、不新增原生依赖。

## Given / When / Then

1. Given 任意业务页面，When 需要数据，Then 只通过 `features/<domain>/hooks` 取，hooks 只依赖 `features/<domain>/api/gateway.ts` 接口，页面不再 import `demo-data`。
2. Given 一期全 Mock，When App 启动，Then `GatewayProvider` 注入 Mock 实现；Mock 是有状态的（下单改变持仓与余额、结算推进、兑换按状态机推进），重启后保留。
3. Given 开发面板（development / staging），When 设置延迟 / 失败率 / 空态 / 离线 / 时间加速，Then 所有 Mock 网关遵循，用于验收 8 种页面状态。
4. Given 金额，When 参与计算，Then 使用 `Money`（最小单位整数字符串 + decimals，BigInt 运算），展示格式化只在 `core/i18n/format.ts`。
5. Given 同一份契约测试，When 分别对 Mock 与未来 Http 实现运行，Then 断言一致（本轮先落 Mock 一侧）。

## UI 与交互状态

- loading / empty / content：首页作为样板改为消费 hooks，loading 用现有 SkeletonBlock，空态 / 错误用 PageState；其余页面下一轮迁移。
- error / timeout / offline：由 mock-runtime 注入；hooks 透出 `AppError`。
- 重复提交 / 取消 / 返回：写操作用 `useMutation`，pending 期间禁用按钮（页面层下一轮落实）。
- light / dark / 字体放大 / 无障碍：无视觉变化。

## 技术影响

- API/OpenAPI：无服务端变更。Gateway 契约即后续自有服务接口契约（见方案 §4）。
- 状态与本地数据：新增 `foundation.mock-runtime.v1`、`foundation.mock-state.v1`（Mock 演进状态）、`foundation.session.v1`（本地会话）AsyncStorage key；TanStack Query 为服务端数据唯一事实源。
- 钱包/签名/链/金额精度：`Money` 用 BigInt；Mock 签名即时成功，可注入拒绝 / 超时。
- 权限、隐私与遥测：无新增。
- OTA 或全量更新：纯 JS，可 OTA。

## 验证与发布

- 修复前失败测试或需求测试：新增 `money.spec`、`format.spec`、`mock-session-gateway.spec`、`mock-predict-gateway.spec`（9 例：分页/空态/离线、市价成交、限价挂单与撤单解锁、结算状态机、时钟推进自动提案与结算、争议押金、拆分合并、跨实例持久化）、`mock-dex-gateway.spec`（6 例：列表排序搜索、详情与安全报告、报价、授权、兑换扣减/到账、失败退款与过期报价）。
- 静态检查：`pnpm check` 通过（format / lint --max-warnings=0 / typecheck / jest 20 套件 85 例 / api:check / config:check）。Jest 全局接入 AsyncStorage 官方内存 mock（`src/test/setup.ts`）。
- Android Development Build（AVD `rn_smoke`，Metro dev-client :8091，2026-08-30）：
  - 未登录：首页资产卡显示"连接钱包"引导 → 点按后走 `wallet.connect → session.challenge → wallet.signMessage → session.verify`，约 1s 后卡片切换为 `kenneth.eth` / 总资产 / 钱包账户 · 预测账户 / 24h 变动 / "可领取 186.00 USDC" 徽标。✅
  - 冷启动（force-stop 后重开）：会话从 `foundation.session.v1` 恢复，仍为已登录；Mock 价格漂移与总资产随刷新变化（世界杯西班牙 18% → 19%）。✅
  - 热门预测卡：多结果事件显示前两名结果概率，二元事件显示 Yes/No 价格；成交额紧凑格式 `$3.4M`（修复 Hermes 不支持 `Intl compact` 的问题，改为手动 K/M/B）。✅
  - DEX 热门代币：UNI / PEPE / MOG 价格（含小数价 `$0.00001232`）、24h 涨跌色、流动性紧凑值。✅
  - 已知：dev 模式 Reanimated "Reduced motion" 警告为模拟器动画缩放为 0 所致，与本次改动无关。
- 未在本轮验证：iOS；`failureRate` / `offline` 注入在真机 UI 的错误态（仅单测覆盖）；下拉刷新（手势在无窗口模拟器中未触发）。
- 灰度指标与停止条件：无线上影响（一期 mock，无真实网络调用）。
- 回滚：回退本分支提交；清理本地存储键 `foundation.mock-state.*.v1`、`foundation.session.v1`、`foundation.mock-runtime.v1`；无服务端迁移。
