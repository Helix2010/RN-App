# Feature: referral-graph（邀请关系基础服务，一期不含返佣）

状态：Implemented（三仓自动化验证完成；模拟器端到端与真机未运行，见「未验证」）

设计：`docs/design/referral-graph-2026-09-15.md`；服务端决策 `RN-Server/docs/decisions/0018-referral-graph.md`，表结构 `RN-Server/docs/database/REFERRAL_SCHEMA.md`。

## 现有行为

「邀请返佣」三处入口都是占位：首页快捷格没有 `onPress`；个人中心快捷格与「更多」那一行点击弹 `state.empty` 的 toast，而且「更多」那行的人数写死成 12。服务端没有任何邀请相关的表、接口或配置。

## 预期行为（验收条件）

一期只做**邀请关系**，不做返佣，界面上不出现任何收益字样。要能回答三个问题：

1. 我的邀请码是什么——每个账号注册即得一个 8 位邀请码，可复制、可分享、有二维码与邀请链接；
2. 谁邀请了我——注册后 7 天内（租户可配）可以绑定一次，**绑定永久不可解除**，绑定前必须显式确认；
3. 我邀请了谁——直接下级列表，只显示别名与加入时间。

外加：运营能在管理端查关系、能补录（不能解绑）；租户能开关邀请并设定绑定窗口。

## 改动

### RN-Server

- 迁移 48 / 49 / 50：`wallet_user` 加四列（`invite_code`、`inviter_user_id`、`invited_at`、`invite_source`）、三个索引、一条 CHECK。三版分开且每步幂等，**没有第四版**——`invite_code` 永久可空。
- `internal/referral`：Crockford Base32 字母表、生成与归一化（全角、分隔符、大小写、`I L`→`1`、`O`→`0`，`U` 判非法）。迁移回填与接口共用同一份。
- `internal/api/referral*.go`：移动端四个接口、管理端两个接口、落地页、限流、绑定与防环。
- `wallet_auth.go`：注册事务里赋邀请码，候选码在 `BeginTx` 之前预抽。
- bootstrap 增加 `referral` 段（写入校验 + 下发），管理端账号详情扩展 `referral` 字段。

### RN-Admin

- 运营数据工作区加「邀请关系」一级 Tab：服务端键集分页、筛选写进 URL（参数带 `referral` 前缀）、行内标注双方两级封禁。
- 补录表单：必填原因、邀请码与邀请人地址二选一、卡片上直说"补录后无法解绑"与"被邀请人必须已登录过"。
- 账号详情面板加「邀请关系」一节。

### RN-App

- 新 feature `src/features/referral`（网关、hooks、页面、模型）；新路由 `Referral`。
- 新 `src/core/deep-link`：入站深链的唯一分发点 + 30 分钟暂存。
- 接上三处占位；`profile.referralCount` 的写死 12 换成真实计数。
- 文案：`home.quick.invite` / `profile.referral` 改「邀请好友」，新增 `referral.*` 33 个键。
- **原生变更**：`app.config.ts` 的 intentFilters 增加 `/app/invite/`，并从「WalletConnect 配置存在才生成」里拆出来挂到 https 上。

## 评审与修复（实现后的对抗评审）

三仓实现完成后各跑了一轮 `code-reviewer` 对抗评审，加上自查。评审**先复现再定性**，
修复也**先写出会失败的回归测试再改**。下面按严重度列出真实缺陷。

### 会直接影响线上的四个

1. **bootstrap 永远下发 `bindWindowHours: 168`，租户配的值被丢掉**（服务端）。
   `appConfigView` 归一化时把数字变成 Go `int`，bootstrap 拿它的结果又归一化一遍，
   而里面只断言 `float64`，静默落回默认值。App 显示 7 天窗口、服务端按真实的 24 小时判，
   用户第 3 天点绑定拿到 409，而管理端显示的又是正确的 24。根因是同一段配置有两份解析
   实现；已收敛成 `parseReferralSection`。

