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
- `launch.maxDisplayMs` 已从 App schema、内置配置与服务端配置模型里删除。服务端的 bootstrap 输出暂时保留一个常量 1800（`legacyLaunchMaxDisplayMs`）：已安装的 App ≤ 1.2.6 校验要求它必填，缺了整份 bootstrap 解析失败。等 `update.minSupportedVersion` 抬到不再要求它的版本后一起删。
- `BootstrapSnapshot.stale` 已删除：远程数据不再有"过期"态，只看 `source`。`RuntimeValue.isInitialLoading` 无消费者，已删除。
- 新增 `plugins/with-plain-splash.js`：`withAndroidColors` + `withAndroidStyles` 把 `Theme.App.SplashScreen.windowBackground` 改为 `@color/splashscreen_background`，颜色取 tenant.json 的 `iconBackgroundColor`。属于原生变更，随下一次全量 APK 生效。
- 与 `docs/changes/2026-08-29-feature-remote-branding-launch.md` 验收条件 1、3（"无网络不阻塞进入可用状态"）相冲突：按 2026-09-02 确立的"正式场景开发原则（不写回退 / 兜底）"，以本文为准。

## 验证

- `pnpm check`（含 67 个套件 / 485 个用例，新增 `src/app/runtime-context.spec.tsx` 4 个门禁用例、`bootstrap-repository.spec.ts` 2 个）。
- `EXPO_PUBLIC_TENANT=anyfun expo config --type introspect` 确认 `splashscreen_background=#E9F0FF`、`windowBackground=@color/splashscreen_background`。
- 待做：下一次 `pnpm android:release anyfun` 出包后在真机验证冷启动只有一次 logo 淡入。

## 审查后的修正（同日）

- 启动页动画起点按真正下发的类型重设（此前 `none` / `fade` 会停在透明或 86% 缩放）。
- "已确认没有缓存"是已知结果，不再被后一次读取覆盖；启动视觉在一次启动内不再可能换版本。
- 转出页与收款页、账户详情的"当前链"改为每次渲染按启用集合派生：配置刷新把链关掉不会再在渲染期抛错；入口指定了未启用的链，如实显示"这条网络已在本平台停用"。
- WalletConnect 会话没有一条启用的链：连接即失败并断开会话（`WalletConnectNoEnabledChainError`），登录页有对应文案；不再留下"已连接但零条链"的账户。
- `getBalances` 对未启用的链一律抛 `ChainNotEnabledError`，与链层其他入口一致；新错误类都有用户文案。
- 删除 `session.data?.chains ?? ["bsc"]` 这类永不触发的兜底；`loadBootstrap` 去掉只会重抛的 try/catch。
- 仍待做：根级 ErrorBoundary（RELIABILITY 文档要求，当前不存在）；余额查询按链分别报错而不是整批失败；首页头部无 logo 时的内置几何标。

## 后续补充（同日）

- 根级 ErrorBoundary（`src/app/root-error-boundary.tsx`，挂在 App 根部）：渲染期异常变成可操作的界面——重试（重新挂载整棵树，导航一并重置）、复制诊断信息（诊断 ID、版本、构建号、渠道、错误与组件栈）。只用 RN 原生组件与内置中英文案，不依赖可能就是崩溃源的设计系统与运行时。连续启动崩溃进入 safe mode 需要服务端回滚指令配合，未做。
- 首次安装的启动流程：加载态（转圈 + 状态文案）→ 拿到服务端下发 → 按下发的品牌配置画启动页并停留最短时间 → 进入。
- 余额按链分别报错：`WalletGateway.getBalances` 返回 `BalanceSnapshot { items, unavailable }`，一条链的节点没响应只把这条链记入 `unavailable`，其他链的真实余额照常显示；资产页、转出页、账户详情各自显示"某链余额暂时不可用"并可重试。
- `BrandMark` 没有 `uri` 时不再画内置几何标；图片下载完成前显示同尺寸骨架。业务页只在拿到下发后挂载，所以"没配 logo"在那一刻已确定，不用骨架冒充。

## 代币可信度的界面语义（同日）

- 不再给"不在白名单"的代币贴"未验证"：租户上的币和租户一样可信，用户对租户与平台无感，也不做来源标签。
- 白名单只在**冒名**时出声：符号与同一条链上的主流合约或原生币相同、合约地址不同，转出确认页出警示并把合约行标黄（`impersonatesKnownToken`）。
- 没有参考价的币 `usdValue` 为 null：列表显示"—"而不是 0，不算"小额"被隐藏，合计只算已知估值；转出时大额阈值无从判断，一律要求生物验证（`useRequireVerification` 对 null 一律验证）。
- 管理端提示同步改写：不在主流合约表 = 不显示估值、转出一律验证、仅同名冒名时提醒。

