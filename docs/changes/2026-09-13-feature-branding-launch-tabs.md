# Feature: branding-launch-tabs

状态：Implemented

## 用户场景与现状证据

- 用户/角色：管理端租户管理员；移动端首次启动用户。
- 当前行为或复现：管理端“品牌与启动”页把启动页品牌编辑和启动图标长列表连续展示，刷新后没有明确恢复的页签语义；App 的 `LaunchScreen` 在背景图可用时隐藏 Logo 与标题，导致 Logo 与开屏图不是叠加关系。
- 代码调用链：RN-Admin `BrandingPage -> LauncherIconsSection/SidePanel`；RN-App `runtime-context -> LaunchScreen -> brandingAssetUrl`。
- 非目标：不新增品牌字段、不改变上传接口、不修改 Android/iOS 原生桌面图标生成链路，也不把背景图内嵌 Logo 自动识别为独立 Logo。

## Given / When / Then

1. Given 管理员打开“品牌与外观”，When 选择“启动页”“启动图标”“主题”或“应用身份”页签，Then 只展示对应区域，页签通过 URL 查询参数保存，刷新页面后恢复已选择页签。
2. Given 启动页同时配置 Logo 和背景图，When App 或管理端预览启动页，Then 背景图作为底层，Logo、标题和状态文案作为上层同时可见。
3. Given 背景图加载失败，When App 进入启动页，Then 背景层消失但 Logo/标题/状态文案仍按配置显示；Logo 加载失败不影响背景图。
4. Given 背景图本身包含品牌标识，When 管理员预览或上传，Then 页面提示背景图应使用纯视觉背景，避免与独立 Logo 重复；不由客户端猜测或自动去重。

## UI 与交互状态

- loading / empty / content：保留现有查询 loading、error、empty；页签切换只改变内容区，不重复请求。
- error / timeout / offline：保留现有品牌资源错误提示；启动页图片失败独立记录并继续显示可用层。
- 重复提交 / 取消 / 返回：页签切换不丢失 SidePanel 草稿；URL 使用 replaceState，不新增无意义历史记录。
- light / dark / 字体放大 / 无障碍：预览增加背景层、遮罩层和内容层；页签暴露 `role=tab`/`aria-selected`，移动端启动页内容仍保持可读。

## 技术影响

- API/OpenAPI：无变更，继续使用现有 branding 与 build-icons 契约。
- 状态与本地数据：
- 钱包/签名/链/金额精度：
- 权限、隐私与遥测：
- OTA 或全量更新：启动页 JS/CSS 与远程资源预览可 OTA；不涉及原生 ABI 或系统桌面图标，桌面图标资源仍需全量包。

## 验证与发布

- 修复前失败测试或需求测试：更新 `LaunchScreen` 组件测试，新增背景图与 Logo 同时渲染、各自失败独立处理；新增管理端页签 URL 解析/写回测试。
- iOS / Android：
- 灰度指标与停止条件：
- 回滚：恢复管理端连续区块展示和 App 互斥显示逻辑即可；接口和数据无需迁移。

## 实施记录

- App：`LaunchScreen` 使用背景图、遮罩、Logo/标题/状态内容三层结构，图片失败彼此独立处理。
- Admin：品牌页增加“启动页 / 启动图标”页签，启动页预览与图标预览并列为页面主体；当前页签写入 `?tab=launch|icons` 并支持刷新/浏览器导航恢复。
- Admin：品牌页扩展为“启动页 / 启动图标 / 主题 / 应用身份”四个 Tab；主题与应用身份只提供统一入口和摘要，编辑仍跳转原有配置中心或 Android 打包与签名页，避免复制事实源。
- Admin：侧栏将应用配置与钱包资产归入“应用体验”，发布管理与打包配置归入“发布中心”；钱包资产中的代币入口改名为“代币目录”，原路由保持不变。
- 契约：未新增 API、字段、数据库表或原生能力。
- 验证：RN-Admin `pnpm check` 通过；RN-App 启动页专项测试、格式、Lint、类型通过。RN-App 全量测试仍有仓库既有的 OTA/keystore 脚本环境变量失败和预测日期分组失败，详见交付说明。
