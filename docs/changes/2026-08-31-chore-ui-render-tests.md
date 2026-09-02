# UI 渲染测试基建与首批页面测试

- 日期：2026-08-31
- 背景：ADR 0009 记录的最大缺口——`@testing-library/react-native` 已装未用，页面行为只能靠模拟器人工回归。

## 基建

`src/test/harness.tsx`：一次性拼好业务组件所需的 Provider 栈（SafeArea → Query → RuntimeContext → Tamagui 主题 → Gateway → BottomSheet → Navigation），并提供：

- `renderWithProviders(ui, { modules, locale, gateways, runtime, config })`——`modules` 直接驱动"仅 Predict / 仅 DEX / 双开"三种租户配置分支；`config` 可改 update 决策等；运行时的 `themePreference` / `localePreference` 读真实偏好 store，测试先 `setState` 再渲染即可驱动分支。
- `createTestGateways()`——每次一套独立内存 Mock，测试之间不共享状态。
- `signIn(gateways)`——走真实的 connect → challenge → signMessage → verify 链路造已登录态。
- `fakeNavigation()`——断言跳转目标。

配套改动：

- `RuntimeContext` 导出（仅测试壳使用，业务仍用 `useFoundationRuntime`）。
- jest `transformIgnorePatterns` 加入 tamagui / @tamagui / react-native-svg / @gorhom / zustand（pnpm 的嵌套 `node_modules` 会让 jest-expo 默认白名单失效）。
- `src/test/setup.ts` 增加 mock：自写的轻量 reanimated 替身（官方 mock 仍会加载 worklets 原生模块）、`@gorhom/bottom-sheet/mock`、expo-haptics、expo-clipboard。

两个用得着记住的坑：RNTL 14 + React 19 的 `render()` 返回 **Promise**（必须 `await`，查询走 `screen`）；bottom-sheet 的 mock 会把 sheet 内容**随页面一起渲染**，同名文案要用 `getAllByText`。

## 首批用例（32 例，覆盖最容易回归的行为）

| 套件                          | 覆盖                                                                                                     |
| ----------------------------- | -------------------------------------------------------------------------------------------------------- |
| `harness.spec`                | Provider 栈可渲染、模块开关注入生效                                                                      |
| `assets-screen.spec`          | 游客门禁；Predict 开关控制预测账户卡与第三个动作（划转 ↔ 兑换）；金额走格式化而非最小单位                |
| `settings-screen.spec`        | 交易偏好组随模块出现 / 隐藏；行值反映设备偏好；更新红点与"已是最新"二选一                                |
| `security-center-screen.spec` | 安全等级由应用锁 / 交易前验证 / 备份三项计算（高 / 中 / 低）与建议文案；代币授权管理仅 DEX 开启时出现    |
| `market-list-screen.spec`     | 游客不显示余额 chip；登录后显示；余额为 0 换成"去充值"；持仓入口仅双开时出现；专场 banner 与卡片来自网关 |
| `positions-screen.spec`       | 游客门禁；可领取仓位出现"领取"；领取后入口消失                                                           |
| `foundation-home-screen.spec` | 游客欢迎卡 + 铃铛隐藏；登录后换成资产卡与地址 chip；模块区块按开关渲染                                   |
| `swap-screen.spec`            | 游客先连接钱包；输入后出报价且明细全部展开不折叠；余额不足按钮变"去划转"                                 |

## 验证

`pnpm check` 全绿：27 套件 112 例（此前 20 套件 80 例）。
