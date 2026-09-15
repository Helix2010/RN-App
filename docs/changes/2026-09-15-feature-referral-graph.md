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

- 迁移 47 / 48 / 49：`wallet_user` 加四列（`invite_code`、`inviter_user_id`、`invited_at`、`invite_source`）、三个索引、一条 CHECK。三版分开且每步幂等，**没有第四版**——`invite_code` 永久可空。
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

## 实现里与设计不同的三处

1. **声明式默认写在 `REFERRAL_SCHEMA.md` 而不是 `docs/CONFIGURATION.md`**。后者在 §1 明确把"按租户变化的"划在范围外（"租户数据……不在这里，在库里按租户存"），把租户配置写进去会和它自己的分类打架。
2. **一期不做 App 内扫码**（设计 D8 已记录）。二维码内容是链接，任何相机扫到都经 App Links 落回 App，能力不缺；而 `AddressScanner` 硬编码了 7 个 `send.*` 文案键，相机权限的系统提示也写死"scan wallet address QR codes"，通用化要动原生清单。
3. **App Links 的两条路径写在同一个 intent filter 的 `data` 数组里**，共用一次域名核验，而不是两个 filter。

## 验证

- **RN-Server**：`gofmt` / `go vet` / `go test -race ./...` 全绿；`go build ./cmd/server` 通过。库测跑在本机 `rn-test-mysql`（MySQL 8.0）上，覆盖并发互绑不成环、并发绑定只成一次、三级链回绑成环、CHECK 约束拒绝三列不一致、键集分页不重不漏、注册碰撞重试不改他人行、三个迁移重复执行、回滚后旧 INSERT 仍可用、`invite_code` 仍可空。
- **RN-Admin**：`pnpm check` 全绿（format / lint / typecheck / test / build）；新增 8 个用例。
- **RN-App**：`pnpm check` 全绿（format / lint / typecheck / 全量 Jest / api:check / config:check / i18n:check）；新增 19 个用例（深链解析 9、邀请页 10）。
- 契约：`contracts/rn-server.openapi.json` 与服务端同步，新增 6 条路径与 7 个 schema。

全量 Jest 跑完会打一条「Jest did not exit one second after the test run has completed」。
它**不是本次引入的**，已定性：本分支的基点 `adc5745` 在不含任何本次改动时同样出现
（163 套 / 1300 用例全过，警告 1 次），而当前 `origin/main`（`f9742b2`，另一条会话修
锁屏指纹的那个提交）已经没有。也就是说这个句柄在基点上就存在、上游已修，本分支
rebase 到最新 main 之后会自然消失。测试全过、`pnpm check` exit=0，不阻塞交付。

## 未验证

- 模拟器端到端（注册拿码 → 点链接 → 唤起 App → 确认 → 绑定 → 管理端查到）未跑。
- `aapt dump xmltree` 未对新 APK 核对 intent filter；各租户 `assetlinks.json` 未逐个 `curl`。
- 真机未运行。

## 兼容、发布与回滚

- **发布顺序**：服务端（迁移 + 接口 + 落地页）→ 管理端 → App 全量包。落地页与 `assetlinks.json` 必须先在位：Android 在安装时校验域名归属，文件不在位这一版装上去就是未校验状态（2026-09-11 App Links 上线踩过）。
- **原生变更，必须出新 APK，不能 OTA。**
- bootstrap 加 `referral` 段对旧版 App 安全：顶层 schema 没加 `.strict()`，zod 对未知字段静默 strip（已核对 `bootstrap.schema.ts` 与 `package.json` 的 zod ^4.4.3）。但**已知字段的取值校验仍然严格**，所以服务端在写入时就拒绝越界值。
- 回滚：四个列留在库里不做反向迁移。因为 `invite_code` 永久可空，旧二进制回滚后登录不受影响。把 `referral.enabled` 改回 `false` 即可让功能对用户消失。
- **存量用户上线即窗口已关**：回填只发码不建关系，所有存量账号注册都已超过 7 天，只能走管理端补录。这是设计 D2 的自然后果，运营需提前知道。

## 同窗口必须一起上的事（本次未做）

设计 §6：注册链路三步（`installations/register`、`auth/nonce`、`auth/verify`）目前免鉴权、零限流，3 个请求就能造一个账号。邀请关系上线后，这条链路等于给 Sybil 关系树配了收益出口，而关系不可解绑、事后无法追溯清理。**给这两个接口加限流必须与本次同窗口上线。** 本次已经做的是留证：每条绑定把双方注册时间与间隔、IP、installation 复用情况写进 `audit_events.summary`。
