# 预测市场一级"更多"改为轮播溢出；预测市场移除 Mock 依赖（2026-09-10）

- 类型：feat + refactor · 模块：predict（仍受 `modules.predict` 开关约束）· 提交：cd0e77f · 发布：1.2.11 基线 OTA rev 11 `ota_iFLj3wXFITO8Jom6Crwv1A`（updateId `ab28688e-17da-4ff0-8cfb-d10f4dd723ff`，immediate，2026-09-10）
- 设计：`docs/design/predict-home-filters-2026-09-09.md` §10（修订记录）

## 需求

1. 一级分类的"更多"与一级同源，只用平台轮播标签 `GET /tags?is_carousel=true&order=carousel_sort&ascending=true`；二级仍走 `/tags/{id}/related-tags/tags`。轮播标签多时前几个内联，其余进"更多"。
2. 预测市场严禁使用 Mock 数据；DEX 尚未接入，允许继续用 Mock。

## 根因 / 现状

- 第一版"更多"拉标签全集（188 个，其中 175 个不在轮播），与网页版不一致，且多数标签没有活跃事件、混有运营标签。
- 13 个轮播标签全部内联时行长 3–5 屏，末尾的"更多"实际不可见。
- 预测业务数据本就来自真实平台，但界面倒计时依赖 `core/mock` 的 `mockNow()`（偏移量持久化在 AsyncStorage），网关装配写死 `mode: "mock"`，没有防回退护栏。

## 变更

| 层 | 文件 | 说明 |
| --- | --- | --- |
| 模型 | `features/predict/model/filter-state.ts` | `PRIMARY_INLINE_LIMIT = 8`、`splitPrimaryTags`（≤ 9 全部内联；否则前 8 内联、其余溢出，保持 carousel_sort） |
| 平台 / 网关 | `core/predict-platform/gamma.ts`、`api/gateway.ts`、`api/http-predict-gateway.ts`、`api/mock-predict-gateway.ts`、`hooks/use-predict.ts` | 删 `fetchAllTags` / `listAllTags` / `usePredictAllTags`；新增 `fetchTag` / `getTag(id)` / `usePredictTag`（`/tags/{id}`，只解析深链带来的非轮播一级） |
| 页面 | `ui/market-list-screen.tsx` | 一级行 = 全部 + 行内轮播 + 不在行内的选中项（横滑），"更多 ▾" 钉在行右侧；面板列全部轮播标签、不分组、>20 才有搜索；搜索结果选的标签对象随选择记下 |
| design-system | `filters.tsx` | `PickerSheet` 新增 `searchable` / `grouped`，`badgeLabel` 改为可选 |
| 时钟 | `core/time/clock.ts`、`core/time/use-now.ts` | 生产时钟 `now()` 与渲染 hook `useNow(ticking)`（共用秒表）；`series-card.tsx` 的 `useTicking` / `subscribeTick` 改为转发 |
| 预测界面 | `ui/shared.tsx`、`ui/series-card.tsx`、`ui/settlement-screen.tsx`、`ui/dispute-sheet.tsx`、`foundation/foundation-home-screen.tsx` | 不再引用 `core/mock` |
| 装配 | `core/gateways/gateway-context.tsx`、`test/harness.tsx` | 删 `mode` 字段；注释改为"预测接真实平台，仅 DEX 为 Mock" |
| 护栏 | `features/predict/mock-boundary.spec.ts`、`eslint.config.mjs` | 静态扫描 + `no-restricted-imports`：预测生产代码禁引 Mock 网关 / 夹具 / `core/mock` |
| 测试基座 | `test/clock.ts`、`test/setup.ts`、`ui/series-screen.spec.tsx`、`api/mock-predict-gateway.spec.ts` | `Date.now` 锚定夹具日期；快进用 `travelTestClock` |
| 文案 | `fallback-config.ts` → seed 1105 键 | 删未再使用的 `predict.filter.common`（"常用"） |

## 验证

- `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm i18n:check` 全绿（112 套件 / 782 用例）。
- 新增用例：9 个轮播标签全部内联且无"更多"；14 个时前 8 内联、`culture` 起进面板、选中 `oil` 后插到行尾；`splitPrimaryTags` 边界；`getTag` 成功 / 未知 id；预测 Mock 边界静态检查。
- 发布前：用同一提交构建 release APK 装到模拟器 rwa_test2 核对——一级行 `All / Politics / Crypto / Football …` 横滑到 Cybersecurity 止（8 个），"More ▾" 首屏可见且钉住；面板"All categories · 13"按运营顺序平铺、无搜索框；选 Machine Learning 后以选中态钉在 More 左侧并出现其二级（Blockchain / Data Encryption …）与空分类卡；切 Crypto 二级 5M/15M/1h/4h/Daily 与周期市场秒级倒计时正常；滚动后悬浮条同样钉住 More。首轮核对发现"选中项插到行尾会被横滑遮住"，改为钉住后重建复核。
- 独立 code review（无阻断项）采纳：`useNow` 改用 `useSyncExternalStore`（面板打开首帧即取新时间）；`closesText` 改由调用方传 `now`；`usePredictTag` 等轮播加载完再判断；Mock 边界检查支持多行 import；ESLint pattern 用 `**`；面板计数加载中不显示 0。
- 发布后：见下方"发布记录"。

## 发布记录

- OTA rev 11 `ota_iFLj3wXFITO8Jom6Crwv1A`（1.2.11 基线 `rel_xGci1cDn1HXUsVUyv7Yguw`，immediate，源码 cd0e77f）：上传 PUT 200 → SAVE 201（verified）→ PUBLISH 201（active）；线上 manifest 已返回该 updateId 与 sourceCommitSha。

## 非目标

- DEX 仍为 Mock（未接入）。
- 钱包页夹具估值价、生产租户预测链为测试网：另行决策。
