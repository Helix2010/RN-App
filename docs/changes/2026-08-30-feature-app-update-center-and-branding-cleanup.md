# Feature: app-update-center-and-branding-cleanup

状态：Completed

## 用户场景与现状证据

- 用户/角色：需要查看和执行 App 升级的终端用户。
- 当前行为或复现：升级中心把策略、OTA、全量、诊断和详情全部平铺；首页还展示仅面向开发者的“安全基座”能力卡；图标依赖系统字符和不稳定字体加载。
- 代码调用链：`FoundationHomeScreen -> UpdateCenterScreen -> Expo Updates / APK installer`；图标统一经过 `design-system/AppIcon`。
- 非目标：不修改升级服务端状态机、OTA Manifest 协议或 APK 下载接口。

## Given / When / Then

1. Given 没有可用更新，When 用户打开升级中心，Then 首屏只看到当前版本、最新状态和检查更新按钮。
2. Given 存在 OTA 或 APK 更新，When Bootstrap/检查返回更新，Then 只展示对应的升级卡片，技术详情默认折叠。
3. Given 用户查看首页，When 页面完成渲染，Then 不展示安全基座、签名更新等开发能力说明。

## UI 与交互状态

- loading / empty / content：升级中心保留核心状态卡和检查动作；详细 Runtime、Request ID、Release ID 放入详情展开区。
- error / timeout / offline：错误仍在当前卡片就近显示；下载中使用全屏进度层。
- 重复提交 / 取消 / 返回：沿用 busy 锁和统一返回手势。
- light / dark / 字体放大 / 无障碍：图标使用矢量图标系统；卡片和按钮沿用主题令牌。

## 技术影响

- API/OpenAPI：无变更。
- 状态与本地数据：无新增事实源。
- 钱包/签名/链/金额精度：无影响。
- 权限、隐私与遥测：新增 `expo-font` 作为图标字体 peer dependency，不新增权限。
- OTA 或全量更新：升级中心和首页为 JS 可 OTA；矢量字体资源和 Android 原生手势配置需要全量包验证。

## 验证与发布

- 修复前失败测试或需求测试：以用户截图为基线，验证无更新首屏不显示 OTA/全量平铺卡片和安全基座。
- iOS / Android：`pnpm check` 通过；Android 测试包验证升级中心核心布局和首页去除安全基座。完整 Gradle release 仍受本机 Maven 依赖限制。
- 灰度指标与停止条件：若更新入口不可达、强更状态误隐藏或图标字体未加载则停止发布。
- 回滚：回退首页、升级中心和 AppIcon 变更；无数据迁移。
