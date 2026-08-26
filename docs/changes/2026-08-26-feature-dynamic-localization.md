# Feature: dynamic-localization

状态：Implemented

## 用户场景与现状证据

- 用户/角色：租户管理员、RN-App 用户。
- 当前行为或复现：管理端语言固定为两列，服务端语言与文案绑定在 mobile-bootstrap，无法动态增加语言或发布租户语言包。
- 代码调用链：RN-Admin Localization 页面 → RN-Server localization APIs → app_configs/language_document/MySQL → S3 JSON → RN-App bootstrap/resource cache。
- 非目标：运行时兼容 `zh_CN`、灰度语言发布、RBAC、双人审批、后台精确定时任务。

## Given / When / Then

1. Given 数据库语言配置使用标准 BCP 47 When 管理端新增 `ja-JP` Then 页面自动出现日语列，服务端不接受 `ja_JP`。
2. Given 租户没有覆盖 When 读取语言配置 Then 使用全局配置；租户只修改某个字段时只保存差异覆盖。
3. Given 租户编辑继承文案 When 保存 Then 写入当前租户 `language_document`，全局文案不被修改。
4. Given 语言发布 When 对象存储上传成功 Then 生成稳定排序的完整 JSON、SHA-256 和资源元数据；失败继续使用上一版本。
5. Given App 启动或回到前台 When 远程语言资源版本更新 Then 校验结构、语言编码、大小与 SHA-256 后原子替换缓存。

## UI 与交互状态

- loading / empty / content：管理端分别展示加载、空文案和动态语言表格。
- error / timeout / offline：API 错误可重试；发布失败保留草稿；App 使用旧缓存或内置包。
- 重复提交 / 取消 / 返回：保存、发布使用确认框和服务端版本 compare-and-swap。
- light / dark / 字体放大 / 无障碍：复用现有管理端设计系统；语言列支持横向滚动。

## 技术影响

- API/OpenAPI：新增管理端 Localization APIs 与移动端语言资源接口，已同步 OpenAPI。
- 状态与本地数据：RN-App 使用 bootstrap 缓存和独立语言包缓存，缓存按域名、应用身份、语言隔离。
- 钱包/签名/链/金额精度：
- 权限、隐私与遥测：不新增权限，不记录文案内容到日志；操作写审计。
- OTA 或全量更新：语言资源不改变原生 ABI，可独立远程刷新；`expo-crypto` 原生依赖首次需要全量 Development Build。

## 验证与发布

- 修复前失败测试或需求测试：新增服务端语言合并与非法下划线编码测试；RN-App 现有 schema/repository 测试通过。
- iOS / Android：未运行真实双端 Development Build。
- 灰度指标与停止条件：首期不做语言灰度；发布失败、资源校验失败即停止替换。
- 回滚：保留上一成功 S3 资源；App 校验失败自动回退旧缓存/内置包；数据库迁移为开发阶段向前迁移。
