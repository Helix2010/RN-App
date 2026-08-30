# ADR 0008：半屏面板、图表与触感反馈的技术选型

- 状态：已采纳（2026-08-30）
- 关联：`docs/interaction-spec.md`（UI 仓库）§0 技术基线；ADR 0007

## 背景

设计稿大量使用半屏 sheet（登录、下单、划转、筛选）、迷你走势 / 面积图 / K 线，以及按钮触感。项目此前没有 Sheet 与图表组件，业务页把这些做成了全屏页。

## 决定

| 能力 | 选型 | 理由 |
| --- | --- | --- |
| 半屏面板 | `@gorhom/bottom-sheet` v5（`BottomSheetModal` + 动态高度 + 键盘避让） | 纯 JS，基于已引入的 reanimated / gesture-handler；拖拽关闭、遮罩点按、多档位齐全 |
| 图表 | `react-native-svg` 自绘（`Sparkline` / `AreaChart` / `CandleChart`） | 体量小、可完全跟随主题 token；先不引入 skia / victory，避免包体与原生依赖膨胀 |
| 触感 | `expo-haptics` | 与 Expo 版本对齐 |
| 剪贴板 | `expo-clipboard` | 地址复制 + toast |

设计系统统一封装：`src/design-system/sheet.tsx`（`Sheet`，`locked` 时禁用全部关闭手段）、`controls.tsx`（`Switch` / `RadioRow` / `Tabs` / `TextField` / `AmountInput` / `DetailRow`）、`toast.tsx`（zustand 队列 + `ToastHost`）、`charts.tsx`。features 仍禁止直接引用 `tamagui` / 第三方 UI 库，只能经由 design-system。

## 影响

- `react-native-svg`、`expo-haptics`、`expo-clipboard` 是原生模块：需要重新 `expo prebuild` + 构建 Development Build（本次已在 `rn_smoke` 上重建）。
- `BottomSheetModalProvider` 挂在 `GatewayProvider` 内、导航之外，全局登录 sheet 与 Toast 同层。

## 备选方案

- Tamagui `Sheet`：手势与键盘处理弱于 gorhom，且 features 不能直接引用。
- 自研 PanResponder sheet：与交互规范"禁止再写 PanResponder"冲突。
