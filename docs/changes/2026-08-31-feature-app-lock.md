# 应用锁与交易前验证（让 S-08 的开关真正生效）

- 日期：2026-08-31
- 设计稿：`UI/src/61-security.html` S-08；规格 `UI/docs/settings-spec.md` §6

## 现状与问题

`appLockEnabled` / `autoLockMinutes` / `txConfirm` / `largeAmountThresholdUsd` 四个偏好此前只被安全中心用来算"安全等级"，没有任何一处代码读它们去挡人：应用锁开着也不锁，"交易前验证"开着下单也不验证。开关是假的。

## Given / When / Then

- Given 开启应用锁且本机设置了生物识别或锁屏密码 When 冷启动（已连接钱包）Then 全屏锁屏挡住导航器并自动调起系统验证；通过后进入应用。
- Given 应用退到后台超过"自动锁定"时长 When 回到前台 Then 重新上锁；未超过则直接进入。「立即」= 离开即锁。
- Given 用户取消系统验证 Then 保持锁定，文案不变，可点「解锁」重试；Given 验证失败 Then 文案换成"验证未通过，请重试"。
- Given 本机没有生物识别也没有锁屏密码 Then **永不上锁**，安全中心把副标题换成"本机未设置生物识别或锁屏密码，应用锁暂不生效"，且不计入安全等级。
- Given 开启"交易前验证" When 下单 / 兑换 / 划转 / 转出 Then 先过系统验证，取消则静默中止、失败则 toast「验证未通过，操作已取消」。
- Given 关闭"交易前验证" When 单笔转出金额 ≥ 大额阈值 Then 仍要验证。
- Given 关闭应用锁开关（安全中心或设置页）Then 必须先通过身份验证，否则开关弹回。

## 技术影响

- 新增 `src/core/security/app-lock.ts`：纯函数 `shouldLockOnResume()` / `shouldFallbackToPasscode()`、`authenticate()`（连续失败 3 次改用 strong + 设备密码）、`isDeviceEnrolled()`、zustand `useAppLock`（`locked` / `backgroundedAt` / `enrolled` / `lastAttemptFailed`）。
- 新增 `src/features/security/app-lock-gate.tsx`（挂在 `App.tsx` 导航器之上）、`use-require-verification.ts`、`use-app-lock-toggle.ts`。
- 接入点：`send-screen` / `swap-screen` / `transfer-form` / `order-sheet` 的 `submit` 改为 async，先 `await requireVerification()`；只有转出传 `usdValue` 参与大额阈值判定（设计里"大额确认"只针对转出）。
- `isDeviceEnrolled()` 用 `getEnrolledLevelAsync() !== NONE` 而不是 `isEnrolledAsync()`：后者在 Android 上只认生物识别，只设了 PIN / 图案的设备会被误判成"不可用"，应用锁就永远不生效。
- 验证结果写进 zustand 而不是组件 state：自动弹窗的 effect 里出现同步 `setState` 会被 React Compiler 规则判为级联渲染。
- i18n 新键 8 个：`security.locked.title` / `locked.subtitle` / `unlock` / `unlock.failed` / `appLock.unavailable` / `appLock.disableReason` / `verify.reason` / `verify.failed`。
- 依赖：`expo-local-authentication@~57.0.2`（需要重新出原生包）。

## 安全取舍

只在设备"可验证"时才上锁。若按开关字面意思照锁不误，一台没有任何凭据的设备会永久打不开——用户既无法解锁，也无法进入设置去关掉锁。宁可让锁失效并在界面上说清楚。

## 验证

- 单测 25 例：`shouldLockOnResume` 7 例（超时上锁 / 宽限期内不锁 / 立即锁 / 开关关闭 / 设备无凭据 / 从未进过后台 / 时钟回拨）、`shouldFallbackToPasscode` 1 例、`isDeviceEnrolled` 3 例（仅 PIN 算可用 / 无锁屏不可用 / 原生模块缺失不抛）、`useRequireVerification` 6 例（开关开 / 关且小额放行 / 关但大额仍验 / 取消无 toast / 失败有 toast / 设备无凭据放行）、`AppLockGate` 6 例（冷启动上锁并解锁 / 失败留在锁屏 / 取消不显示失败文案 / 无凭据不锁 / 未登录不锁 / 开关关闭不锁）、安全中心 2 例（未生效提示与不计分 / 关闭需验证）。
- Android 模拟器（`rn_smoke`，2026-08-31 03:52–04:05，为验证临时给模拟器设了 PIN 1234，验完已 `locksettings clear`）：
  - 冷启动即锁：系统验证弹窗自动弹出（`mCurrentFocus=BiometricPrompt`，提示语 "Verify your identity to continue"）；按返回取消后停在自绘锁屏（品牌标 + App locked + Unlock）✅ `lock-screen.png`（系统弹窗本身被 Android 标记为安全窗口，截图为黑屏，故用 `cold-start-prompt.png` + uiautomator dump 佐证）
  - 点「Unlock」→ 输入设备 PIN → 进入首页 ✅ `unlocked.png`
  - 交易前验证：划转 750 USDC 点确认 → 弹系统验证；**取消 → 金额、余额、总资产全部原样，没有发生划转** ✅ `verify-cancelled.png`；再次确认并通过 → 钱包 12,395.71 → 11,645.71、Predict 2,098.62 → 2,848.62 ✅ `verify-passed-transfer.png`
  - 自动锁定：默认 5 分钟时，退后台 5 秒回来不锁 ✅；改成「立即」后退后台再回来立刻要求验证 ✅
  - 关闭应用锁需验证：取消 → 开关仍为 on、等级仍是 High ✅ `disable-requires-auth.png`；通过验证 → 开关 off、等级降为 Medium 并提示「建议开启应用锁」✅ `app-lock-off.png`
  - 设备无凭据：清掉 PIN 后冷启动直接进首页不锁 ✅；安全中心副标题与顶部建议都换成"本机未设置生物识别或锁屏密码，应用锁暂不生效"，等级不计这一项 ✅ `app-lock-unavailable.png`
- 模拟器验证抓到一处文案 bug：锁开着但设备没凭据时，顶部建议仍显示"建议开启应用锁"（它已经开着）。已改为显示"不生效"说明，并补了一条断言。
- 未验证：iOS（无 macOS）；真机指纹 / Face ID 通道（模拟器只有设备密码，走的是 DEVICE_CREDENTIAL 回落）；连续失败 3 次切 strong 的分支只有单测覆盖。
