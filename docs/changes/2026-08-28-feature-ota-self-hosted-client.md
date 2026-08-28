# Feature: ota-self-hosted-client

状态：Implemented（代码完成，原生 Development Build 未在当前环境运行）

## 用户场景与现状证据

- 用户/角色：按租户 API 域名构建的 RN-App 用户与发布管理员。
- 当前行为或复现：expo-updates 原生检查为 ON_LOAD，可能在 Bootstrap 读取租户 `otaEnabled` 前请求 OTA；更新服务只返回 ready/current/error，无法表达回退和下载阶段。
- 代码调用链：`app.config.ts` → 原生 expo-updates 配置 → `FoundationRuntimeProvider` Bootstrap → `core/updates/update-service.ts` → `UpdateCenterScreen`。
- 非目标：本变更不实现 RN-Server Manifest/OBS 上传，不增加原生模块；原生配置变更须通过 prebuild 和全量 APK/IPA 验证。

## Given / When / Then

1. Given 构建配置包含租户 API 域名，When 生成非开发 Expo 配置，Then OTA URL 默认是同域名 `/v1/ota/manifest`，并使用 `checkAutomatically=NEVER`。
2. Given Bootstrap 返回 `otaEnabled=false`，When App 启动或进入升级中心，Then 不调用 expo-updates 检查，继续使用 embedded/当前 bundle。
3. Given Bootstrap 成功且 OTA 开启，When 后台或用户手动检查，Then 状态按 checking → available → downloading → ready/current/error 更新，且不阻塞 App 启动；Manifest `metadata.applyStrategy=next_launch` 只提示 ready，`immediate` 也必须等待用户确认重启。
4. Given OTA 服务返回 `isRollBackToEmbedded`，When App 检查，Then 状态为 rollback 并保留 embedded 安全路径。
5. Given OTA 检查或下载失败，When App 继续运行，Then 使用 expo-updates 已缓存的最后稳定更新或 embedded bundle，且仅上报脱敏 updateId/runtime/channel。

## UI 与交互状态

- loading / empty / content：升级中心展示当前 embedded/OTA 信息、检查中、可用、下载中、已就绪、当前最新等状态。
- error / timeout / offline：OTA 失败只在升级中心提示，不阻塞启动；Expo 原生回退到缓存/embedded。
- 重复提交 / 取消 / 返回：检查按钮在检查和下载期间禁用；应用重启失败显示错误并可重试；没有自动重启。
- light / dark / 字体放大 / 无障碍：沿用现有设计系统和多语言 Key，状态文本不依赖颜色单独传达。

## 技术影响

- API/OpenAPI：沿用 Bootstrap `update.ota`，增加可选 `revision/updateId/baseReleaseId/releaseNotes` 字段；Manifest URL 由租户 API 域名构建参数确定。
- 状态与本地数据：不新增持久化事实源；expo-updates 负责缓存和失败回退，运行时仅维护状态快照。
- 钱包/签名/链/金额精度：
- 权限、隐私与遥测：新增 vendor-agnostic telemetry sink，仅允许截断后的 updateId/runtime/channel，不携带 token、URL query 或错误正文。
- OTA 或全量更新：纯 TS/Bootstrap 状态变化可 OTA；`updates.url`、`checkAutomatically`、代码签名证书等原生配置变化必须全量构建。

## 验证与发布

- 修复前失败测试或需求测试：update-service 覆盖 disabled/embedded、available/download/ready、rollback 及状态转换；bootstrap schema 覆盖新增可选字段。
- iOS / Android：`pnpm typecheck`、相关 Jest、Expo config profile 已运行；iOS/Android Development Build 未运行，需在执行 prebuild 后全量验证原生 `EXUpdatesEnabled=true` 与 `NEVER`。
- 灰度指标与停止条件：本期不做灰度；上线前观察 OTA check/download error、启动失败、emergency launch 和 embedded fallback。
- 回滚：服务端关闭 Bootstrap `otaEnabled`；暂停/撤回 OTA；客户端失败时继续缓存或 embedded；原生配置问题通过上一全量包回退。
