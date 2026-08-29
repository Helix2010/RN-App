# Feature: remote-branding-launch

状态：In progress

## 用户场景与现状证据

- 管理员需要按租户配置启动页 Logo、背景、动画和多语言文案，App 通过请求域名解析租户后获取。
- RN-App 当前已有 JS 层 `LaunchScreen`、远程 bootstrap、主题和动态语言缓存，但启动视觉仍由代码和 APK 内置资源决定。
- RN-Admin 的 APK 发布说明已经按 `/v1/admin/localization` 动态生成语言 Tab；OTA 表单仍有写死 `zh-CN` 的路径，需要统一。
- 原生启动屏和系统桌面图标发生在 JS/网络启动之前或由系统资源管理，不能承诺任意远程文件直接替换。

## 验收条件（Given / When / Then）

1. Given 冷启动无网络，When App 尚未拿到 bootstrap，Then 先显示 APK 内置原生/JS 保底品牌页，不阻塞进入可用状态。
2. Given bootstrap 返回新的 branding 版本，When 资源下载、大小和 SHA-256 校验成功，Then 原子写入本地缓存，并在下一次启动使用新资源。
3. Given 启动资源下载失败或损坏，When App 进入首页，Then 继续使用当前有效缓存或 APK 内置资源，且不进入更新阻塞。
4. Given 管理端语言配置新增、停用或调整排序，When 打开品牌编辑器，Then 语言 Tab 与 APK 发布表单保持一致，不能出现固定 `zh-CN/en-US` 类型。
5. Given 管理员只上传资源但未保存/发布，When App 请求 bootstrap，Then 仍返回上一版生效资源，不产生脏配置。
6. Given 管理员发布品牌配置，When 租户域名请求 bootstrap，Then 只返回当前租户按语言/主题解析后的资源，未覆盖字段继承全局配置。
7. Given App 清理资源，When 新资源已成功激活，Then 至少保留当前版本、上一有效版本和 APK 内置兜底，不删除 S3 正在引用的对象。
8. Given 管理员配置 App 图标，When 不重新构建 APK，Then 只更新 App 内 Logo/品牌标识；系统桌面图标仍明确标注需要全量包。

## 页面状态与交互

- 管理端品牌页沿用侧边编辑、上传即开始、进度、失败重试、保存草稿、填写原因、确认发布的规范。
- 语言列表来自有效全局/租户 `app_configs.languages`，按 `sort` 排序；默认语言必填，其余语言可选，覆盖资源默认继承公共资源。
- App 启动资源状态：embedded、cached、checking、downloading、ready、degraded；下载在后台进行，不在普通网络失败时阻塞首页。

## 配置与数据契约

- 新增 `app_configs.config_key='branding'`，配置值只保存小型 JSON 和不可变 asset 引用，不存图片二进制。
- 上传会话增加 `uploadType='branding'` 和 `assetType/locale/theme` 元数据；服务端校验 MIME、文件大小、图像尺寸和 SHA-256。
- 资源通过租户域名下的受控移动端资源接口读取，客户端按 `apiBaseUrl/applicationId/locale/theme/assetId` 隔离缓存。
- 文案仍由 `language_document` 作为唯一事实源，branding 只引用 `launch.title`、`launch.subtitle` 等 Key。

## OTA / 全量更新边界

- 启动页 JS、远程图片、动画预设和文案可通过 bootstrap/资源接口更新，不需要 OTA。
- 原生启动屏、Android Adaptive Icon、iOS/Android 系统桌面图标、原生权限和原生模块必须通过全量 APK/IPA/MDM 更新。
- 远程配置只能选择预置动画类型，不能下发任意可执行代码。

## 风险与回滚

- 风险：图片格式/尺寸异常、对象存储不可用、旧客户端不识别新增字段、下载中断导致缓存损坏。
- 防护：Zod/服务端 schema 校验、临时文件 + 原子重命名、哈希校验、上一版本保留、bootstrap 向后兼容。
- 回滚：管理端暂停/恢复上一品牌配置；客户端失败自动回退缓存/内置资源；系统图标只能安装上一全量包。

## 验证计划

- RN-App：`pnpm check`，启动资源仓储单测，Android Development Build 验证缓存、重启和资源回退。
- RN-Server：`gofmt`、`go vet`、`go test -race`、`go build`，包含租户继承、上传校验和移动端响应测试。
- RN-Admin：`pnpm check`，动态语言变化、上传失败不落配置、预览和发布交互测试。

状态：Draft

## 用户场景与现状证据

- 用户/角色：
- 当前行为或复现：
- 代码调用链：
- 非目标：

## Given / When / Then

1. Given ... When ... Then ...

## UI 与交互状态

- loading / empty / content：
- error / timeout / offline：
- 重复提交 / 取消 / 返回：
- light / dark / 字体放大 / 无障碍：

## 技术影响

- API/OpenAPI：
- 状态与本地数据：
- 钱包/签名/链/金额精度：
- 权限、隐私与遥测：
- OTA 或全量更新：

## 验证与发布

- 修复前失败测试或需求测试：
- iOS / Android：
- 灰度指标与停止条件：
- 回滚：
