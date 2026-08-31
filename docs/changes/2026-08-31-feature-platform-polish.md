# 平台收尾：预测式返回、i18n seed 导出、租户 Logo

- 状态：In Progress
- 日期：2026-08-31
- 依据：`UI/docs/interaction-spec.md` §0 技术基线；`UI/docs/rn-implementation-plan.md` §7.2（品牌资源来自租户服务端）、§6（i18n seed 单一事实源）

## Given / When / Then

- Given Android 13+ When 从任意推入页手势返回 Then 使用系统预测式返回（`predictiveBackGestureEnabled: true`），页面栈与系统返回一致；自研 `PanResponder` 边缘手势（`edge-back-gesture.ts`）已删除，语言 / 升级中心 / App 壳不再自行拦截。
- Given 开发者新增或修改内嵌文案 When 运行 `pnpm i18n:seed` Then 从 `fallback-config.ts` 导出 `i18n/seed/zh-CN.json` / `en-US.json`（`{ languageCode, version: "seed", messages }`，键排序）；`pnpm check` 含 `i18n:check`，两张表键集合不一致或导出过期即失败。RN-Server 初始化 `language_document` 时以该文件为种子（服务端字典仍优先于内嵌字典）。
- Given 租户服务端下发 branding.launch.visuals.logo When 打开关于页 Then `BrandMark` 使用该 logo（与启动页同一资源，`useTenantLogoUri()` 按当前主题解析并优先本地缓存）；未下发时退回内置几何标。

## 技术影响

- `app.config.ts`：`predictiveBackGestureEnabled: true`（需重建原生包）。
- 删除 `src/navigation/edge-back-gesture.ts` 及其测试。
- 新增 `scripts/export-i18n-seed.mjs`、`i18n/seed/*.json`、`pnpm i18n:seed` / `i18n:check`。
- `BrandMark` 增加 `uri` 属性；`src/app/use-tenant-logo.ts`。

## 验证与发布

- `pnpm check`（含 i18n:check）见提交记录。
- Android（`rn_smoke`，2026-08-31 02:25，重建 dev client 后）：个人中心从左边缘向右滑 → 系统预测式返回回到首页，无自研拦截；Manifest 已含 `enableOnBackInvokedCallback="true"`。✅ `predictive-back.png`
- `pnpm check` 全绿（jest 20 套件 81 例 + `i18n seed: 760 keys × 2 locales (check ok)`）。
- 未做：RN-Server 侧导入 seed 的迁移（该仓库提交即自动部署，按约定不在本轮改动）；桌面图标由打包脚本从 branding 导出（待租户工厂）。
