# ADR 0007：领域模型约定与 Gateway / Mock 双实现

状态：Accepted · 2026-08-30

## 背景

一期 App 不接任何业务后端（产品决策 D1–D4），但必须是可交互、可演示、可验收的产品，且后续要平滑切到自有 Predict / DEX 服务。此前页面直接 import `features/demo-data` 的预格式化字符串，没有抽象层，接真等于重写。

## 决策

1. **每个领域一个 Gateway 接口**（`features/<domain>/api/gateway.ts`），页面只依赖 `features/<domain>/hooks`，hooks 只依赖接口。接口即后续自有服务的契约。
2. **两份实现**：`Mock*Gateway`（一期）与 `Http*Gateway`（P6）。Mock 是**有状态的模拟服务**：写操作改变后续读结果，状态持久化到 AsyncStorage（`foundation.mock-state.<domain>.v1`），测试注入 `memoryStorage()`。
3. **Mock 运行时**（`core/mock/mock-runtime.ts`）统一注入延迟 / 失败率 / 空态 / 离线 / 时间偏移；Mock 内所有时间判定用 `mockNow()`。
4. **金额用 `Money`**（`core/money/money.ts`）：最小单位整数字符串 + decimals + symbol，BigInt 运算；`toApproxNumber` 只用于展示 / 排序 / 图表。预测价格用整数分（0–100）。
5. **内容多语言字段用 `LocalizedText`**，展示层 `pickTranslation`；UI 文案继续走 `t(key)`。
6. **格式化只在 `core/i18n/format.ts`**，领域模型不含展示字符串。
7. `GatewayProvider` 在 `App.tsx` 注入；选择实现的唯一位置是 `createMockGateways` / 未来的 `createGateways(bootstrap.services)`。

## 替代方案

- 继续用静态 mock 常量：无法演示状态变化，接真返工。
- MSW / 假 HTTP 服务：多一层序列化与 URL 约定，但一期没有 URL 契约可对齐；留作 Http 实现的契约回放手段。

## 影响

- 新增依赖：无。
- 体积：纯 TS，忽略不计。
- 退出策略：删除 `Mock*Gateway` 与 `mock-runtime`，`createGateways` 只保留 Http 分支；页面与 hooks 不变。
