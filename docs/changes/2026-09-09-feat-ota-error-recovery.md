# OTA 崩溃恢复：原生侧 ON_ERROR_RECOVERY，全量 1.2.10 / build 24

日期：2026-09-09 · 背景：`docs/changes/2026-09-09-feat-collapsing-header.md` 的 rev 16 事故

## 需求

坏 OTA 启动即崩时，App 自己拉不到修复包（JS 已崩），用户只能清数据或重装。需要原生侧兜底。

## 改动

- `app.config.ts`：`updates.checkAutomatically` 由 `NEVER` 改为 `ON_ERROR_RECOVERY`。正常启动行为不变（原生不检查，JS 侧按租户 bootstrap 策略检查）；
  启动阶段 JS 异常时 expo-updates 自行拉最新更新（5 秒预算）并重启进入，拉不到且坏包从未成功启动过则回退上一个包。
- 这是原生配置，只能随全量包生效：anyfun 升 1.2.10 / androidVersionCode 24（服务端要求版本与 build 同时递增；runtimeVersion 随版本变为 1.2.10）。
- `docs/RELIABILITY_AND_RELEASE.md` §3.1 记录该策略与边界。

## 边界（评估结论）

- 只覆盖启动 10 秒内的 JS 异常；更晚的崩溃、被 ErrorBoundary 吃掉的错误、纯原生崩溃不触发。
- 弱网 5 秒拉不完就落到回退或崩溃。
- 恢复时绕过租户 OTA 开关直接取 channel 上的最新包，且没有 App 自己的"更新就绪"弹层与遥测。
- 与 JS 侧检查不冲突：请求头同一份（`requestHeaders`），下载进行中不会重复发起。

## 发布

- 1.2.9 / build 23 的 OTA（rev 17 / 18）继续对旧包生效；新包内嵌代码已包含全部改动，不需要新的 OTA。
- 之后的 OTA 必须以 1.2.10 的全量记录为基线（`baseReleaseId` 换新）。

## 验证

- `pnpm android:release anyfun` 出包并校验内嵌配置；APK 内嵌 `app.config` 的 `updates.checkAutomatically` 为 `ON_ERROR_RECOVERY`。
- 模拟器覆盖安装后正常启动。
- 服务端登记并发布全量记录：`rel_JHrSsfq0LQtaWX1o1NpZjg`（android 1.2.10 / build 24 / runtime 1.2.10，active，非强制，
  sha256 `50f9951e…9be7722`，签名指纹与 1.2.9 一致）；`/v1/public/releases/latest` 对 1.2.9 / 23 的直装客户端已返回 1.2.10。
- 模拟器：`adb install -r` 覆盖 1.2.9 成功，启动正常（expo-updates EndStartup 无错误）。
- 崩溃恢复路径本身无法在生产 channel 上安全演练（要发一个故意崩溃的 OTA），未做端到端验证。
- 之后给 anyfun 发 OTA：`baseReleaseId` 用 `rel_JHrSsfq0LQtaWX1o1NpZjg`，runtimeVersion 1.2.10；build 23 的用户仍在旧基线上收 rev 17 / 18。
