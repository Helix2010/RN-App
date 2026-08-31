# 平台收尾：预测式返回、i18n seed 导出、租户 Logo

- 状态：In Progress
- 日期：2026-08-31
- 依据：`UI/docs/interaction-spec.md` §0 技术基线；`UI/docs/rn-implementation-plan.md` §7.2（品牌资源来自租户服务端）、§6（i18n seed 单一事实源）

## Given / When / Then

- Given Android 13+ When 从 App 壳内的模块 Tab 边缘返回 Then 使用受控的左右边缘 `PanResponder` 返回到首页；Stack 推入页继续由 React Navigation 处理系统返回，根首页不退出应用。
- Given 开发者新增或修改内嵌文案 When 运行 `pnpm i18n:seed` Then 从 `fallback-config.ts` 导出 `i18n/seed/zh-CN.json` / `en-US.json`（`{ languageCode, version: "seed", messages }`，键排序）；`pnpm check` 含 `i18n:check`，两张表键集合不一致或导出过期即失败。RN-Server 初始化 `language_document` 时以该文件为种子（服务端字典仍优先于内嵌字典）。
- Given 租户服务端下发 branding.launch.visuals.logo When 打开关于页 Then `BrandMark` 使用该 logo（与启动页同一资源，`useTenantLogoUri()` 按当前主题解析并优先本地缓存）；未下发时退回内置几何标。

## 技术影响

- `app.config.ts`：`predictiveBackGestureEnabled: false`，避免 Android predictive back 绕过 App 壳的 JS 返回状态（需重建原生包）。
- `src/navigation/edge-back-gesture.ts`：恢复左右边缘手势，仅在水平内滑超过阈值时触发。
- 恢复 `src/navigation/edge-back-gesture.ts` 及其测试，覆盖左右边缘、反向和垂直手势。
- 新增 `scripts/export-i18n-seed.mjs`、`i18n/seed/*.json`、`pnpm i18n:seed` / `i18n:check`。
- `BrandMark` 增加 `uri` 属性；`src/app/use-tenant-logo.ts`。

## 验证与发布

- `pnpm check`（含 i18n:check）见提交记录。
- Android 手势行为需以本次回归修复后的模拟器验证为准；上一版 `enableOnBackInvokedCallback="true"` 的验证结果不再适用。
- `pnpm check` 全绿（jest 20 套件 81 例 + `i18n seed: 760 keys × 2 locales (check ok)`）。
- 未做：RN-Server 侧导入 seed 的迁移（该仓库提交即自动部署，按约定不在本轮改动）；桌面图标由打包脚本从 branding 导出（待租户工厂）。
