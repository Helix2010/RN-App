# Bugfix: refresh-bootstrap-before-update

状态：Complete

## 用户场景与现状证据

- 用户/角色：安装 direct APK、通过管理端发布新版本的 Android 用户。
- 当前行为或复现：1.1.5 冷启动显示 `embedded-1`，说明远端 Bootstrap 校验失败后进入 fallback；更新中心点击“检查更新”直接读取旧 config，没有先刷新服务端策略。
- 代码调用链：`UpdateCenterScreen.checkUpdates -> config.update`；启动链为 `useBootstrap -> loadBootstrap -> apiClient.get -> bootstrapSchema`。服务端当前返回 `update.ota.applyStrategy: null`，客户端 schema 只允许枚举或 undefined，导致整份响应被判为 incompatible response。
- 非目标：本次不调整发布状态机、下载器、安装器或 OTA runtime 规则。

## Given / When / Then

1. Given 服务端返回 1.1.5 且当前安装版本为 1.1.2，When 用户点击检查更新，Then 客户端先刷新 Bootstrap，并按新响应进入 APK 全量更新流程。
2. Given 服务端暂无 active OTA，When Bootstrap 返回 `applyStrategy: null`，Then 客户端接受响应，不得退回 `embedded-1`。
3. Given Bootstrap 刷新失败，When 用户点击检查更新，Then 保留现有可用配置并展示远端配置不可用，不误报已是最新版本。

## UI 与交互状态

- loading / empty / content：刷新和检查共用 busy 状态；成功后立即使用新快照判断 APK/OTA。
- error / timeout / offline：刷新失败显示现有错误区域，缓存仍可展示但不作为“刚刚检查”的成功结果。
- 重复提交 / 取消 / 返回：busy 时禁止重复点击；页面返回行为不变。
- light / dark / 字体放大 / 无障碍：沿用现有设计系统按钮、错误文本和下载弹层。

## 技术影响

- API/OpenAPI：不改路由；客户端契约接受服务端已有的 nullable `update.ota.applyStrategy`。
- 状态与本地数据：手动检查会覆盖 TanStack Query 中的 Bootstrap 快照并更新域名隔离缓存。
- 钱包/签名/链/金额精度：无影响。
- 权限、隐私与遥测：无新增权限，不记录响应载荷或敏感信息。
- OTA 或全量更新：纯 JS/契约修复可 OTA；用于验证全量升级时仍需重新构建 APK。

## 验证与发布

- 修复前失败测试或需求测试：nullable `applyStrategy` 的当前服务端响应被 schema 拒绝；已增加 nullable 契约测试、远程 1.1.5 响应测试和手动检查刷新路径。
- iOS / Android：`pnpm check` 通过；Android Release `1.1.7/build 11` 使用 direct 环境构建，并完成 APK 内置配置、元数据、权限、签名校验。
- 灰度指标与停止条件：观察 Bootstrap incompatible response、fallback 使用率和 APK 下载失败率。
- 回滚：恢复 schema 与 UpdateCenter 刷新编排；无数据迁移。已发布的 1.1.5 仍需通过 1.1.6 全量包获得本修复，不能依赖 OTA 自愈。

补充约束：Bootstrap 远程请求和有效缓存都失败时，运行时只展示启动门禁与重试，不再把 `createFallbackConfig` 暴露给业务页面；内置配置仅保留为启动门禁的静态视觉依赖。
