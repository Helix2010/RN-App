# ADR 0011：应用级覆盖层——toast / 阻塞 loading / 全屏遮罩统一画在弹层之上

- 状态：已采纳（2026-09-08）
- 关联：ADR 0008（sheet / 图表 / 触感）、`src/design-system/overlay.tsx`

## 背景

真机反馈：只要有弹层（尤其是底部弹层）打开，页面的进行中提示和消息提示都显示在弹层后面，用户看不到操作结果。代码里早有绕路的痕迹——`use-session.ts` 在登录超时时先关掉二维码弹层再提示，注释写着"toast 会被还开着的二维码压住"。

根因有两个，都是层叠结构问题，不是某个页面写错：

1. 底部弹层来自 `@gorhom/bottom-sheet` 的 `BottomSheetModal`。`BottomSheetModalProvider` 把弹层宿主渲染在**自己 children 之后**，因此任何挂在 Provider 内部的东西（此前 `ToastHost` 就挂在里面）在绘制顺序上都在弹层下面，被遮罩盖住。
2. 更新弹窗、应用锁、OTA 强制更新、扫码用的是 React Native 原生 `Modal`。原生 Modal 是独立窗口，根层的 toast 无论怎么排都进不去；更新弹窗里"下载失败"这类 toast 从来没有被看见过。

React Native 没有 `createPortal`，逐个页面在弹层里再挂一份 toast / loading 只会把问题复制到每个弹层。

## 决定

新增 `OverlayLayer`（`src/design-system/overlay.tsx`），挂在 `App.tsx` 里 `BottomSheetModalProvider` **之外、之后**的兄弟位置，自下而上固定三层：

| 层 | API | 用途 |
| --- | --- | --- |
| 全屏遮罩 | `FullScreenOverlay` | 替代 RN `Modal`（transparent + fade）的应用内弹窗；Android 返回键语义与 Modal 一致 |
| 阻塞式进行中 | `useBlockingLoading(active, label)` / `blockingLoading.show()` | 弹层关掉之后才结束、或跨页面的工作；计数式，多个并发调用互不打断 |
| 消息提示 | `toast()` / `ToastHost` | 最上层，任何位置调用都能被看见 |

三者都通过 store 注册，任何位置调用；内容在 `OverlayLayer` 所在位置渲染，拿到的是根层 context（主题 / 运行时 / Query / 网关），没有导航与 BottomSheetModal 上下文，需要时把回调作为 props 传入。

原生 `Modal` 只保留三处，且都不会弹 toast：

- 应用锁 `AppLockGate`：隐私上必须盖住一切，包括 toast；
- OTA 强制更新（`runtime-context.tsx`）：阻塞态，状态文案在弹窗内部；
- 扫码相机 `AddressScanner`：全屏相机预览。

更新弹窗 `UpdateModal` 改用 `FullScreenOverlay`，下载失败 / 已打开商店等提示现在能盖在弹窗之上。

## 新代码的要求

1. 半屏面板一律用 `Sheet`；应用内对话框用 `FullScreenOverlay`；除上面三处外不要再引入 RN `Modal`。
2. 弹层里的按钮进行中态仍用 `ActionButton loading`；只有工作在弹层关闭后仍在进行、或需要挡住整页时才用 `useBlockingLoading`。
3. 测试用 `renderWithProviders` 即可断言 toast / 遮罩 / loading：harness 已挂 `OverlayLayer`，不要再在用例里单独渲染 `ToastHost`。
4. RNTL 14 的 `screen.unmount()` 是异步的，必须 `await`；带 `accessibilityViewIsModal` 的遮罩会让兄弟节点在 RNTL 默认查询里被当作隐藏，断言 toast 时加 `includeHiddenElements: true`。

## 取舍

- 没有把应用锁 / OTA 强制更新 / 扫码也搬进覆盖层：它们要么必须盖住 toast，要么不需要 toast，搬进来只增加风险。
- 覆盖层内容拿不到导航 context 是有意为之——弹窗不应该直接导航，导航动作由调用方通过 props 提供。
