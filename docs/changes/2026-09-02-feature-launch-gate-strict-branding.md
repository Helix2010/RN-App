# Feature: launch-gate-strict-branding

状态：Completed

## 用户场景与现状证据

- 用户/角色：所有租户 App 的冷启动用户；配置启动页品牌的租户运营。
- 现状：
  1. 门禁允许"超时放行"（`launch.maxDisplayMs`）和"缓存放行"：`loadBootstrap` 拿不到远程下发时用上次缓存冒充配置，App 在 stale 数据上进入业务页；钱包运行时配置在 effect 里应用，业务界面首帧可能读到上一份配置。
  2. 启动图被画了不止一次：原生 `Theme.App.SplashScreen` 用的是 `expo prebuild` 模板自带的占位图（网格 + 同心圆，不属于任何租户，`assets/splash-icon.png` 从未接入）；JS `LaunchScreen` 在 `snapshot` 到来时从一个树分支换到另一个分支重挂载，淡入动画重播；启动视觉随"缓存 → 远程 → 预热完成"换三次 URI；配置的 logo 没到时先画内置几何标再换成租户 logo。
- 代码调用链：`MainActivity(SplashScreen theme) -> FoundationRuntimeProvider -> useBootstrap/loadBootstrap -> LaunchScreen -> children`。
- 非目标：iOS 原生启动图；桌面图标；接入 `expo-splash-screen`（新增原生依赖需 ADR）。

## Given / When / Then

1. Given 冷启动，When 本次远程 bootstrap 还没返回，Then 一直停在启动页；没有超时放行，也不用缓存放行。
2. Given 远程 bootstrap 返回并通过校验，When 最短停留时间已到，Then 才挂载业务界面，且业务界面首帧读到的钱包运行时配置就是本次下发的（在 `bootstrapQueryFn` 里随数据一起应用）。
3. Given 远程 bootstrap 失败，When 有或没有本地缓存，Then 显示"配置连接失败"重试屏；重试成功后进入。进入过一次后，运行中的刷新失败不把用户踢回门禁。
4. Given 本地有上次成功的 bootstrap，When 冷启动，Then 启动页按缓存里那版品牌配置画一次（图片已在本地），服务端这次下发了新版本只在后台下载校验，下一次启动生效；启动过程中不换图。
5. Given 首次安装没有缓存，When 远程下发还没到，Then 启动页只画背景与一句状态文案，不画任何 logo；下发到达后按本次配置画一次。
6. Given 品牌配置里没有 logo / 背景图，Then 就不画；配置的图片加载失败只留 warning，不换成别的图（启动页不再有内置几何标）。
7. Given Android 冷启动的原生窗口，Then 只有与图标同色的纯色背景（`with-plain-splash` 插件），不再出现模板占位图。

## UI 与交互状态

- 启动页整个过程只有一个实例、同一个树位置（`RuntimeContext.Provider` 始终挂载，`entered ? children : LaunchScreen`）。
- `pending`（还不知道用哪版品牌）→ 品牌视觉（冻结）→ 业务界面；失败 → 重试屏。
- 已删除 `BootstrapSkeleton`（假首页骨架是第二种视觉状态，且是兜底 UI）。

## 技术影响

- `loadBootstrap` 失败即抛错，不再返回 `source: "cache"`；`BootstrapSnapshot.source` 只剩 `remote | fallback`。缓存仅供 `loadCachedBootstrap` 决定启动页画哪版品牌。
- `launch.maxDisplayMs` 服务端仍下发，App 不再使用（没有超时放行）。
- 新增 `plugins/with-plain-splash.js`：`withAndroidColors` + `withAndroidStyles` 把 `Theme.App.SplashScreen.windowBackground` 改为 `@color/splashscreen_background`，颜色取 tenant.json 的 `iconBackgroundColor`。属于原生变更，随下一次全量 APK 生效。
- 与 `docs/changes/2026-08-29-feature-remote-branding-launch.md` 验收条件 1、3（"无网络不阻塞进入可用状态"）相冲突：按 2026-09-02 确立的"正式场景开发原则（不写回退 / 兜底）"，以本文为准。

## 验证

- `pnpm check`（含 67 个套件 / 485 个用例，新增 `src/app/runtime-context.spec.tsx` 4 个门禁用例、`bootstrap-repository.spec.ts` 2 个）。
- `EXPO_PUBLIC_TENANT=anyfun expo config --type introspect` 确认 `splashscreen_background=#E9F0FF`、`windowBackground=@color/splashscreen_background`。
- 待做：下一次 `pnpm android:release anyfun` 出包后在真机验证冷启动只有一次 logo 淡入。
