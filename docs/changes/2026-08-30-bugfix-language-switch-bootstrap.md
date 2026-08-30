# Bugfix: language-switch-bootstrap

状态：Completed

## 用户场景与现状证据

- 用户/角色：已进入 App 设置页、需要切换显示语言的移动端用户。
- 当前行为或复现：点击另一种语言后偏好立即持久化，Bootstrap Query Key 随即切换；新语言请求失败且没有对应缓存时，当前有效配置被移除，整个导航树被“配置连接失败”门禁替换。
- 追加根因证据：`1.1.9` Smoke APK 的 `assets/fingerprint` 末尾包含换行，`Updates.runtimeVersion` 原样进入 `X-Runtime-Version`，Android `NativeRequest` 拒绝 Header 中的 `0x0a`，最终被包装为 `The service is unreachable`。
- 代码调用链：`LanguageSettingsScreen -> preferences.setLocale -> FoundationRuntimeProvider -> useBootstrap(locale) -> loadBootstrap -> apiClient`。
- 非目标：不修改服务端语言表、语言包生成规则或 Bootstrap OpenAPI；不使用内置文案/localhost 掩盖远程配置错误。

## Given / When / Then

1. Given 当前语言配置有效，When 用户选择另一语言且新语言 Bootstrap 可用，Then 先完成校验和缓存，再原子提交语言偏好，页面不进入全局门禁。
2. Given 当前语言配置有效，When 新语言 Bootstrap 请求失败，Then 保留当前语言、当前配置和当前页面，并在语言页就近展示可重试错误。
3. Given 发布包没有有效 `apiBaseUrl`，When 发起配置请求，Then 明确返回构建配置错误，不得静默请求 `localhost:3000`。

## UI 与交互状态

- loading / empty / content：切换中的语言行显示处理中状态，其余行暂时不可重复选择；成功后选中态和页面文案一起更新。
- error / timeout / offline：保留当前内容，在语言列表下方显示错误卡片；再次点击目标语言即可重试。
- 重复提交 / 取消 / 返回：进行中忽略重复提交；返回仍保留已验证的旧偏好。
- light / dark / 字体放大 / 无障碍：沿用设计系统令牌；单选行继续暴露 radio/selected/disabled 状态，错误信息使用 alert。

## 技术影响

- API/OpenAPI：无接口变更，继续请求 `/v1/mobile/bootstrap?locale=<BCP47>`。
- 状态与本地数据：语言偏好从“先写后校验”调整为“先 stage Bootstrap、成功后 commit”；不同语言缓存仍按域名、应用身份和语言隔离。
- 钱包/签名/链/金额精度：无影响。
- 权限、隐私与遥测：不新增权限；错误提示不展示 token、完整响应或敏感数据。
- OTA 或全量更新：语言切换事务可通过 OTA；移除已构建 Bundle 中的 localhost 静默回退同样属于 JS 逻辑，但正式验证应重新构建 APK，确认 embedded config 可读。

## 验证与发布

- 修复前失败测试或需求测试：已新增“stage 失败不得 commit 偏好”“缺少 API URL 不得回退 localhost”和“runtimeVersion 去除尾部空白”测试并通过。
- iOS / Android：`pnpm check` 通过（50 tests）；Android production Bundle 导出通过；使用修复后的测试签名 APK 在 `emulator-5554` 完成冷启动、进入设置、中文 -> English -> 简体中文切换验证，无配置门禁、Header 换行或原生崩溃。未执行 iOS 原生构建、Android Gradle APK assemble 与真机语言切换 E2E。
- 灰度指标与停止条件：关注 Bootstrap `incompatible_response/network/timeout` 与语言切换失败率；若出现语言偏好与 selectedLocale 不一致则停止发布。
- 回滚：回滚本变更提交；不会迁移或删除已有用户偏好和语言缓存。
