# Fix: 一次请求失败不再把设备挡在"配置连接失败"那一屏

状态：Done

涉及仓库：RN-App。现象来源：2026-09-12 用户报告"OTA 包升级完后 App 打开显示配置连接失败"。

## 用户场景与现状证据

- 用户/角色：任何一台已经正常用过这个 App 的设备。
- 当前行为与代码证据：
  - `core/config/use-bootstrap.ts` 的 `bootstrapQueryFn` 只调 `loadBootstrap`，而 `loadBootstrap` 每次都走网络。查询配置是 `retry: false`。
  - `app/runtime-context.tsx` 的放行条件是 `snapshot.source === "remote"`，失败屏的条件是 `query.isError && !snapshot`。
  - `loadCachedBootstrap` 只被 `cachedLaunchConfig` 用来决定启动页画哪版品牌，**从来不参与启动放行**。
  - 也就是说：一次失败的 bootstrap 请求（弱网、DNS 抖动、15 秒超时、服务端重启窗口）就足以让一台配置齐全的设备停在"配置连接失败"，而且不会自动重试，只能等用户自己点"重新连接"。失败屏的文案写着"当前没有可用的远程配置或**有效缓存**"，但代码根本没读过缓存——这句话是假的。
  - OTA 应用后会 `reloadAsync` 重启进程并立刻发起 bootstrap，正好是网络最容易抖一下的时刻，所以这个现象在 OTA 升级后特别显眼。
- 排查中已排除：服务端 bootstrap 各版本各渠道均 200 且过当前 schema；1.3.9 OTA 的清单签名用服务端当前证书（`4fabae3c…`）验签通过，与 APK 内嵌证书一致；模拟器上用线上 1.3.9(38) APK 完整复现过一遍"下载→应用→重启→再次冷启"，全部正常。所以问题不在 OTA 链路本身，而在这条失败路径没有兜底。

## Given / When / Then

- Given 手上有一天以内成功下发并落盘的配置，When 这次 bootstrap 请求失败，Then 用缓存那份启动，快照标成 `cache`。
- Given 快照是 `cache`，When 判断要不要升级（`checkForUpdates`），Then 仍然当作"没拿到新鲜配置"拒绝判定——只有 `remote` 能驱动更新决定。
- Given 缓存比一天更旧，Then 不放行，走失败屏；但那份缓存**不被清掉**，启动页品牌还要用它。
- Given 从没成功下发过（缓存为空），When 请求失败，Then 失败屏，行为与以前一致。
- Given 失败是传输层的（网络不可达、超时、5xx、429），Then 自动重试最多两次，退避 0.8s / 1.6s。
- Given 失败是确定性的（4xx、schema 不符），Then 不重试。
- Given 请求是被取消的（切换语言会中止上一发），Then 不退回缓存，也不算失败。

## 技术影响

- `core/config/bootstrap-repository.ts`：`BootstrapSnapshot.source` 增加 `"cache"`；新增导出 `MAX_CACHE_ENTRY_AGE_MS`（24 小时）；`loadCachedBootstrap` 接受可选 `maxAgeMs`。超出调用方窗口只是"这次不给"，不清缓存——清掉会连启动页品牌一起弄丢。
- `core/config/use-bootstrap.ts`：失败后退回缓存；`retry` 改为只重试 `AppError.retryable`。
- `app/runtime-context.tsx`：放行条件由 `source === "remote"` 改为 `source !== "fallback"`。

## 为什么放行窗口是一天，不是缓存本身的七天

bootstrap 同时是一条安全控制通道：强制升级、下线一条链、换 RPC 端点都靠它。放行一份七天前的配置，等于让这些决定七天内都到不了这台设备。原来"只认本次远程下发"的规则正是为了这个，本次**收窄而不是取消**它：一次失败不该让设备打不开，但"长期离线还能进业务页"不在可接受范围内。

这一条是对既有设计决定的修改，不是纯缺陷修复。原测试名 `never enters on stale data` 记录的就是旧规则。

## 测试

- `core/config/use-bootstrap.spec.ts`（新增 8 例）：退回缓存、无缓存照实抛错、读缓存失败不掩盖原始错误、取消不退回、成功仍是 `remote`、重试与退避边界。
- `core/config/bootstrap-repository.spec.ts`：超窗不给且不清缓存、窗口内给。
- `app/runtime-context.spec.tsx`：拆成"没有可用缓存→失败屏"和"有一天内的缓存→直接进入"两例。
- 全量 140 套 1034 例通过；`tsc --noEmit` 与 eslint 干净。
