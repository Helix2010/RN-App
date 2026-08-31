# Feature: profile-product-shell

状态：Completed

> 2026-08-30 follow-up：按 S-01 设计稿重排为“账户 / 我的 / 更多”三段式列表；版本信息入口移至“关于”，个人中心只显示 App 版本摘要，Build/Runtime/OTA/配置版本在 About 详情页展示。

## 用户场景与现状证据

- 用户/角色：DEX / Web3 App 用户，从首页进入个人中心管理偏好、安全、通知和升级。
- 当前行为或复现：首页已采用新版交易产品布局，但个人中心仍是通用标题、单色身份卡和基础列表，页面密度和入口层级与首页不一致。
- 代码调用链：`FoundationHomeScreen -> FoundationNavigator.Profile -> ProfileScreen -> Settings / SecurityCenter / NotificationSettings / UpdateCenter`。
- 非目标：本轮不接真实钱包账户接口，不重构预测、DEX、资产 Mock 数据或升级业务状态机。

## Given / When / Then

1. Given 用户进入个人中心，When 页面完成渲染，Then 身份、连接状态、网络、语言和版本在首屏形成稳定摘要。
2. Given 用户需要管理应用，When 点击快捷入口或分组列表，Then 可进入设置、安全、通知和升级中心，且两个入口复用同一路由。
3. Given 主题或语言变化，When 页面重绘，Then 所有卡片、图标、边框、状态色和文案使用设计令牌与远程语言资源。

## UI 与交互状态

- loading / empty / content：个人中心依赖已经验证的 Bootstrap，内容页显示身份摘要与现有功能入口。
- error / timeout / offline：缓存配置时连接状态明确显示“使用安全缓存”，不伪装为在线。
- 重复提交 / 取消 / 返回：入口均使用导航栈；系统返回和边缘返回继续回到首页。
- light / dark / 字体放大 / 无障碍：只使用设计令牌；快捷入口和列表行均有可访问名称和最小点击区。

## 技术影响

- API/OpenAPI：无变更，继续消费现有 Bootstrap、通知与更新状态。
- 状态与本地数据：无新增事实源；身份和资产仍为明确的 Mock 数据。
- 钱包/签名/链/金额精度：不新增钱包写操作、签名或金额计算。
- 权限、隐私与遥测：不新增权限和采集字段。
- OTA 或全量更新：纯 JS/样式和远程文案键扩展，可通过 OTA；APK 仅用于本轮模拟器验收。

## 验证与发布

- 修复前失败测试或需求测试：以模拟器旧版截图和 ProfileScreen 旧结构为基线；导航类型与全量门禁覆盖回归。
- iOS / Android：`pnpm check` 通过；Android `emulator-5554` 已验证个人中心首屏、快捷入口和设置跳转，无原生崩溃。
- 灰度指标与停止条件：若入口路由错误、内容溢出或远程文案缺失则停止 OTA；当前远程缺失键由同语言内置包补齐。
- 回滚：回退 ProfileScreen、Navigator 和 fallback 文案变更；无数据迁移。
