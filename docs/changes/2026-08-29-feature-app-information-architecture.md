# Feature: app-information-architecture

状态：Complete

## 用户场景与现状证据

- 用户/角色：使用 AnyFun DEX/Web3 移动端的普通用户。
- 当前行为或复现：首页、资产页和个人中心重复展示版本、配置、更新入口；设置和升级页使用单调的独立返回按钮；Android 返回键与系统边缘返回行为不统一。
- 代码调用链：`AppShellScreen -> FoundationHomeScreen/AssetsScreen/ProfileScreen`；堆栈页由 `FoundationNavigator` 管理；设置和升级状态仍来自远程 Bootstrap。
- 非目标：不新增业务钱包/交易功能，不改变升级服务端协议，不自定义系统级手势识别器。

## Given / When / Then

1. Given 用户浏览首页或资产页，When 远程配置正常，Then 只显示业务内容，不展示版本号、Runtime、配置版本或升级按钮。
2. Given 用户需要管理应用，When 进入个人中心，Then 设置和升级中心作为明确的二级入口出现；详细版本、Runtime、诊断和 OTA 信息只在设置/升级中心展示。
3. Given 用户位于设置或升级中心，When 点击顶部返回、Android 返回键或从屏幕边缘向内滑动，Then 按同一导航栈返回，不依赖页面底部额外返回按钮。
4. Given 用户在首页/资产/个人中心 Tab，When 按 Android 返回键，Then 非首页 Tab 先回到首页，首页再交由系统处理退出。

## UI 与交互状态

- loading / empty / content：沿用现有页面状态；各页面保留业务主卡片和下拉刷新。
- error / timeout / offline：沿用 Bootstrap 启动门禁和缓存状态；升级错误只在升级中心展示。
- 重复提交 / 取消 / 返回：统一 `ScreenHeader`；Native Stack 开启横向全屏手势和手势匹配动画；Tab 返回受控。
- light / dark / 字体放大 / 无障碍：返回按钮使用语义 token 和可访问性标签；标题可换行，操作目标不小于 44/48。

## 技术影响

- API/OpenAPI：无 API 变更；继续使用 Bootstrap 的 feature flags 和版本策略。
- 状态与本地数据：仅调整页面导航状态；不复制服务端状态。
- 钱包/签名/链/金额精度：无影响。
- 权限、隐私与遥测：无新增权限；不新增敏感日志。
- OTA 或全量更新：纯 JS/UI 变更，可 OTA；Native Stack 手势为现有原生能力配置。

## 验证与发布

- 修复前失败测试或需求测试：覆盖入口收敛、ScreenHeader 和版本信息不出现在首页/资产页。
- iOS / Android：运行完整 `pnpm check`；需在真机验证 iOS 左滑、Android 系统返回/预测返回和字体放大。
- 灰度指标与停止条件：观察页面崩溃、导航返回失败、升级中心到达率和 Tab 返回误触。
- 回滚：回退本次 App commit；无数据迁移、无服务端回滚要求。
