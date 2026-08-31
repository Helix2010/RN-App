# Feature: managed-trading-theme

状态：Completed

## 用户场景与现状证据

- 用户/角色：需要由管理端统一维护 Light/Dark 主题颜色的 Web3 App 用户和运营人员。
- 当前行为或复现：App 使用旧 ocean 配色；页面图标还保留 Unicode 兼容分支；管理端虽然可以逐项编辑颜色，但缺少设计稿交易产品配色预设和应用说明。
- 代码调用链：`RN-Admin AppConfigPage -> mobile-bootstrap.theme.light/dark -> RN-Server Bootstrap -> FoundationThemeProvider -> Tamagui`。
- 非目标：不把主题颜色写死到业务页面，不新增租户主题表，不绕过管理端保存流程。

## Given / When / Then

1. Given 管理员在“配置中心 → 应用配置 → 语义主题”点击交易产品配色预设并保存，When App 下次刷新 Bootstrap，Then Light/Dark 页面、卡片、文字、状态色和按钮全部使用新颜色。
2. Given App 使用深色或浅色模式，When 主题切换，Then 颜色来自当前 Bootstrap 主题对象，不回退到业务页固定颜色。
3. Given 业务页面需要图标，When 渲染，Then 统一使用 `design-system/AppIcon`，不再依赖系统字体 Unicode 图形。

## UI 与交互状态

- loading / empty / content：主题沿用 Bootstrap loading/safe cache；管理端预览实时反映草稿颜色。
- error / timeout / offline：主题请求失败继续使用有效缓存，禁止使用未校验的服务端颜色。
- 重复提交 / 取消 / 返回：管理端保存继续使用 expectedVersion/reason/confirm；App 不新增主题状态源。
- light / dark / 字体放大 / 无障碍：两套语义色都覆盖；AppIcon 保持可访问标签由父控件提供。

## 技术影响

- API/OpenAPI：无字段变更，继续使用 Bootstrap `theme.light/dark`。
- 状态与本地数据：无新增持久化；管理端草稿保存到 `app_configs.mobile-bootstrap`。
- 钱包/签名/链/金额精度：无影响。
- 权限、隐私与遥测：无新增权限和敏感数据。
- OTA 或全量更新：颜色和图标 JS 可 OTA；`@expo/vector-icons` / `expo-font` 字体资源仍需完整 APK/IPA 验证。

## 验证与发布

- 修复前失败测试或需求测试：已增加管理端配色预设测试；RN-App `pnpm check` 通过。
- iOS / Android：RN-App 58 tests、RN-Admin 36 tests 通过；Android 测试 Bundle 能启动。当前未直接修改 web4 数据库，生产颜色需管理员在管理端点击预设并保存。
- 灰度指标与停止条件：关注 Bootstrap 主题校验失败、颜色对比度和图标字体加载失败。
- 回滚：管理端恢复上一版主题 JSON 或回退代码；无数据迁移。