2. **管理端「应用配置」页任何保存都返回 400**（服务端）。`appConfigView` 往
   `config.referral` 注入了只读的 `inviteLinkBase`，而 `validateReferralSection` 对未知键
   零容忍，RN-Admin 的 `looseObject` 原样把它 PATCH 回来。改主题色都会被拒，
   且报错指向运营没碰过的字段。`inviteLinkBase` 已移出可编辑视图，只留在下发链路。

3. **zustand persist 的 rehydrate 会盖掉刚存进去的深链邀请码**（App）。默认的 `merge`
   是 `{...内存, ...磁盘}`——**磁盘覆盖内存**，方向正好相反。冷启动时
   `Linking.getInitialURL()` 与 rehydrate 谁先返回是真竞态，深链先到就会被随后落地的
   旧值（哪怕是 `null`）盖掉，整条主路径静默失败。用过一次之后才会发作：存储为空时
   merge 是恒等，第一次装机看不出来。已改成"本次进程写过就以内存为准"。

4. **手输的码提交后，深链暂存的那个立刻顶上来再弹一次确认**（App）。
   `setManualCode(null)` 是同步的，而 `forgetPending()` 要等网络往返，中间那几帧
   `shouldConfirmPending` 翻成 true。用户刚确认完一次**永久不可解除**的绑定，
   马上被要求确认另一个，再点一下就是第二次提交。

### 其余已修

**服务端**：未命中的更严子配额此前只写日志不返回 429（契约承诺了 429），扫描器的有效
配额是宽松的那条；关系列表的两个 LEFT JOIN 与地址筛选用 `LOWER(address)` 导致索引全失效，
改回 `address_key`；释放绑定锁的 exec 补回超时；补录配额改成成功后才消耗（打错地址 20 次
不该把当天额度吃光）；补录响应返回裸邀请码，与关系列表、账号详情一致；`assignInviteCode`
显式断言影响一行；`/me` 的 `bindWindow.open` 计入租户开关；账号详情读到无码行改为报错。
死代码与重复：`referralCodeAttempts` 两份合并进 `internal/referral`；两份配置解析合并；
`platformWalletBlocked` 改为调用 `platformBlockedAddress`；补录复用 `validateAdminAction`；
下级列表查询抽成 `referralInviteesPage`，handler 与库测共用（此前测试抄了一份，
handler 漏掉 `invited_at IS NOT NULL` 测试照样绿）；落地页不再二次归一化。

**App**：确认层用 ×／下滑／点遮罩关闭时状态全留着，下次进来又弹——已挂到 `onDismiss`；
30 分钟暂存的过期判定只在渲染期成立（`useNow()` 取挂载时刻且此后不变，而 stack 页在
后台一直挂着），提交那一刻现在会用 `Date.now()` 再判一次；下级列表请求失败被画成空态，
与同卡片的"已邀请 N 人"自相矛盾，已拆成独立错误分支；`parseDeepLink` 丢掉三斜杠
（`anyfun:///app/invite/X`，正是 `Linking.createURL` 的产出形态）与大写 host 的链接；
深链邀请码零边界校验就落盘并进确认弹层，已加长度与控制字符的拒绝（**不是归一化**，
归一化仍只在服务端）；邀请页与个人中心用了两个 queryKey 查同一份数据，已统一走
`useReferralOverview`；`REFERRAL_DISABLED` 此前落在裸 toast 上，现在整页切成关闭态。
死代码：全链路无人调用的 `checkCode` 已删（它返回 `boolean`，恰好把设计 §4.1 特意
分开的"码输错"与"码无效"合并成一句含糊的话）；两个未被引用的文案键已删；
Mock 网关改抛带 `code` 的 `AppError`，否则"服务端拒绝时显示对应原因"这类用例是假绿。

**管理端**：邀请关系页首屏加载中直接画空态（管理端标准 §1.1 要求 loading/error/empty
分别表达），已补 `ReferralPageSkeleton`。

### 新增的回归测试

服务端 limiter 单测 5 条、库测 4 条；App 深链解析 6 条、暂存竞态 3 条、邀请页 3 条；
管理端首屏状态 2 条、日期筛选往返 1 条。**每一条都先在未修复的代码上验证过会失败**
（配置双重归一化、管理端回存、rehydrate 竞态、二次确认四条逐个验过）。

## 实现里与设计不同的地方

