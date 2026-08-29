# Bugfix: tenant-branding-launch-assets

状态：In progress

## 用户场景与现状证据

- 用户/角色：安装租户 direct APK、使用系统深色主题的移动端用户。
- 当前行为或复现：Bootstrap 返回的 light 主题包含租户 logo 和启动背景，dark 只有背景色；App 严格按当前主题取资源，并且只显示已落盘的 `localFileUrl`，首次启动继续显示内置 BrandMark。
- 代码调用链：`bootstrap.branding -> FoundationRuntimeProvider -> warmBrandingAssets/hydrateCachedBranding -> LaunchScreen`。
- 非目标：本次不动态修改 Android launcher icon；系统桌面图标仍属于原生安装包能力。

## Given / When / Then

1. Given 当前主题未单独配置图片，When 另一个主题存在租户 logo/启动背景，Then 复用租户图片但保留当前主题背景色。
2. Given 首次安装尚无本地缓存，When Bootstrap 返回有效租户资源，Then 开屏可直接加载租户 HTTPS 图片，同时后台下载、校验并缓存。
3. Given 缓存已通过大小和 SHA-256 校验，When 再次启动，Then 优先使用本地文件并清理过期旧版本。

## UI 与交互状态

- loading / empty / content：远程配置成功后在既有开屏时长内显示租户资源。
- error / timeout / offline：远程图片失败时仅开屏图片降级，不绕过 Bootstrap 启动门禁；后续重启使用已校验缓存。
- 重复提交 / 取消 / 返回：资源以 assetId 去重，沿用串行缓存和幂等清理。
- light / dark / 字体放大 / 无障碍：两个主题都能得到租户图片；标题继续作为图片无障碍标签。

## 技术影响

- API/OpenAPI：字段不变；继续支持相对 `fileUrl`，客户端按当前租户 API origin 解析。
- 状态与本地数据：品牌缓存继续按 API 域名和 applicationId 隔离。
- 钱包/签名/链/金额精度：无影响。
- 权限、隐私与遥测：无新增权限或敏感信息。
- OTA 或全量更新：纯 JS 与服务端解析修复，可通过 OTA 交付，不涉及原生 ABI。

## 验证与发布

- 修复前失败测试或需求测试：新增跨主题资源继承和租户相对 URL 解析测试。
- iOS / Android：运行 `pnpm check`；真机需验证首次启动远程图片与第二次启动本地缓存。
- 灰度指标与停止条件：观察品牌资源下载失败、SHA 不匹配和启动超时。
- 回滚：恢复 LaunchScreen 仅本地文件策略和严格主题资源选择；无需数据迁移。
