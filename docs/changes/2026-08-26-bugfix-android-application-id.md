# Bugfix: application-identity

状态：Ready for review

## 用户场景与现状证据

- 用户/角色：需要构建并分发 RN Foundation 安装包的项目维护者。
- 当前行为或复现：Expo Android 与 iOS 配置使用示例身份，与 AnyFun 项目正式包名不一致。
- 代码调用链：`app.config.ts` 的 `android.package` / `ios.bundleIdentifier` → Expo prebuild/EAS 原生工程身份 → APK/IPA 安装与升级校验。
- 非目标：不调整逻辑应用身份 `EXPO_PUBLIC_APPLICATION_ID`、API 契约、服务端租户配置或已发布 APK。

## Given / When / Then

1. Given AnyFun 构建配置 When 运行 Expo 配置解析 Then Android `package` 与 iOS `bundleIdentifier` 均为 `com.anyfun.foundation`。
2. Given 新原生身份 When 生成新的 Android/iOS 构建 Then 原生应用身份为 `com.anyfun.foundation`，并标记为全量更新。
3. Given 使用示例身份构建的旧包 When 安装新包 Then 不视为同一应用，不能覆盖升级；旧包需卸载后安装新包。

## UI 与交互状态

- loading / empty / content：不涉及页面运行时状态。
- error / timeout / offline：不涉及网络请求。
- 重复提交 / 取消 / 返回：不涉及交互。
- light / dark / 字体放大 / 无障碍：不涉及 UI。

## 技术影响

- API/OpenAPI：无变更。
- 状态与本地数据：应用安装身份变化，本地安全存储、缓存和 Android 系统数据不与旧包共享。
- 钱包/签名/链/金额精度：无变更。
- 权限、隐私与遥测：Android/iOS 原生身份和遥测应用维度随构建更新。
- OTA 或全量更新：必须全量构建；原生 applicationId/bundle identifier 变化禁止 OTA。

## 验证与发布

- 修复前失败测试或需求测试：配置解析应暴露旧 package，修复后应返回新 package。
- iOS / Android：执行 Expo 配置检查；实际 iOS/Android Development Build 需在具备原生构建环境时完成。
- 灰度指标与停止条件：首个新包先作为内部测试包；发现安装/启动异常立即停止分发。
- 回滚：回退代码配置并重新构建旧包；已安装的新包不能通过 OTA 降回旧原生身份。