1. **声明式默认写在 `REFERRAL_SCHEMA.md` 而不是 `docs/CONFIGURATION.md`**。后者在 §1 明确把"按租户变化的"划在范围外（"租户数据……不在这里，在库里按租户存"），把租户配置写进去会和它自己的分类打架。
2. **一期不做 App 内扫码**（设计 D8 已记录）。二维码内容是链接，任何相机扫到都经 App Links 落回 App，能力不缺；而 `AddressScanner` 硬编码了 7 个 `send.*` 文案键，相机权限的系统提示也写死"scan wallet address QR codes"，通用化要动原生清单。
3. **App Links 的两条路径写在同一个 intent filter 的 `data` 数组里**，共用一次域名核验，而不是两个 filter。
4. **邀请页是三张卡不是设计 §5.1 的四块**：二维码并进了邀请码卡。二维码的内容就是邀请链接，
   和邀请码同属"把我的邀请发出去"这一件事，分成两张卡会让用户以为是两样东西。
5. **补录没有 `expectedInviteeState` 请求字段**（设计 §4.4 第 2 条 / ADR 0018）。关系一次性且
   不可解绑，"未绑定"是它唯一可能的取值，恒为常量的字段不携带信息却要进公开契约；服务端的
   条件更新 `WHERE inviter_user_id IS NULL`（影响 0 行即 409）在并发下与乐观锁等价。已记进 ADR。
6. **双方注册 IP / ASN 没有采集**（设计 §6 第 1 条）。这个库从没有任何一张表存过客户端 IP，
   补上它等于对每个账号永久采集一项个人数据，包括从不使用邀请功能的用户——这是需要运营与
   合规判断的决策，不由实现方顺手决定。**后果要说清楚**：注册 IP 才是能把一棵 Sybil 树串起来
   的字段，绑定 IP 换一下就绕开了；等返佣立项再想采集，这批历史数据已经永久缺失。要采集就得
   在本批迁移里给 `wallet_user` 加列，**这个决定越早做越省事**。缺口与后果记在 ADR 0018「滥用」。
7. **设计 §5.4 的一条预测被更正**：原文说"拆分后未配 WalletConnect 的租户会首次获得 autoVerify
   的 intent filter"，实现后核对发现 `appLinkHost` 与 `walletConnectRedirectUrl` 判的是**同一个**
   条件，没有任何租户的 filter 集合发生变化。设计已更正，免得有人去追一个不存在的上线风险。

## 验证

- **RN-Server**：`gofmt` / `go vet` / `go test -race ./...` 全绿；`go build ./cmd/server` 通过。库测跑在本机 `rn-test-mysql`（MySQL 8.0）上，覆盖并发互绑不成环、并发绑定只成一次、三级链回绑成环、CHECK 约束拒绝三列不一致、键集分页不重不漏、注册碰撞重试不改他人行、三个迁移重复执行、回滚后旧 INSERT 仍可用、`invite_code` 仍可空。
  评审轮补上了此前零覆盖的那一层（HTTP handler、落地页、限流器）：limiter 单测 5 条、
  未命中配额返回 429 与配置链路的库测 4 条。`go test -race -count=1 ./...` 带
  `RN_TEST_MYSQL_DSN` 全量跑通。
- **RN-Admin**：`pnpm check` 全绿（format / lint / typecheck / test / build），40 套 / 299 用例；
  邀请关系页新增 11 个用例（评审轮 +3：首屏骨架、首屏错误、日期筛选随 URL 往返）。
- **RN-App**：`pnpm check` 全绿（format / lint / typecheck / 全量 Jest / api:check / config:check / i18n:check），
  166 套 / 1334 用例；邀请与深链相关共 34 个用例（评审轮 +12）。
- 契约：`contracts/rn-server.openapi.json` 与服务端同步，新增 6 条路径与 7 个 schema；
  评审轮补了三条注册接口的 429，并把补录响应的 `inviterCode` 说明改为裸码。

