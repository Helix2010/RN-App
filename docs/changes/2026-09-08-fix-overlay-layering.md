# 弹层打开时消息提示与进行中提示被压在弹层后面

日期：2026-09-08

## 现象

有弹层（底部弹层、更新弹窗）时，toast 消息提示和进行中的提示显示在弹层后面，被遮罩盖住，
用户看不到操作结果。登录超时的提示此前只能靠先关闭二维码弹层来绕开（`use-session.ts` 注释）。
更新弹窗里"下载失败 / 已打开商店 / 安装器已打开"三条 toast 从来没有显示过。

## 原因

- `ToastHost` 挂在 `BottomSheetModalProvider` 内部，而该 Provider 把弹层宿主渲染在 children 之后，
  绘制顺序上 toast 永远在弹层下面。
- 更新弹窗使用 React Native 原生 `Modal`，是独立窗口，根层 toast 进不去。

见 ADR 0011。

## 修复

- 新增 `src/design-system/overlay.tsx`：`OverlayLayer`（挂在 `App.tsx` 的 `BottomSheetModalProvider`
  之外、之后）统一承载全屏遮罩 → 阻塞式 loading → toast 三层；提供 `FullScreenOverlay`、
  `useBlockingLoading` / `blockingLoading`。
- `UpdateModal` 由 RN `Modal` 改为 `FullScreenOverlay`，返回键与遮罩点击语义不变。
- `ToastHost` 移入 `OverlayLayer`；测试 harness 挂 `OverlayLayer`，`wallets-screen.spec` 与
  `send-screen.spec` 不再各自渲染 `ToastHost`。
- 保留原生 `Modal` 的三处（应用锁、OTA 强制更新、扫码）都不弹 toast，原因见 ADR。

## 验证

- `overlay.spec.tsx`：遮罩内容渲染在根层、返回键回调、阻塞 loading 计数与 toast 在其上层、卸载即收起。
- `update-modal.spec.tsx` 全部通过（24h 节流用例改为先 `await screen.unmount()` 再模拟下一次冷启动）。
- 全量 jest / lint / typecheck / format 通过。
- 模拟器（rn_smoke，`pnpm android:release anyfun` 产出的 1.2.9 build 23 安装包）：资产页打开"收款"底部弹层，
  点"复制地址"，"已复制" toast 显示在弹层之上（此前被弹层遮罩盖住）。
