# S-07 更新弹窗（软更新 / 强制更新）

- 日期：2026-08-31
- 设计稿：`UI/src/60-settings.html` S-07；规格 `UI/docs/settings-spec.md` §5

## 现状与问题

此前只有：冷启动时 App 壳里一张内嵌卡片（仅 Android 直装包才出现，store 包完全没有提醒），点"立即更新"跳转全屏"升级中心"；关闭状态只存在内存里，每次冷启动都会再弹一次。设计要求的是首页上的模态弹窗 + 24h 节流 + 强制态不可关闭。

## Given / When / Then

- Given 有可选 / 建议更新 When 冷启动进首页 Then 弹出模态：徽标 + "发现新版本 {version}" + "{size} · 当前 {current}" + 最多 3 条要点 + 「立即更新」/「稍后再说」。
- Given 点「稍后再说」（或点遮罩 / 系统返回）Then 关闭；**同一版本 24 小时内不再弹**（`foundation.update-prompt.v1` 持久化 `lastPromptedVersion` / `lastPromptedAt`）；仍可从 S-02 检查更新 / S-06 进入。
- Given 强制更新（`decision === "required"`）Then 无「稍后再说」，副标题"此版本已停止服务，更新后继续使用"，点遮罩与系统返回都不关闭，且不受 24h 节流约束。
- Given Android 直装包 When 点「立即更新」Then 应用内下载，按钮位置换成品牌色进度条 + 百分比，完成后按钮变「安装」并调起安装器；失败 toast「下载失败，请检查网络后重试」并恢复按钮。
- Given store / iOS 包 When 点「立即更新」Then 用系统方式打开 `update.full.actionUrl`（不再只是跳转到升级中心）。

## 技术影响

- 新增 `src/core/updates/update-prompt-store.ts`：纯函数 `shouldPromptUpdate()` + 持久化节流 store。
- 新增 `src/features/updates/update-modal.tsx`，替换 `app-shell-screen.tsx` 里的内嵌卡片（连带删掉 `updateKey` / `dismissedUpdateKey` 内存状态）。
- i18n 新键 `update.modalTitle` / `modalMeta` / `forceSubtitle` / `now` / `later` / `install` / `downloading` / `downloadFailed` / `openedStore`。
- 既有的"强更时导航器只渲染锁定升级中心"保持不变，作为兜底；本弹窗覆盖锁定页不生效的情况（例如租户没配 `actionUrl`）。
- `scheduleMock()`：Mock 状态机的 setTimeout 在 Node 下 unref，修掉 jest 跑完不退出的问题。

## 验证

- 单测 11 例：`shouldPromptUpdate` 5 例（无更新 / 强更忽略节流 / 首见即弹 / 24h 内静默且到期再弹 / 时间戳缺失或损坏）＋ 弹窗渲染 6 例（无更新不显示、软更新内容与双按钮、写入节流记录后同版本不再弹、强更去掉「稍后」并给出停服说明、强更无视节流、无 actionUrl 不显示）。
- 弹窗测试抓到一个真 bug：写入节流记录会让 `shouldPromptUpdate` 立刻变 false，弹窗把自己关掉；改为**挂载时判定一次**。
- Android 模拟器（`rn_smoke`，2026-08-31 03:33–03:35，用临时补丁强制出更新态、截图后已回滚）：
  - 软更新弹窗内容与双按钮 ✅ `soft-update.png`
  - 点「稍后再说」关闭 → 冷启动后不再弹（节流生效）✅ `later-and-throttle.png`
  - 强制态无「稍后再说」、有停服副标题、按系统返回键不关闭 ✅ `forced-update.png`
- 未验证：Android 应用内下载的进度条与「安装」（需要真实 APK 直链与 direct 分发包）；iOS。
