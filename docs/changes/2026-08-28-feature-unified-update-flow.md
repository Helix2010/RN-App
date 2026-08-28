# Feature: unified-update-flow

状态：Implemented

## 用户场景与现状证据

- 用户/角色：Android direct APK 用户。
- 当前行为或复现：版本检查仅提供 OTA/全量两个分散入口；打开新 APK 后仍可能因为 OTA 覆盖配置而显示旧版本。
- 代码调用链：Bootstrap → 原生 APK 版本 → 全量 APK 下载/安装器；仅当 APK 已最新时才进入 Expo Updates OTA 检查。
- 非目标：不实现系统级静默安装；普通 Android 应用仍需系统安装器最终确认。

## Given / When / Then

1. Given active APK 高于当前原生版本，When 用户检查更新，Then 弹出一个下载进度层，下载完成后自动打开系统 APK 安装器。
2. Given APK 已最新且存在兼容 OTA，When 用户检查更新，Then 只检查 OTA，不展示第二个全量更新按钮。
3. Given OTA immediate，When 下载完成，Then 展示不可跳过的重启确认层。
4. Given OTA next_launch，When 下载完成，Then 下次启动应用时应用更新。
5. Given OTA 覆盖 `Constants.expoConfig`，When App 读取版本，Then 以原生 APK 版本和 Build 为事实源。

## UI 与交互状态

- loading / empty / content：统一检查按钮；APK 下载层显示百分比、已下载大小和总大小。
- error / timeout / offline：下载失败保留错误层并提供重新下载；OTA 失败不阻塞应用。
- 重复提交 / 取消 / 返回：检查和下载请求合并；下载期间阻止重复触发。
- light / dark / 字体放大 / 无障碍：升级层使用主题令牌和 alert 语义；立即重启层拦截 Android 返回键。

## 技术影响

- API/OpenAPI：无新增服务端接口；使用 Bootstrap full actionUrl/size/sha256 和 OTA 现有协议。
- 状态与本地数据：原生版本来自 `expo-application`；APK 临时文件存放在 App cache 目录。
- 钱包/签名/链/金额精度：
- 权限、隐私与遥测：新增 `expo-application`、`expo-file-system`、`expo-intent-launcher` 原生依赖；无新敏感数据。
- OTA 或全量更新：依赖原生安装器属于全量更新；JS 检查逻辑可继续通过 OTA 分发。

## 验证与发布

- 修复前失败测试或需求测试：`pnpm check` 通过；新增 APK 下载/安装服务路径。
- iOS / Android：Android release 构建需在依赖变更后完成；iOS 未实现 APK 安装路径。
- 灰度指标与停止条件：观察 Bootstrap 成功率、APK 下载成功率、安装器打开率和安装后版本回报；异常时关闭全量更新入口。
- 回滚：服务端暂停 APK release 或关闭 directUpdateEnabled；客户端回退到上一完整 APK。
