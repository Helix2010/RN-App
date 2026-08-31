# Bugfix: edge-back-gesture-regression

状态：Ready for verification

## 用户场景与现状证据

- 用户/角色：Android App 用户。
- 当前行为或复现：最新 1.2.1 包开启 predictive back 后，App 壳 Tab 页面边缘内滑直接退到后台。
- 代码调用链：`app.config.ts` → Android Manifest `enableOnBackInvokedCallback` → `FoundationNavigator`/`AppShellScreen` BackHandler → App 壳 Tab 状态。
- 非目标：不修改服务端、升级接口和业务模块。

## Given / When / Then

1. Given App 壳处于非首页 Tab When 从左侧向右或右侧向左内滑 Then 回到首页且不退出 Activity。
2. Given App 壳处于首页 When 从任一边缘内滑 Then 保持首页，不退到后台。
3. Given 垂直滚动或反向滑动 When 手势结束 Then 不触发返回。
4. Given Stack 推入页 When 使用系统返回或页面边缘返回 Then React Navigation 返回上一级。

## UI 与交互状态

- loading / empty / content：不变。
- error / timeout / offline：不变。
- 重复提交 / 取消 / 返回：边缘手势与硬件返回统一遵守 `resolveAppShellBack` / `resolveSystemBack`。
- light / dark / 字体放大 / 无障碍：不变。

## 技术影响

- API/OpenAPI：不变。
- 状态与本地数据：不变。
- 钱包/签名/链/金额精度：不变。
- 权限、隐私与遥测：不变。
- OTA 或全量更新：修改 Android 原生返回配置，必须全量 APK；修复包递增为 1.2.2 / versionCode 16。

## 验证与发布

- 修复前失败测试或需求测试：恢复左右边缘判定单测并增加根页面不退出回归。
- iOS / Android：Android prebuild、Gradle Release、模拟器安装/启动/手势；iOS 只做编译配置检查。
- 灰度指标与停止条件：先在模拟器验证 App 壳 Tab、Stack 页面和根页，再发布 APK。
- 回滚：回滚本提交并撤回对应全量 APK，不能用 OTA 回滚原生 Manifest。
