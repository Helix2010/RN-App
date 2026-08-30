# ADR 0005：OTA 按 APK 版本隔离 Runtime

## 状态

Accepted

## 背景

仅使用 fingerprint Runtime 时，不同 App Version 可能落入同一个 OTA runtime/channel。历史 OTA 因此可能在新 APK 启动后被 Expo Updates 选中，覆盖新 APK 内置的页面 Bundle。卸载重装还可能恢复旧 Updates 缓存。

## 决策

- `runtimeVersion` 显式使用 APK 的 App Version，例如 `1.1.9`；
- OTA 发布必须选择对应 APK 基线，Server 校验 `tenant + platform + channel + runtimeVersion + app version + build number`；
- App 的 Updates 请求携带 `x-app-version` 和 `x-build-number`；
- App 收到 Manifest 后再次校验 `extra.expoClient` 身份；
- Android 生产包关闭备份，避免恢复旧 OTA 状态。

## 影响

这是原生更新策略变化，必须通过全量 APK/AAB 发布，不能用 OTA 改变当前 APK 的 Runtime。每个新 APK 版本需要发布匹配 Runtime 的 OTA；旧 Runtime OTA 不会被新 APK 接收。

## 回滚

若需要恢复旧 APK 的 OTA，使用旧 APK 对应的 Runtime 和 Build 发布新 OTA；不能跨 Runtime 复用资源。