全量 Jest 跑完会打一条「Jest did not exit one second after the test run has completed」。
它**不是本次引入的**，已定性：本分支的基点 `adc5745` 在不含任何本次改动时同样出现
（163 套 / 1300 用例全过，警告 1 次），而当前 `origin/main`（`f9742b2`，另一条会话修
锁屏指纹的那个提交）已经没有。也就是说这个句柄在基点上就存在、上游已修，本分支
rebase 到最新 main 之后会自然消失。测试全过、`pnpm check` exit=0，不阻塞交付。

## 模拟器端到端实测（2026-09-15，服务端与管理端已部署）

环境：`anyfun` 租户 / `api.anyfun.win`；APK `anyfun-1.3.16-build46-release.apk`
（签名 `1a5d9fb4…`，与 `signerSha256` 一致）；两台模拟器 emulator-5554 / 5558。
配置：`referral.enabled=true`、`bindWindowHours=24`（**故意不用默认 168**，
好顺带验证下发链路）。

**通过的（逐条实测，不是推断）**：

| 项                             | 结果                                                                                                                                   |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `aapt dump xmltree` 核对新 APK | 两条路径在**同一个** `autoVerify` filter 里，`/app/invite/` 带尾斜杠 ✓                                                                 |
| App Links 域名核验             | `pm get-app-links` 报 `api.anyfun.win: verified` ✓                                                                                     |
| 注册即得邀请码                 | A 拿到 `RASJ-SSN5`，B 拿到 `9NPY-RQ6B` ✓                                                                                               |
| 存量账号回填                   | 共享测试钱包（9/10 注册）有码 `8AWA-4KF3`，说明回填迁移跑过 ✓                                                                          |
| 绑定窗口下发                   | 邀请页显示 `Closes in 23h 59m` —— **配的 24 小时走通了整条链路** ✓                                                                     |
| 存量账号窗口已关               | 显示「窗口已过」且不给输入框，符合 D2 ✓                                                                                                |
| 深链冷启动                     | `am start` 投 A 的链接 → App 被拉起（不是浏览器）→ 邀请页弹出确认，码正确 ✓                                                            |
| 绑定前必须确认                 | 确认层文案「绑定后永久不可更改」，点确认才提交 ✓                                                                                       |
| 绑定成功                       | B 的页面显示「Code RASJ-SSN5 · bound …」，输入框消失 ✓                                                                                 |
| 下级列表不含地址派生值         | A 看到的是别名 `e3dac2` + 加入日期，没有地址 ✓                                                                                         |
| 渠道标记                       | 管理端列表里 `source = link`（深链）✓                                                                                                  |
| 管理端关系列表                 | `total=1`，双方完整地址、裸邀请码、双方封禁状态 ✓                                                                                      |
| 账号详情的 referral 段         | 邀请码、邀请人（地址/码/渠道/时间/状态）、下级数齐全 ✓                                                                                 |
| 审计留证                       | `referral_bind` by `system-referral`，summary 含 bindIp、双方 `first_seen_at`、`registrationGapSeconds=469`、`sharedInstallations=0` ✓ |
| 补录失败面                     | 已绑定 → 409；没登录过 → 404 且文案说「从没在本租户登录过」；码与地址同时给 → 422；reason 太短 → 422 ✓                                 |
| 解析邀请码限流                 | 同一 IP 第 11 次转 429 ✓                                                                                                               |
| 归一化                         | `rasj-ssn5`（小写带横线）同样解析成功 ✓                                                                                                |
| 落地页                         | 有效码显示分段形态；无效码统一 404 页「邀请码无效」✓                                                                                   |

**实测中发现并已修的**：

1. **管理端没有邀请开关的配置界面**（已补，见 RN-Admin 提交）。服务端的声明式默认是
   `enabled=false`，所以服务端部署完功能对用户仍然不可见，而**没人能打开它**。
   本次只能先用管理端 API 直接 PATCH 配置才跑起来。设计 §3.6 与一期范围都要求了
   这一节，漏做且没记进偏离清单。
2. **服务端文案目录没有邀请文案**。App 侧是「内置垫底、服务端覆盖」，所以 35 个
   `referral.*` 键走内置文案能正常显示，但 `home.quick.invite` / `profile.referral`
   被服务端的旧文案「邀请返佣」盖住。已把 35 条新增 + 2 条变更推到服务端并发布
   （版本 `260915072639`），入口现在显示「邀请好友」。
   **发布清单里要有这一步**，它不在代码里。

