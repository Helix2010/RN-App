# 死代码清理与触感反馈

- 日期：2026-08-31
- 工具：`knip@5`（未引用文件 / 导出 / 依赖）+ 自写脚本扫描内嵌字典未引用键

## 删除

- `src/features/demo-data/`（旧静态样板数据及其测试）——所有页面已迁到 Gateway hooks。
- 无调用方的 hooks：`useSignIn`、`useRequireAuth`（被 `useWalletLogin` + `useAuthSheet` 取代）、`useWalletTransfers`、`useLivePrices`、`usePnl`、`useDexChains`。
- 无调用方的设计系统组件：`AppHeader`、`ListRow`、`Divider`、`AddressText`。
- 内嵌字典 133 个无引用键（旧 `module.*` 模块总览、交易所账户语义的 `security.*` / `profile.*` / `assets.*`、已删页面的 `predict.event.*` / `dex.token.*` 等），seed 从 776 键降到 656 键。
- 仅内部使用的导出改为模块私有：`createMockGateways`、`useToastStore`、`DEFAULT_ACCOUNT_PREFERENCES`、`CHAIN_COLORS`、`STATUS_TONE`、`mockRuntime`、`sessionQueryKey`。

## 保留（knip 误报或平台既有）

- `*.spec.ts`、`src/test/setup.ts`、`plugins/*`：Jest / app.config 动态引用。
- `useMockRuntime`、`resetMockRandom`、`FIXTURE_NOW`、`formatPercent`、`formatProbability`：测试使用。
- 平台既有导出（`bootstrap.schema` / `branding-assets` / `locale-change` / `update-service` / `update-telemetry` / `installation-service`）与 devDependencies（`@react-native/metro-config`、`@testing-library/react-native`）：本轮不动，属于 Codex 建的平台基座，需其维护者确认。

## 新增

- `expo-haptics` 原本只安装未使用：`Switch` 切换触发 `selectionAsync`，成功 / 失败 toast 触发 `notificationAsync`（对齐交互规范"触感反馈"）。
- 语言页补上设计稿的说明文案 `lang.hint`。
