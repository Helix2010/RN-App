# Feature: theme-ui-sync

状态：Implemented（代码与自动化验证完成；真机视觉验收未运行）

## 用户场景与验收条件

- 管理员在“品牌与外观 → 主题”查看 Light / Dark 主题时，看到与 App 首页语义令牌对应的手机 UI 预览。
- 管理员打开“编辑主题”后，修改任一颜色，侧板中的手机 UI 立即反映草稿颜色；颜色选择器与文本值保持双向同步。
- 保存后，主题仍写入现有 `mobile-bootstrap.theme.light/dark`，App 下次刷新 bootstrap 后由 Tamagui 使用新颜色。
- App 外观设置页的 Light / Dark 小预览和涨跌颜色示例读取当前 bootstrap palette，不再使用固定演示色。

## 现状与关键决策

- 现有服务端主题契约已经包含 Light / Dark 17 个语义令牌，RN-App `FoundationThemeProvider` 已按该配置创建 Tamagui 主题。
- 管理端原有完整主题工作台已能预览首页，但“品牌与外观”页签只显示摘要；本次复用同一 `ThemePreview`，不新增接口或第二份主题事实源。
- `rgba(...)` 等合法颜色继续使用文本输入和色块展示；标准六位十六进制颜色额外提供原生颜色选择器。

## 技术影响

- API/OpenAPI：无变更，继续使用 `/v1/admin/app-config` 与 `/v1/mobile/bootstrap`。
- 数据与持久化：无新增表、键或迁移。
- 原生/OTA：无原生 ABI、权限或构建配置变化；主题 JS 与服务端配置可按现有 OTA / bootstrap 流程发布。

## 改动文件

- `src/features/settings/appearance-settings-screen.tsx`
- `src/features/settings/settings-screen.spec.tsx`
- `src/design-system/controls.tsx`
- RN-Admin `src/modules/app-config/branding-page.tsx`
- RN-Admin `src/modules/app-config/pages.tsx`
- RN-Admin `src/design-system/tokens.css`

后续同一页面增强：应用身份页签改为逐项展示当前应用名、Scheme、配置服务地址、图标底色、Android 包名和签名证书 SHA-256，不再只显示两个摘要卡片。

## 验证

- RN-App：`pnpm format:check`、`pnpm lint`、`pnpm typecheck`、主题相关 Jest 与设置页测试通过；`pnpm api:check`、`pnpm config:check`、`pnpm i18n:check` 通过。
- RN-Admin：TypeScript、ESLint、主题工作台/品牌页 Vitest 通过（2 个文件 15 tests；全量 25 files / 214 tests 通过）。
- RN-App 全量 Jest 未作为通过项记录：仓库既有 `series-screen` 日期分组失败、OTA signing key shell 测试失败，后续全量运行还出现 Jest SIGSEGV；这些与本次主题改动无关。
- iOS / Android Development Build、真机截图和生产 bootstrap 数据未运行，不能据此宣称双端视觉验收或线上颜色已生效。

## 回滚

恢复以上 App / Admin 文件即可；服务端配置结构不变，无数据库回滚步骤。若已保存新主题，管理端将上一版 `theme.light/dark` JSON 保存回 `mobile-bootstrap` 即可。
