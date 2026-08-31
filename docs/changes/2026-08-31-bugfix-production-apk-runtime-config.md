# Bugfix: production-apk-runtime-config

状态：Ready for verification

## 用户场景与现状证据

- 用户/角色：安装官网直装 APK 的 Android 用户。
- 当前行为或复现：1.2.1 APK 启动后提示配置连接失败；提取 `assets/app.config` 可见 `apiBaseUrl=http://localhost:3000`、`distributionChannel=development`。
- 代码调用链：本地分两步执行带生产环境的 Expo prebuild、未带环境的 Gradle → `expo-constants:createExpoConfig` 重新生成开发配置 → App Bootstrap 请求本机地址失败。
- 非目标：不恢复内置业务 fallback，不绕过远程 Bootstrap 校验。

## Given / When / Then

1. Given 未提供生产 API 地址 When 执行 Android Release 构建 Then 构建立即失败，禁止回退到 localhost。
2. Given AnyFun 生产环境 When 执行统一构建命令 Then prebuild 与 Gradle 使用同一组环境变量。
3. Given APK 已构建 When 校验嵌入配置 Then API、渠道、应用身份、版本、Build、OTA 与 runtimeVersion 必须全部匹配后才复制产物。

## UI 与交互状态

- loading / empty / content：远程 Bootstrap 成功后进入既有业务页面。
- error / timeout / offline：真实网络失败仍保留阻断页和重新连接，不增加内置业务 fallback。
- 重复提交 / 取消 / 返回：重新连接沿用既有行为。
- light / dark / 字体放大 / 无障碍：不改 UI。

## 技术影响

- API/OpenAPI：不变，目标仍为 `https://api.anyfun.win`。
- 状态与本地数据：清装后无缓存也应能连接远程 Bootstrap。
- 钱包/签名/链/金额精度：不变。
- 权限、隐私与遥测：不变。
- OTA 或全量更新：错误位于 APK 嵌入配置，必须重新发布全量 APK。

## 验证与发布

- 修复前失败测试或需求测试：新增构建环境测试，证明缺失生产 API 时必须失败。
- iOS / Android：重建 Android Release 并提取 APK 内 `assets/app.config` 验证；iOS 不受本次 Android 本地构建命令影响。
- 灰度指标与停止条件：先验证全新安装可获取 Bootstrap，再替换管理端 1.2.1 包。
- 回滚：撤下错误 APK；代码回滚构建脚本与文档变更。
