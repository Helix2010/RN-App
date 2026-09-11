# Bugfix: predict-featured-skeleton

状态：Shipped（OTA rev 1 已发布）

## 用户场景与现状证据

- 用户/角色：打开"预测"页签的所有用户（首页"热门预测"同一套轮播也受影响）。
- 当前行为或复现：进入预测首页，精选卡片"闪一下"。三个独立成因：
  1. 策展没回来时 `FeaturedSection` 整块 `return null`，数据到了从上方插进来，把下面的列表整体推下去；
  2. `SnapCarousel` 的 `fullWidth` 卡宽要等 `onLayout` 才知道，首帧按默认 `itemWidth={236}` 画，随后撑满，卡片先窄一下再变宽；
  3. `FeaturedCard` 自己再量一次卡宽算 16:9 图高，量到之前用 180 兜底，量到后又改一次高度。
     首页"热门预测"虽然已有骨架，但骨架和内容是两个不同的 `SnapCarousel` 实例，换内容时重新挂载、重新测宽，成因 2 照样发生。
- 代码调用链：`market-list-screen.tsx`（`useCuratedEvents` → `curationZone` → `FeaturedSection`）→ `curation-sections.tsx` → `design-system/components.tsx` 的 `SnapCarousel` / `SnapCarouselItem`；图片走 `predict/ui/shared.tsx` 的 `EventImage`。
- 非目标：榜单（`RankBoards`）与周期市场区不补骨架——它们在折叠线以下，补了只是把首屏铺成一片灰块，弹入看不见；个人中心、安全中心、钱包列表也不补，那几处行高固定、值位已有 `—`，本地数据几毫秒就回来，骨架闪一帧反而更糟。一级标签行同理留在原样。

## Given / When / Then

1. Given 预测首页在全站 · 交易中视图，When 策展请求还没回来，Then 精选位显示与真卡同形的骨架卡（海报 16:9 + 两行标题 + 报价行 + 成交量行），而不是空着等数据插进来。
2. Given 精选骨架已经显示，When 策展返回 ≥2 个 hero，Then 骨架就地换成卡片，轮播不重新挂载、卡宽和图高不再变化。
3. Given 策展返回 0 个 hero，When 渲染完成，Then 精选区整块不出现（骨架也不留）。
4. Given 策展请求失败，When 渲染完成，Then 仍是既有的错误行 + 重试，不走骨架。
5. Given 任意 `fullWidth` 轮播在本次会话里已经量到过内容列宽度，When 另一个同类轮播挂载（骨架换内容、切回页签），Then 第一帧就用最终卡宽。
6. Given 首页"热门预测"，When 事件请求还没回来，Then 骨架卡与真卡使用同一个轮播实例。

## UI 与交互状态

- loading / empty / content：loading = 精选同形骨架 + 列表两块骨架；empty = 精选区不渲染，列表沿用既有空态；content 不变。
- error / timeout / offline：策展失败仍走 `predict-curation-error` 错误行 + 重试，`loading` 传 `false`，不会出现"永久骨架"。
- 重复提交 / 取消 / 返回：无提交路径变化。
- light / dark / 字体放大 / 无障碍：骨架用 `$surfaceVariant` 令牌，跟随主题；真卡上新增的是 `minHeight`（标题两行、报价行 34），字体放大时仍可自行长高，不裁字；骨架块无障碍不可读，不新增语音标签。

## 技术影响

- API/OpenAPI：无变化。
- 状态与本地数据：`SnapCarousel` 增加一个模块级"上次量到的视口宽度"，只作下一次挂载的初值，`onLayout` 仍是唯一权威；不落盘、不跨会话。
- 钱包/签名/链/金额精度：无。
- 权限、隐私与遥测：无。
- OTA 或全量更新：纯 JS/UI 变更，无原生模块、权限、scheme 或 Manifest 改动 → 走 OTA。

## 验证与发布

- 修复前失败测试或需求测试：
  - `src/design-system/snap-carousel.spec.tsx`（新增）：量到宽度后卡宽跟上；下一个 `fullWidth` 轮播第一帧就是最终卡宽；非 `fullWidth` 不受影响。
  - `src/features/predict/ui/market-list-screen.spec.tsx`（新增两条）：策展未回来时精选位有两张同形骨架且轮播已在；策展返回 0 个 hero 时精选区整块不出现。
  - `src/features/foundation/foundation-home-screen.spec.tsx`（新增一条）：热门预测骨架与真卡共用一个轮播。
- iOS / Android：Android 模拟器实测（见下）；iOS 未验证（无原生改动，且本仓库当前只出 Android 直装包）。
- 灰度指标与停止条件：OTA 发布后看预测页签崩溃与白屏；异常即回滚到上一版 OTA。
- 回滚：发布上一份 OTA（`applyStrategy: immediate`），或撤销本次提交重出包。

## 实际验证（2026-09-10）

工作区当时有另一条会话的未提交改动，为了不把别人的半成品打进包里，本次构建与发包都在
`git worktree`（干净检出 `33ec7f7`）里做，产物只含本提交及其祖先。

- 门禁：在该干净检出上 `pnpm check` 全绿——format / lint / typecheck / 121 suites 857 tests / API 契约 / 构建档位 / i18n。
- 生产签名 APK：`anyfun-1.3.0-build26-release.apk`，签名指纹与 `tenant.json` 的 `signerSha256` 一致（`1a5d9fb4…`），装到 rwa_test2（emulator-5556）。
- 模拟器实测（把网络压到 edge + gprs 延时，让加载态停留足够长）：
  - 精选位在策展回来前画同形骨架，卡片首帧就是满宽（不再先窄后宽），轮播页点已在；
  - 逐像素比对加载态与内容态：区段标题顶边到轮播页点顶边都是 939px，**骨架换成卡片零跳版**（整段比内容态低 8px 是顶栏从钱包 chip 换成 Enable 按钮导致的，与本次改动无关）；
  - 横滑到第二张，"无报价"的卡片与有报价的卡片等高，页点位置不变。
- OTA 包：`ota-android-production.zip`（5,324,626 B，sha256 `98036d42…`），runtimeVersion 1.3.0，applyStrategy `immediate`，sourceCommitSha `33ec7f7b329d5e1ef3b25a3e41033a3a5eb40862`。
- 发布：基线 `rel_4W0ZTVaCWwY2aZXIKLxu4Q`（android 1.3.0 / build 26 / runtime 1.3.0，active）之上
  `ota_scREMNfSiGBd42eg1wj1vQ`，revision 1，updateId `81dcb339-2ea0-48d7-9bee-cca32b98061a`，
  上传 PUT 200 → 登记 201（verified）→ 发布 201（active）。
- 线上核对：`GET /v1/ota/manifest`（android / runtime 1.3.0 / production / 1.3.0 (26)）返回该 updateId，
  ETag 带 `-immediate` 后缀，`metadata.sourceCommitSha` 与提交一致。
- 到端验证：rn_smoke（emulator-5570，装的是线上 build 26 整包、没有本地 JS）重启后下载并应用该更新，
  进预测页签能看到新的精选骨架——即只靠 OTA 也拿到了本次改动。

未验证项：iOS（无原生改动，本仓库当前只出 Android 直装包）；深色模式与字体放大只靠令牌与 `minHeight` 保证，没有逐项截图。