**发现但未修的两条**：

3. **服务端把文案键名小写化**，所以 App 侧 22 个驼峰键（`referral.bindAction`、
   `referral.bindClosesAt` 这类）永远匹配不上下发的 `referral.bindaction`，只能走内置
   文案——**这 22 条运营在控制台里改不了**。这是平台既有行为，不是本次引入，
   但邀请功能是第一个大量使用驼峰键的模块，所以格外明显。
4. **装新 APK 后的第一次启动可能跑旧 OTA 包**。emulator-5558 上原先有个待应用的
   OTA，`install -r` 保留应用数据（含 expo-updates 存储），重启后它被启动了——
   那是旧提交的 JS，邀请入口点了没反应。**第二次启动就自纠**（runtimeVersion 不
   匹配被丢弃）。影响有边界，但发版说明该提一句：有待应用 OTA 的用户装了新包后，
   头一次进来看到的还是旧界面。

## 未验证

- **真机未运行**（只跑了模拟器）。
- 其它租户的 `assetlinks.json` 未逐个 `curl`（只验了 `anyfun`）。
- 成环拒绝（C 绑 B 后再拿 A 的码绑 → 422）未在端到端跑，只有库测覆盖。
- 管理端补录的**成功**路径未在端到端跑（它会建一条永久不可解除的关系，需要一个
  一次性账号；失败面四条已实测）。

## 兼容、发布与回滚

- **发布顺序**：服务端（迁移 + 接口 + 落地页）→ 管理端 → App 全量包。落地页与 `assetlinks.json` 必须先在位：Android 在安装时校验域名归属，文件不在位这一版装上去就是未校验状态（2026-09-11 App Links 上线踩过）。
- **原生变更，必须出新 APK，不能 OTA。**
- bootstrap 加 `referral` 段对旧版 App 安全：顶层 schema 没加 `.strict()`，zod 对未知字段静默 strip（已核对 `bootstrap.schema.ts` 与 `package.json` 的 zod ^4.4.3）。但**已知字段的取值校验仍然严格**，所以服务端在写入时就拒绝越界值。
- 回滚：四个列留在库里不做反向迁移。因为 `invite_code` 永久可空，旧二进制回滚后登录不受影响。把 `referral.enabled` 改回 `false` 即可让功能对用户消失。
- **存量用户上线即窗口已关**：回填只发码不建关系，所有存量账号注册都已超过 7 天，只能走管理端补录。这是设计 D2 的自然后果，运营需提前知道。

## 同窗口必须一起上的事（评审轮已补上）

设计 §6 / ADR 决策 D13：注册链路三步（`installations/register`、`auth/nonce`、`auth/verify`）
免鉴权、零限流，3 个请求就能造一个账号。邀请关系上线后这条链路等于给 Sybil 关系树配了出口，
而关系不可解绑、封禁也不清 `inviter_user_id`，事后无法结构化清理。

**这条限流已随评审轮补进本分支**（`internal/api/registration_limit.go`）：三步各有每小时与
每分钟两档按 IP 配额，超出返回 429 `REGISTRATION_RATE_LIMITED` 并告警。账号创建的真正瓶颈是
`auth/verify`（`wallet_user` 在它这里创建），单 IP 的造号速度从"无上限"压到 60/小时。

**阈值是有意取松的**：运营商级 NAT 与办公室出口会让几十个真人共用一个出口 IP，这条闸的目的
是掐掉脚本化批量造号，不是精确风控，宁可放过也不误伤。要收紧等线上有了分布形状再调，
别凭空拍一个更小的数。**上线后应当看一眼 `registration step throttled` 这条告警的量**——
真人碰不到这条线，一旦有量，要么是脚本，要么是阈值定错了。

留证方面本次做的是：每条绑定把双方注册时间与间隔、本次绑定 IP、installation 复用情况写进
`audit_events.summary`。**双方的注册 IP 与 ASN 没有采集**，理由与后果见上面「实现里与设计
不同的地方」第 6 条——那是本次交付里唯一还悬着的安全决策，需要运营与合规拍板。
