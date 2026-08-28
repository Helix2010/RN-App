# Bugfix: ota-immediate-silent-check

状态：Implemented

## 用户场景与现状证据

- 用户/角色：已安装 AnyFun APK 的终端用户。
- 当前行为或复现：管理端选择“立即重启”后，App 仍显示“下次启动生效”；升级检查需要用户手动进入升级中心。第一次修复 OTA 后，页面还出现 `1.0.0 / development / embedded`，原因是 OTA Manifest 覆盖了 `Constants.expoConfig`，旧 OTA 没有携带 API 与客户端身份。
- 代码调用链：`FoundationRuntimeProvider` → `checkAndDownloadOta` → `expo-updates`；策略来自服务端 Bootstrap 与 OTA Manifest。
- 非目标：不改变 Native ABI、APK 全量升级、EAS 账户托管或服务端 OTA 发布状态机。

## Given / When / Then

1. Given 服务端 OTA 策略为 `immediate`，When OTA 资源下载完成，Then App 展示不可跳过的全屏确认层，用户必须确认后才重启应用。
2. Given 服务端 OTA 策略为 `next_launch`，When OTA 资源下载完成，Then App 不打断当前操作，并在下次启动时应用。
3. Given App 启动完成或从后台回到前台，When Bootstrap 策略允许 OTA，Then App 在后台静默检查；失败不阻塞用户使用。
4. Given 原生 Manifest 丢失自定义 metadata，When Bootstrap 返回 `immediate`，Then 仍按 `immediate` 展示确认层。
5. Given OTA Bundle 已切换 `Constants.expoConfig`，When App 发起 Bootstrap，Then 使用 OTA Manifest 携带的固定 API、渠道、应用身份、版本和 Build，不回退到 localhost/development/1.0.0。

## UI 与交互状态

- loading / empty / content：升级中心继续展示检查中、当前版本、已下载和当前状态。
- error / timeout / offline：静默检查失败仅记录错误状态和遥测；手动进入升级中心可再次检查。
- 重复提交 / 取消 / 返回：检查请求全局合并；立即重启确认层不可关闭、不可稍后处理，Android 返回键被拦截；重启失败保留确认层并允许重试。
- light / dark / 字体放大 / 无障碍：立即升级使用主题化遮罩和卡片，确认层使用 alert 语义。

## 技术影响

- API/OpenAPI：无新增接口；继续使用 Bootstrap 的 `update.ota.applyStrategy` 与 OTA Manifest metadata。
- 状态与本地数据：内存保存当前检查结果；expo-updates 负责待应用更新持久化。
- 钱包/签名/链/金额精度：
- 权限、隐私与遥测：不新增权限；只记录有限的 updateId/runtime/策略状态。
- OTA 或全量更新：仅 JS/资源逻辑变更，可通过 OTA；不涉及 Native ABI。

## 验证与发布

- 修复前失败测试或需求测试：新增策略优先级、Manifest extra 和实时检查相关测试；`pnpm check` 通过。
- iOS / Android：未运行双端 Development Build；需要真机验证立即重启和后台恢复。
- 灰度指标与停止条件：观察 OTA check 成功率、下载成功率、重启后启动成功率；异常时关闭租户 `otaEnabled`。
- 回滚：服务端将 OTA release 暂停或关闭 `otaEnabled`；App 代码可回退到上一版本。
