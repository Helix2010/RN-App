# Feature: foundation-app-polish

状态：Implemented

## 用户场景与现状证据

- 用户/角色：DEX / Web3 App 用户，以及复用基座的产品与开发团队。
- 当前行为或复现：首页是远程配置技术演示，缺少品牌、正式导航、设置页和完整国际化；Feature Flags 只被展示，部分未真正约束页面能力；服务端 type=14 文案混入旧 RWA 业务 Key。
- 代码调用链：`FoundationRuntimeProvider -> FoundationNavigator -> FoundationHomeScreen / UpdateCenterScreen`；服务端 `bootstrap -> compiledMessages -> language_document`。
- 非目标：本轮不实现真实钱包登录、行情交易、Swap、KYC 或推送；不引入新的原生 SDK。

## Given / When / Then

1. Given App 启动，When 本地偏好恢复完成，Then 显示可跳过的品牌启动页并进入正式首页。
2. Given 远程主题为 light/dark，When 用户切换主题，Then 首页、设置、升级页和通用组件使用同一语义令牌。
3. Given 用户进入设置，When 调整主题或语言，Then 偏好持久化并立即生效；功能开关只展示真实支持的能力。
4. Given 服务端多语言迁移执行，When App 请求 zh-CN/en-US，Then 只返回当前 App 正式使用的规范 Key，不再包含旧 RWA 文案。

## UI 与交互状态

- loading / empty / content：启动页、首页骨架/缓存状态、设置内容、升级策略均有明确状态。
- error / timeout / offline：远程失败使用安全缓存或本地 fallback；首页展示轻量离线状态并允许重试。
- 重复提交 / 取消 / 返回：刷新和升级检查期间禁用重复 intent；设置即时保存，无提交按钮。
- light / dark / 字体放大 / 无障碍：所有页面支持 light/dark/system；按钮、设置项和状态图标提供可读 label，布局允许换行。

## 技术影响

- API/OpenAPI：沿用 bootstrap/localization 契约；服务端增加数据迁移重置 type=14 正式文案。
- 状态与本地数据：Zustand 偏好增加启动页已查看版本；主题和语言继续持久化。
- 钱包/签名/链/金额精度：仅展示不可交易的演示资产，金额为静态 UI 样例，不参与签名或计算。
- 权限、隐私与遥测：不新增权限；诊断信息默认隐藏在设置的高级区域。
- OTA 或全量更新：页面、组件、文案可 OTA；App icon、adaptive icon、native splash 配置必须全量更新。

## 验证与发布

- 修复前失败测试或需求测试：导航、设置偏好、功能开关、语言 Key 集合和服务端迁移测试。
- iOS / Android：必须完成 Development Build；若当前机器环境不能运行，交付明确标记 not run。
- 灰度指标与停止条件：关注冷启动成功、bootstrap 成功率、设置切换和升级入口错误；启动失败或主题不可读立即停止。
- 回滚：App UI 可回滚到上一 OTA；原生 icon/splash 通过上一全量包回滚；服务端迁移只保留正式 Key，回滚代码不恢复已删除旧文案。

## 已落地实现

- AnyFun Logo 替换为深海蓝与 Azure 渐变几何标志，更新 iOS/Android 图标、Adaptive Icon 和开屏图标资源。
- 增加品牌启动页动画：700ms 最小展示、1.8s 网络兜底，远程 bootstrap 成功或降级后进入首页。
- 首页改为资产总览、市场行情、版本升级和安全能力卡片；设置与升级入口通过 typed navigation 连接。
- 新增设置页：主题偏好、语言偏好、升级能力、版本信息和诊断入口；`allowUserOverride=false` 时锁定系统主题。
- Feature Flags 真实生效：升级中心、OTA、Android 直装和诊断信息分别受控。
- RN-Server migration 8/9 清理旧 type=14 文案、初始化 RN-App 正式 zh-CN/en-US Key，并统一小写 Key；发布资源需要管理端重新发布。

## 验证状态

- `pnpm check`：passed。
- Android `./gradlew assembleDebug`：passed，package `com.anyfun.foundation`，version `1.1.0`，versionCode `4`。
- iOS Development Build：not run，当前机器只有 CommandLineTools，没有完整 Xcode。
