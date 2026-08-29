# Feature: app-product-shell

状态：In progress

## 用户场景与现状证据

- 用户/角色：DEX / Web3 App 用户，需要快速查看资产、市场、升级和个人设置。
- 当前行为或复现：当前首页是基座能力演示卡片，没有稳定的主导航、个人中心和分组设置层级。
- 代码调用链：`FoundationRuntimeProvider -> FoundationNavigator -> FoundationHomeScreen / SettingsScreen / UpdateCenterScreen`。
- 非目标：本轮不接入真实钱包登录、交易、行情 WebSocket 或资金操作。

## Given / When / Then

1. Given 用户进入 App，When 配置加载完成，Then 看到首页资产摘要、市场概览和升级入口，并能通过底部导航切换首页、资产、个人中心。
2. Given 用户进入个人中心，When 点击设置，Then 进入分组设置页，可调整语言、主题并查看 APK/OTA/Runtime 版本。
3. Given 主题或语言改变，When 页面重新渲染，Then 所有 Tab、卡片、按钮、空状态和错误状态使用同一套令牌与文案。
4. Given 远程配置失败，When App 启动或刷新，Then 继续使用缓存/内置配置，不出现白屏或无导航页面。

## UI 与交互状态

- loading / empty / content：首页和资产页提供摘要骨架/安全缓存状态；个人中心始终可用。
- error / timeout / offline：沿用 Bootstrap fallback，页面显示轻量离线状态和重试入口。
- 重复提交 / 取消 / 返回：底部导航切换不重复请求；设置修改即时持久化；系统返回保持 Tab 状态。
- light / dark / 字体放大 / 无障碍：所有组件使用语义令牌，Tab 提供选中态和 accessibility label，长文案可换行。

## 技术影响

- API/OpenAPI：继续使用 Bootstrap、更新和远程多语言契约；新增安装心跳与推送 Token 注册接口。
- 状态与本地数据：Tab 为页面本地状态；主题/语言继续由 Zustand 偏好存储；服务端数据不复制到新的全局状态。
- 钱包/签名/链/金额精度：本轮只使用展示数据，不引入签名或链上写操作。
- 权限、隐私与遥测：通知权限按设置页按需申请；安装标识存储在 SecureStore，设备来源只上传客户端 SHA-256，服务端继续 HMAC；不采集 IMEI、广告 ID 或硬件序列号。
- OTA 或全量更新：页面和心跳逻辑可 OTA；`expo-notifications`、`expo-secure-store`、通知权限和原生配置必须通过全量 APK/IPA 交付。

## 验证与发布

- 修复前失败测试或需求测试：新增导航/设置/状态渲染测试，现有 `pnpm check` 作为门禁。
- iOS / Android：需要 Development Build/Release Build 真机验证 FCM/APNs Token、通知权限、静默刷新和系统限制；当前尚未具备供应商凭证，未做真实投递。
- 灰度指标与停止条件：关注注册成功率、心跳成功率、Token 失效率、Outbox 失败率；异常时关闭 `PUSH_DISPATCH_ENABLED` 并保留轮询同步。
- 回滚：关闭推送 Worker、暂停 Outbox 事件，App 继续使用前台/冷启动 Bootstrap；原生依赖通过上一全量包回退。
