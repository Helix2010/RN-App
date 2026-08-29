# Feature: update-confirmation-and-edge-back

状态：Completed

## 用户场景与现状证据

- 用户/角色：使用 direct APK 的 DEX/Web3 用户，可能通过系统通知或 App 内检查触发升级。
- 当前行为或复现：Android 根页面边缘返回会退出 App；收到 `app_update_available` 后只导航到升级中心，没有先确认；升级中心默认暴露 Runtime、Release ID、诊断等非核心信息。
- 代码调用链：`installation-service -> RuntimeContext.notificationIntent -> UpdateCenterScreen`；全量下载由 `apk-update-service` 完成；OTA 由 `expo-updates` 完成。
- 非目标：不改变 Android Package Installer 的系统确认，不绕过未知来源授权；不实现自定义系统级预测返回动画。

## Given / When / Then

1. Given AppShell 在首页，When 用户从左右系统边缘返回，Then 不退出到后台；在资产/个人中心先回首页。
2. Given 收到 `app_update_available`，When Bootstrap 返回可用 APK，Then 先展示升级确认层，用户确认后才开始下载并显示进度，完成后打开系统安装器。
3. Given OTA 已后台下载，When `applyStrategy=immediate`，Then 显示强制重启确认；`next_launch` 不打断当前使用。
4. Given 用户打开升级中心，When 页面加载，Then 默认展示当前版本、最新版本、状态和主操作；Runtime、Release、诊断等放入详情。

## UI 与交互状态

- loading / empty / content：APK 下载使用全屏进度层；OTA 使用状态文本和策略提示；详情默认收起。
- error / timeout / offline：下载失败保留重试入口；刷新失败不开始下载；升级确认层可取消可重试。
- 重复提交 / 取消 / 返回：确认期间禁止重复操作；AppShell 返回监听仅在焦点页面生效；Native Stack 开启左右全屏手势。
- light / dark / 字体放大 / 无障碍：确认层和进度层使用语义 token；按钮有清晰 role/label；核心文案支持换行。

## 技术影响

- API/OpenAPI：无接口变更；使用现有 Bootstrap `update.full`、`update.ota` 和推送事件。
- 状态与本地数据：仅增加页面临时确认状态，不复制服务端版本事实源。
- 钱包/签名/链/金额精度：无影响。
- 权限、隐私与遥测：不新增权限；保留既有升级阶段遥测。
- OTA 或全量更新：页面、确认和边缘手势逻辑可 OTA；Native Stack 行为使用已存在原生能力。

## 验证与发布

- 修复前失败测试或需求测试：增加推送事件进入确认层、下载前不触发网络下载、详情默认收起和 AppShell 返回行为测试。
- iOS / Android：已运行 `pnpm check`；Android 最新源码 Bundle 已成功生成。完整 APK 原生 assemble 在本机 Gradle/Kotlin 阶段长时间无输出，未将旧 APK 误作本次构建结果；真实双向边缘手势仍需真机确认。
- 灰度指标与停止条件：观察 APK 确认率、下载失败率、安装器打开率、OTA 重启失败和退出后台异常。
- 回滚：回退 App commit；服务端无需迁移或回滚。
