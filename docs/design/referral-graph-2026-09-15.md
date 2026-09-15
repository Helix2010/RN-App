# 邀请关系：一个跨模块复用的基础服务（2026-09-15）

- 状态：已决策（§9），待立项。本稿是四路对抗评审（范围 / 数据模型与并发 / 安全与滥用 / 客户端与发布）后的修订版，评审改动见 §10
- 范围：RN-Server（关系与接口）、RN-Admin（配置与查询）、RN-App（邀请页与深链）
- 关联：ADR `RN-Server/docs/decisions/0018-referral-graph.md`、字段语义 `RN-Server/docs/database/REFERRAL_SCHEMA.md`（两份随本稿一并产出）
- 依据：`RN-Server/AGENTS.md`「数据库表设计原则」「正式场景开发原则」、ADR 0012（地址即账号）、ADR 0014（设备聚合与封禁）、`docs/design/admin-list-pagination-2026-09-14.md`（列表契约）、`RN-App/docs/PRODUCT_EXPERIENCE_STANDARD.md`（页面状态与反馈）

## 1. 结论

1. **一期只做邀请关系，不做返佣。** 关系是一次性、不可变、需要长期可追溯的事实；返佣规则会反复改。本期只回答三个问题：我的邀请码是什么、谁邀请了我、我邀请了谁。文档里不出现任何金额口径。
2. **不建新表，但四列并入 `wallet_user` 有代价，代价写在 §3.2 和 §3.3。** `wallet_user` 有三个写方（登录、绑定、链上索引器），本设计必须正面处理并发，不能只靠一条条件更新。
3. **`invite_code` 永久可空。** 这不是妥协，是登录路径的 `ON DUPLICATE KEY UPDATE` 与第二个唯一键无法共存的必然结论（§3.3）。"人人有码"由注册事务保证，不由列约束保证。
4. **绑定按租户串行化。** 条件更新只保证"最多一个邀请人"，**不保证无环**；两个用户同时互扫对方的码会在零锁冲突的情况下造出环，而关系不可解绑，环就永久留下。
5. **接口不返回任何地址派生值。** 前 6 后 4 的脱敏地址是 32 bit，对任何现实候选集都等同于唯一键，把下级列表变成去匿名化接口。邀请人身份用邀请码表示，下级用每个观察者独立的别名。
6. **关系不可解绑，封禁不改变已有关系。** 封禁只影响能否新建关系。管理端只给补录，不给解绑。
7. **绑定要用户明确确认。** 绑定不可逆，深链带来的邀请码在登录后不自动提交。`PRODUCT_EXPERIENCE_STANDARD.md` §5 规定 Toast 只用于低风险瞬时反馈、Dialog 用于高风险确认。
8. **一期不做反作弊判定，但要留证。** 见 §6——这是本次评审翻掉的一条原结论，单独成节。

## 2. 现状（2026-09-15 核对）

### 2.1 可复用

| 事实 | 来源 |
|---|---|
| 地址即账号；首次 SIWE verify 成功即注册，语句是 `INSERT ... ON DUPLICATE KEY UPDATE` | `internal/api/wallet_auth.go:246-258` |
| 两级封禁（平台级 `platform_wallet_block` + 租户级 `wallet_user.status`） | `wallet_auth.go:181-184, 265-269` |
| 移动端鉴权范式 `authenticateWalletSession` + `domainTenantScope` | `wallet_auth.go:345`；范例 `wallet_transfers.go` |
| 管理端列表的键集分页与筛选契约 | `internal/api/list_page.go` |
| 管理端动作体解码（`reason` ≥ 3 字符 + `confirm=true`） | `wallet_users_admin.go:457` |
| 迁移的幂等加列 helper | `migrations.go:91` 的 `addColumnIfMissing` |
| 连接级 `GET_LOCK` 串行化的正确成例（`db.Conn()` 钉住连接） | `simplified_releases.go:358-368` |
| 审计写入 helper；动作命名参照 `wallet_user_block` | `release_identity.go:132` |
| 按 IP 小时窗口限流器 与 租户日配额常量 | `diagnostics.go:76-112`、`:44-51` |
| 服务端按 Host 解析租户并返回 JSON/HTML | `server.go:159-161`、`:479-481` |
| **bootstrap schema 不严格**：顶层未加 `.strict()`，zod ^4.4.3 对未知字段静默 strip | `core/config/bootstrap.schema.ts`、`package.json:88` |
| MySQL 8.x，已在用 `LEFT JOIN LATERAL`（需 ≥ 8.0.14） | `docs/ARCHITECTURE.md:22`、ADR 0003、`wallet_users_admin.go:322` |

倒数第二条是本设计成立的前提：给 bootstrap 加 `referral` 段不会让旧版 App 整份配置失效。**但已知字段的取值校验仍然严格**——新版 App 一旦为 `referral` 定义取值范围，服务端下发越界值会让新版 App 整份 `safeParse` 失败。所以服务端必须在写入时拒绝越界值（§3.6），不能指望客户端容忍。

### 2.2 `wallet_user` 的三个写方

这是本设计最重要的约束，原稿漏了第三个：

| 写方 | 语句 | 影响 |
|---|---|---|
| 登录 | `INSERT ... ON DUPLICATE KEY UPDATE`（`wallet_auth.go:248`） | 决定 `invite_code` 不能进这条语句，见 §3.3 |
| 绑定 | 本设计新增 | 需要与下面一条避免交叉加锁 |
| 链上索引器 | 一个事务里按 **Go map 随机顺序** 批量 UPDATE（`indexer/store.go:370-382`） | 顺序不定，与逐行 `FOR UPDATE` 组合必然死锁 |

`AGENTS.md` 允许"合并进同实体的表"的是**只有一个写方**的运行状态（如 `scan_state`）。这四列不满足那一条，因此本设计不引用它作为依据；依据是"严格 1:1 属性，单独建表等于给 `wallet_user` 做 1:1 拆分"，而并发代价由 §3.4 单独付。

### 2.3 待补的客户端基建

- 「邀请返佣」三处入口全是占位：首页快捷格无 `onPress`（`foundation-home-screen.tsx:324-328`），个人中心两行点击弹空态 toast 且**写死"已邀请 12 人"**（`profile-screen.tsx:170-180, 270-277`）。
- App **没有任何入站深链监听**。全仓只有 `Linking.openURL` / `openSettings`。这套要新建（§5.3）。
- App Links 只声明了 `/app/wc`，且整块 intentFilters 挂在 `walletConnectRedirectUrl` 存在的条件下（`app.config.ts:174, 225-242`）。要拆开并加新路径（§5.4）。

## 3. 数据与并发

### 3.1 复用映射表

| 初稿拟建表 | 处理 | 理由 |
|---|---|---|
| `referral_code` | **合并**进 `wallet_user` | 一人一码、随账号生随账号灭 |
| `referral_relation` | **合并**进 `wallet_user` | 严格 1:1 且不可改。单独建表要自己维护"最多一行"，而列上的 NULL 天然表达它 |
| `referral_bind_log` | **复用** `audit_events` | 绑定是可审计事件，既有表字段正好够用；§6 还要往 `summary` 里存留证信号 |
| `referral_config` | **复用** `app_configs` | 租户配置的既定去处，且要随 bootstrap 下发 |
| `referral_stats` | **取消** | 直接下级数由索引 `COUNT(*)` 得到，计数列是第二份真相 |

新增 **0 张表、4 个列、3 个索引**。

**拆表的临界点**（必须写进设计，否则默认路径就是继续往登录热表上堆 NULL 列）：关系需要任何非 1:1 属性（活动 id、等级、分成比例、结算状态）、需要历史或版本、或需要第二个邀请维度时就拆。**返佣立项几乎必然触发第一条。**

### 3.2 四列与三索引

字段语义见 `REFERRAL_SCHEMA.md`。要点：

- `invite_code CHAR(8) NULL`（**永久可空**，理由见 §3.3）
- `inviter_user_id BIGINT UNSIGNED NULL` / `invited_at DATETIME(3) NULL` / `invite_source ENUM('code','link','admin') NULL`，三者同生共死，由 **CHECK 约束**强制（MySQL 8.0.16+ 生效），不只是应用层约定

索引三个，不是两个：

| 索引 | 用途 |
|---|---|
| `uq_wallet_user_invite_code (tenant_id, invite_code)` | 码唯一。可空列上多个 NULL 不冲突，这正是 §3.3 需要的 |
| `ix_wallet_user_inviter (tenant_id, inviter_user_id, invited_at, id)` | 移动端"我的下级"。实测 `range + Backward index scan`，无 filesort |
| `ix_wallet_user_invited_at (tenant_id, invited_at, id)` | **管理端关系列表**。它没有 `inviter_user_id` 等值条件，上一个索引第二列断开，实测走 filesort、rows≈9918 |

### 3.3 为什么 `invite_code` 必须永久可空

登录语句是 `INSERT ... ON DUPLICATE KEY UPDATE`。MySQL 对**任意**唯一键冲突都会触发 ON DUPLICATE 分支。实测结果：

- 若把 `invite_code` 放进这条 INSERT，新用户抽到的码撞上他人的码时，MySQL 去更新了**那一行**（`address` 被改成新用户的地址，`ROW_COUNT()=2`）；随后按 `address_key` 查不到自己 → 500。
- 更关键：ODUP **不抛 1062**，所以"碰撞由唯一键兜底、失败后重试"这个策略在这条语句上根本不成立，没有可捕获的错误。
- MySQL 官方把"多唯一键上的 ODUP"列为非确定性、statement-based 复制不安全。

若改成 `NOT NULL`（无论有没有 DEFAULT）：

- 无 DEFAULT：服务端回滚到旧二进制后，旧 INSERT 不带该列，strict 模式实测 `ERROR 1364 Field 'invite_code' doesn't have a default value` → **老用户也登不上**，回滚等于全站登录中断。
- `DEFAULT ''`：两个并发新用户都插 `''`，在唯一键上冲突，又回到上面那个改错行的问题。

所以：**列永久可空，`invite_code` 不进登录 INSERT。** 注册事务里在 upsert 之后补一条

```sql
UPDATE wallet_user SET invite_code=? WHERE id=? AND invite_code IS NULL
```

它会抛真正的 1062，可以捕获后换码重试。候选码在 `BeginTx` **之前**预抽 3 个——该事务已持有 nonce 行的 `FOR UPDATE` 锁并跨越 `siwe.Verify`，不该再被生成逻辑延长。

"人人有码"这条不变量由注册事务保证：提交后不存在无码的行。这不是兜底分支，因为它没有"没有码时换个行为"的读路径——读到无码行就是事故，按正式场景原则报错。

碰撞数字：空间 32⁸ = 1.0995×10¹²。抽取次数 = **注册次数**（不是登录次数，因为码不再进 ODUP）。单次失败率 = N/1.1×10¹²，N = 10 万时 9.1×10⁻⁸，重试 3 次的连续失败概率 7.5×10⁻²²。

### 3.4 绑定：按租户串行化

**条件更新不保证无环。** `BeginTx(ctx, nil)` 是默认 REPEATABLE READ，事务内普通 SELECT 走快照，看不到并发已提交的写。A、B 互扫对方码的交错：

1. T1 快照：A.inviter=NULL, B.inviter=NULL；从 B 上溯 → 到根 → 通过
2. T2 快照同上；从 A 上溯 → 到根 → 通过
3. T1 `UPDATE A SET inviter=B WHERE inviter IS NULL` → 1 行
4. T2 `UPDATE B SET inviter=A WHERE inviter IS NULL` → 1 行
5. 两者提交

两个事务改的是**不相交的两行，零锁冲突、零死锁**。这不是罕见竞态，任意一对用户同时互绑就成立。而 §1.6 不给解绑，环永久留下：`ancestorsOf` 返回 A,B,A,B…（靠上界才不死循环），日后按层级的任何计算都错。

**方案**：绑定前用 `db.Conn()` 钉住连接取 `GET_LOCK('rn_referral_bind_<tenant>', 5)`，同租户绑定串行执行，照 `simplified_releases.go:358-368` 的成例。绑定一生一次，串行化零成本。

不选逐跳 `SELECT ... FOR UPDATE`：它虽然能读到最新已提交版本，但会与索引器的**随机顺序批量 UPDATE**（§2.2）形成交叉加锁顺序，必然死锁；而且上溯 N 跳意味着锁持有 N×RTT，正落在索引器批次窗口里。

实现注意：**不要照抄 `migrations.go:977-980`** 的 GET_LOCK 写法——那里在连接池上取锁、在 defer 里可能用另一条连接 RELEASE，释放会落空（需核对）。必须 `db.Conn()` 钉住同一条连接。

上溯本身用应用层循环做单行主键查询，上界是**服务端内部常量且取个位数**（不是租户配置——本期没有任何功能按层级分叉，运营无法判断该填几）。递归 CTE 在 MySQL 8.x 上可用（仓库已用 `LEFT JOIN LATERAL`），选循环的理由是可测、边界显式，不是版本限制。

### 3.5 迁移：四个版本，不是四条语句

实测：把 `ADD COLUMN invite_code CHAR(8) NOT NULL` 与 `ADD UNIQUE KEY` 写在同一条 ALTER 里，已有行填 `''`，报 `Duplicate entry '1-' for key ...`，`Migrate` 失败 → **服务起不来**。而且不幂等：拆成"先 ALTER 后回填"时 ALTER 已自动提交，回填失败后重启报 `Duplicate column name`，**永久无法启动，必须人工改库**。

四个独立迁移版本，每步幂等：

1. `addColumnIfMissing` 加四列（全部可空）
2. 回填邀请码（`WHERE invite_code IS NULL`，可重复执行）
3. 加三个索引（先查 `INFORMATION_SCHEMA.STATISTICS`）+ CHECK 约束
4. —— **没有第四步**。`invite_code` 不收紧为 `NOT NULL`（§3.3）

这就是 `AGENTS.md` 要求的 expand/migrate/contract，只是 contract 这一步本设计明确不做。

回填规模与在线 DDL 的锁影响按实际行数评估。**"线上只有个位数用户"不能写进迁移**：任何测试库、任何租户长到 2 人，同一条语句换个环境就炸。

### 3.6 租户配置

并入 `app_configs` 的 `mobile-bootstrap`：

```json
"referral": { "enabled": true, "bindWindowHours": 168 }
```

只有两个旋钮。写入时校验（非法值 400，说清哪个键、填了什么、期望什么），读路径不修复。`bindWindowHours` 取值 1–8760，越界拒绝——这不只是防呆，新版 App 的 schema 会校验取值，下发越界值会让新版 App 整份配置失效（§2.1）。

声明式默认（未配置时 `enabled=false`、`168`）写进 `docs/CONFIGURATION.md`，管理端显示实际生效值。默认关闭是因为它会在 App 上多出一个入口，该由运营明确打开。

bootstrap 额外下发 `inviteLinkBase`（`https://<租户 API 域名>/app/invite/`），由服务端算，App 不自己拼。

**`enabled` 由 true 改回 false 之后**（这也是 §8.3 的回滚手段，行为必须定义）：关系数据原样保留；`POST /bind` 与管理端补录都返回 403；`GET /referral/me`、`/invitees` 照常返回（关掉的是"继续发展新关系"，不是"抹掉历史"）；**App 入口不显示**，后果是已绑用户在 App 里看不到自己的邀请人；管理端列表照常可查。入口随开关消失是有意的产品选择，运营需要知道这个后果。

## 4. 接口

### 4.1 绑定条件

| # | 条件 | 不满足 | HTTP | 补录豁免 |
|---|---|---|---|---|
| 1 | 租户已开启邀请 | `REFERRAL_DISABLED` | 403 | 否 |
| 2 | 邀请码格式合法（归一化后 8 位且在字母表内） | `REFERRAL_CODE_MALFORMED` | 422 | 否 |
| 3 | 邀请码存在且属本租户 | `REFERRAL_CODE_UNKNOWN` | 404 | 否 |
| 4 | 自己尚未绑定 | `REFERRAL_ALREADY_BOUND` | 409 | 否 |
| 5 | 不是自己的码 | `REFERRAL_SELF` | 422 | 否 |
| 6 | 在绑定窗口内 | `REFERRAL_WINDOW_CLOSED` | 409 | **是** |
| 7 | 邀请人未被封禁（两级） | `REFERRAL_INVITER_BLOCKED` | 403 | 否 |
| 8 | 绑定后不成环、链路未超上界 | `REFERRAL_CYCLE` | 422 | 否 |

条件 2 与 3 必须分开：前者是用户输错、提示重新输入，后者是码无效、提示向邀请人核对。合并成一个码，文案只能说一句含糊的话。

窗口是唯一对补录豁免的——补录存在的意义就是处理过期的存量。

条件更新影响 0 行时，同事务内 `SELECT inviter_user_id ... FOR UPDATE` 区分两种情况：如果是"上溯通过后被人抢先绑定"，说明防环结论已失效，**除了返回 409 还要告警**，不能静默当成普通的"已绑定"。

### 4.2 移动端

全部走 `domainTenantScope()`；除 `codes/:code` 外都要 `authenticateWalletSession`。

| 接口 | 出参 |
|---|---|
| `GET /v1/mobile/referral/me` | `inviteCode`、`inviteLink`、`inviter`（**只有 `inviteCode` 与 `boundAt`**，未绑定为 null）、`bindWindow`（`open` + `closesAt`）、`inviteeCount` |
| `POST /v1/mobile/referral/bind` | 入参 `{code, source}`，`source` 只接受 `code` / `link`；`code` 提交**原文**由服务端归一化 |
| `GET /v1/mobile/referral/invitees` | 直接下级，键集分页 `(invited_at DESC, id DESC)`，查询**必须带 `inviter_user_id IS NOT NULL`**；每项只有 `alias` 与 `joinedAt` |
| `GET /v1/mobile/referral/codes/:code` | **免登录**、限流；**只返回 `{valid}`** |

**接口不返回任何地址派生值**，这是本次评审改掉的最大一处。`shortenAddress(addr, 6, 4)`（`core/i18n/format.ts:189`）输出 8 个 hex nibble = **32 bit**；候选集 10⁶ 时期望碰撞 2.3×10⁻⁴，也就是说对任何现实候选集，脱敏地址就是唯一键，拿去公链索引器一查就还原出完整地址、余额、交易史。原稿"完整地址一概不给"的隐私论断不成立。

替代：

- **邀请人身份用邀请码表示。** 用户本来就是拿着那个码来的，回显码是最自然的确认，且零泄露。
- **下级用 `alias`**：`HMAC(tenant_secret, viewer_id ‖ invitee_id)` 取 6 字符，每个观察者看到的别名不同，无法跨账号 join、无法反查地址。配合加入时间足以满足"看到我邀请了谁"。
- **`codes/:code` 只返回 `{valid}`**，不返回任何邀请人信息。落地页显示"这是一个有效的邀请码"+ 码本身 + 下载引导。

这样该接口就从"码 → 32 bit 地址指纹的 oracle"降级成"码是否有效"，它的风险来自返回什么，不是来自能被试多少次。

**盲枚举本来就不是可行攻击**：命中率 N/1.1×10¹²，N=10⁵ 时估算用户规模到 ±30% 约需 1.1×10⁸ 次请求（1000 rps 约 30 小时、约 20 GB 流量）。原稿把"防止拿它枚举"当成该接口的主要风险，是把防护投到了没有收益的方向。

### 4.3 限流（具体阈值）

复用 `diagnosticIPLimiter` 的窗口计数形态（`diagnostics.go:76-112`，既有 `diagnosticIPPerHour = 20`）。**该限流器在内存里、按实例计数，只挡单一来源**——如实记录，不假装它是强闸。

| 目标 | 阈值 |
|---|---|
| `GET /v1/mobile/referral/codes/:code` | 30 次/小时/IP，突发 10 次/分钟 |
| `GET /app/invite/:code`（落地页） | **与上一条共用同一个计数器**。两者是同一个 oracle，分开计等于限流白做 |
| 上面两者里的**未命中** | 独立的更严子配额 10 次/小时/IP，超出则该窗口内全部 429。真实用户几乎不会未命中，扫描器 100% 未命中，两类人群在这个阈值上干净分离（照 `failedLogin` 只计失败的既有做法，`server.go:584`） |
| 租户级底线 | 未知码查询 50,000 次/天/租户 → **告警不阻断**，形态照 `diagnosticTenantPerDay` |
| `POST /v1/mobile/referral/bind` | 5 次/小时/会话、20 次/小时/IP |

### 4.4 管理端

| 接口 | 说明 |
|---|---|
| `GET /v1/admin/referral/relations` | 键集分页 `(invited_at DESC, id DESC)`，走 `ix_wallet_user_invited_at`，查询**必须带 `inviter_user_id IS NOT NULL`**；筛选 `inviterAddress` / `inviteeAddress` / `source` / `from` / `to`；返回 `total`；行内标注双方封禁状态。管理端返回完整地址（有权看） |
| `POST /v1/admin/referral/bind` | 见下 |
| `GET /v1/admin/wallet/users/:id` | **扩展既有响应**，加 `referral: { inviteCode, inviter, inviteeCount }` |

补录是全文影响最大的一个入口，因为它豁免窗口，而窗口是"存量用户能被追溯挂多少"的唯一上界，再叠加关系不可解绑，**一次脚本化误用永久不可回滚**。当前管理端凭证是全平台唯一一份（`config/config.go:123-124`，不分租户），租户隔离只在 Host 头这一层（`server.go:224` 的 `domainTenantScope()`），且除登录外管理端全线无限流（`rateLimited` 只在 `server.go:539` 被调用一处）。"不提供批量导入"不是控制，`for` 循环里的 curl 就是批量导入。

因此补录必须同时满足（都在当前阶段不引入 RBAC / 双人审批的前提内）：

1. 走 `decodeAdminAction`，**`confirm=true`** 且 `reason` ≥ 3 字符
2. 带 `expectedInviteeState`：被邀请人当前 `inviter_user_id` 必须为 NULL，做乐观锁
3. **租户级日配额**（建议 20 条/天/租户，超出 429 + 告警），形态照 `diagnosticTenantPerDay`
4. `x-admin-key` 通道（`server.go:507`，长期有效、不绑账号、仅 IP 白名单）对该路由直接 **403**——自动化没有补录需求

补录的失败面要全部定义：

| 情形 | 错误码 | HTTP |
|---|---|---|
| 被邀请人地址在本租户没有 `wallet_user` 行（**最常见：人还没登录过**） | `REFERRAL_INVITEE_UNKNOWN` | 404 |
| 邀请人地址不存在 | `REFERRAL_INVITER_UNKNOWN` | 404 |
| `inviterCode` 与 `inviterAddress` 同时给或都不给 | `INVALID_ACTION` | 422 |
| 被邀请人已绑定（乐观锁失败） | `REFERRAL_ALREADY_BOUND` | 409 |

第一条文案要直接说"该地址还没在本租户登录过"——账号在**首次登录时**才创建。

### 4.5 日志与审计

路由是 `gin.New()`（`server.go:130`），中间件只有 `Recovery, requestContext, databaseTimeout, securityHeaders, cors`（`:136`）——**全仓无访问日志中间件**；`problem()`（`:1966`）不写日志；`insertAudit` 只在成功路径调用。照原稿，失败绑定与 100% 的枚举流量在应用层零记录，不仅追不了责，连"是否正在被枚举"都无数据可判。

因此：

- `codes/:code` 未命中、`bind` 的八类拒绝各记一条结构化 `slog.Warn`（tenant、clientIP、requestId、错误码；**不记完整邀请码**）。既有代码对 admin-key 误用就是这么记的（`server.go:510, 517`），范式现成。
- 触发限流时额外写一条 `audit_events`（`actor_id='system-referral'`、`action='referral_enumeration_throttled'`），进入既有管理端审计视图。
- 绑定成功写 `audit_events`，`summary` 内容见 §6。

### 4.6 落地页

`GET /app/invite/:code` — HTML，按 Host 解析租户，显示"有效的邀请码"+ 码（分段展示、可复制）+ 下载引导。租户未开启或码不存在时返回 404 页面，不透露"这个租户存在但没开"。与 `codes/:code` 共用限流计数器（§4.3）。

## 5. App

### 5.1 页面

新 feature `src/features/referral/`，路由 `Referral` 加进 `navigation/types.ts`。

1. **我的邀请码** — 大字、分段显示 `ABCD-1234`、可复制；下面一行邀请链接，右侧复制与系统分享
2. **二维码** — 内容是邀请**链接**，任何相机扫到都有去处
3. **我的邀请人** — 已绑定显示绑定时所用的**邀请码**与时间；未绑定且窗口未关，显示输入框 + 剩余时间；窗口已关显示说明
4. **我的邀请记录** — 下级列表，显示别名与加入时间

页面状态按 `PRODUCT_EXPERIENCE_STANDARD.md` §4 全套落实。除常规四态外必须显式覆盖一个分支：**客户端认为启用、服务端拒绝**。bootstrap 允许网络异常时沿用上一份成功快照，所以租户刚关闭邀请时设备缓存里可能还是 `enabled=true`，用户能看到入口、调 `/bind` 却被 403。这时如实呈现"该功能已关闭"，不是裸 toast 也不是通用错误。

### 5.2 一期不做 App 内扫码

二维码只做展示。理由：

- 二维码内容是链接，**任何相机**（含系统相机）扫到都经 App Links 落回 App，能力不缺。
- `AddressScanner` 并不通用：硬编码 7 个 `send.*` i18n 键（`address-scanner.tsx:131-189`），而 `app.config.ts:253-254` 的相机权限系统文案写死 "scan wallet address QR codes"，通用化是**原生 Manifest 级改动**。为一个能力已被覆盖的入口付这个代价不值。
- 少一个入口也让 `invite_source` 不必区分"扫码"与"点链接"——两者本来就是同一条深链路径。

`AddressScanner` 保持在 `features/assets/ui/` 不动。

### 5.3 深链

新建 `src/core/deep-link/`：`getInitialURL()`（冷启动）+ `Linking` 的 `url` 事件（热启动），**统一一个 dispatcher**，`/app/wc`（WalletConnect 回跳）与 `/app/invite/` 在同一处按路径分发，不起两套并行监听。

| 到达时状态 | 行为 |
|---|---|
| bootstrap 未就绪 | 暂存，等配置到位再处理（要判断 `referral.enabled`） |
| App Lock 锁屏中（`app-lock-gate.tsx` 的全屏 Modal） | 暂存，解锁后再处理 |
| 未登录 | 暂存，拉起登录 sheet；登录成功后进入确认流程 |
| 已登录且未绑定 | 进入确认流程 |
| 已绑定 / 窗口已关 / 码无效 | 进邀请页给出说明，清除暂存，不静默吞掉 |

**确认流程**：弹 Dialog 展示"你将把邀请码 ABCD-1234 的持有者设为你的邀请人，**绑定后永久不可更改**"，带明确的拒绝按钮，用户确认后才调 `/bind`。用户在深链里同意的是"登录"，不是"永久挂在一个陌生人名下"——群里一条链接加一次本来就要做的登录就能完成绑定，这是成本最低、收益最大的一道闸。

暂存（`foundation.referral.v1`，AsyncStorage + zustand persist，与 `foundation.preferences.v1` 同规范；应用私有目录且 `allowBackup: false`，非 root 设备上其他应用读不到）：

| 情形 | 行为 |
|---|---|
| **有效期** | **30 分钟**，不是 `bindWindowHours`。深链的正常路径是"点了就登录"；存 7 天等于留一个攻击者可控的输入，在用户早已忘记的某次登录上生效 |
| 先后收到两个码 | 后到覆盖先到 |
| 暂存期间登录的是另一个账号 | 暂存码与账号无关，给当前登录的账号用 |
| 自动提交撞上已绑 / 窗口关 / 码无效 | 一律清除暂存并给出说明，不保留重试 |
| 多设备各自暂存，另一台已绑后本机 409 | 清除暂存，显示"你已经绑定了邀请人"并展示当前邀请人 |

暂存的写入与消费各记一条本地事件，便于事后排查。

### 5.4 原生变更

`app.config.ts` 的 Android intentFilters 增加邀请路径，并把整块从「`walletConnectRedirectUrl` 存在才生成」里拆出来——邀请路径不该依赖 WalletConnect 是否配置。

两个必须注意的点：

- **`pathPrefix` 写 `"/app/invite/"`（带尾斜杠）**。现有写法是 `pathPrefix`（`app.config.ts:227-240`），前缀匹配会把 `/app/invitexyz` 也吃进来。
- 拆分后，**未配 WalletConnect 的租户会首次获得 `autoVerify` 的 intent filter**，系统安装时会去校验其 `assetlinks.json`。该文件依赖 `release.android` 发布身份（`release_identity.go:350-358`，未登记返回 404），任何能出 APK 的租户都已具备；但上线前要对每个目标租户实际 `curl` 确认。校验失败时 Android 退回选择框，此时任何声明了同 URL 的应用都会出现在列表里。

深链归属本身是可靠的：`assetlinks.json` 由租户登记的 `release.android` 直接生成，服务端拒绝登记 RN 公共 debug 指纹（`release_identity.go:75`），release 构建拒绝 debug keystore（`android/app/build.gradle:110-113`）。抢注不了。

**这是原生变更，必须出新 APK，不能 OTA。**

### 5.5 占位接线与文案

- 首页 `home-quick-actions` 的 invite、`profile-referral`、`profile-referral-row` → `navigate("Referral")`
- `profile.referralCount` 的写死 `12` 换成真实 `inviteeCount`
- `home.quick.invite`、`profile.referral`：邀请返佣 → **邀请好友**；一期不出现任何收益字样
- 新增 `referral.*` 一组键

改完跑 `node scripts/export-i18n-seed.mjs`。`pnpm i18n:check` 是 `pnpm check` 门禁项，漏加键会被挡住。**但"服务端同步文案种子"在仓库里找不到对应自动化脚本**，需确认是不是纯人工步骤；若是必须写进发布检查项——漏做会让服务端字典缺键，线上文案不一致。

## 6. 滥用：一期不判定，但必须留证

原稿写的是"一期关系没有金钱价值，拦截收益为零"。这句**漏算了时间**：攻击者的收益不在一期，在返佣上线之后；而关系是**在一期以零成本预置**的。

注册链路实测三步全部免鉴权、零限流：

1. `POST /v1/mobile/installations/register`（`installations.go:66`）——`installationId` 与 `deviceSourceHash` 均由客户端自报
2. `POST /v1/mobile/auth/nonce`（`wallet_auth.go:105`）——每次还 INSERT 一行，清理是同调用里的 `DELETE … LIMIT 500`（`:139`），突发写入跑得比清理快
3. `POST /v1/mobile/auth/verify`——只需对返回的 SIWE 消息做一次本地签名

也就是 **3 个 HTTP 请求一个账号**，无验证码、无 PoW、无限流。单 IP 200 rps 约 67 账号/秒。整棵 Sybil 树免费成型，每个账号注册即得邀请码。

而"返佣上线时再追溯清理"**在结构上做不到**：关系不可解绑（§1.6，D4 已否决解绑），`wallet_user.status='blocked'` 也不清除 `inviter_user_id`。返佣模块只能另建一张抑制名单——正是 §3.1 花整节避免的"第二份真相"。

本期能做、也必须做的三件事：

1. **绑定时把风控信号落进 `audit_events.summary`**：注册 IP / ASN、注册时间、installation 复用情况、双方注册时间间隔。关系不可改，但事实可以留证，这是唯一还来得及做的事——等返佣立项再想采集，这批数据已经永久缺失。
2. **给 `installations/register` 与 `auth/nonce` 加限流**。这比限流 referral 接口重要得多：它是整条 Sybil 链路的入口。**这是本设计范围之外的改动，但必须与本设计同窗口上线**，否则本设计等于给一条免费的注册流水线配上了收益出口。
3. **ADR 里写明"返佣上线前的存量处置"**：抑制名单由返佣模块持有，与关系表的优先级关系提前约定；不要等到那时才发现关系改不动。

设备标识本身仍不参与判定（ADR 0014 §3），本期也不做 `sameDeviceAsInviter` 标记——它没有消费方。但上面第 1 条的信号采集是留证，不是判定，两者不冲突。

## 7. 给后续返佣留的口子

只说明口子为什么这么留，不展开方案：

- `ancestorsOf(tenant, userID, levels)`：就是 §3.4 上溯的同一份实现
- `invited_at`：分期锚点
- 关系不可解绑：账本可以安全引用关系而不必快照
- `audit_events` 里的绑定留证：返佣上线时判定滥用的唯一数据来源（§6）

返佣的金额口径不在本文范围，返佣立项时单独调研。

## 8. 测试与发布

### 8.1 测试

- **服务端单测**：邀请码字母表与长度、归一化五步（全角、分隔符、大小写、`I L O` 映射、`U` 拒绝）、`MALFORMED` 与 `UNKNOWN` 的区分、上溯防环、窗口判定边界、全部错误码映射、响应中不含任何地址派生值、配置越界拒绝、限流阈值。
- **服务端库测**（`TestDB…`，需 `RN_TEST_MYSQL_DSN`）：
  - 四个迁移版本逐个执行 + **重复执行**（幂等）+ 中断后重跑
  - 注册事务里的换码重试（造一次真实 1062）
  - **并发互绑不成环**（这条是 §3.4 的回归测试，必须真并发）
  - 并发绑定只成功一次
  - 键集分页翻完不重不漏，且 `total` 与可翻页数一致（验证 `inviter_user_id IS NOT NULL` 这条）
  - CHECK 约束确实拒绝三列不一致的行
- **RN-App**：`pnpm check` 全绿。渲染测试覆盖邀请页各状态、深链在锁屏 / 未就绪 / 未登录下的暂存与恢复、确认 Dialog 的拒绝路径、暂存 30 分钟过期、"客户端认为启用但服务端 403"分支。
- **RN-Admin**：关系列表筛选随 URL 恢复、补录表单 `reason` 必填与 `confirm`、四种补录失败文案、日配额超限提示。
- **端到端**（模拟器 + `rwa_test2`）：A 注册拿码 → B 装机点 A 的链接 → 系统唤起 App → B 登录 → **弹确认 Dialog** → 确认后绑定 → A 的邀请页看到一条别名记录 → 管理端看到这条 → B 再绑返 409 → C 绑 B 后再拿 A 的码绑返 422 成环 → 超窗口用户绑返 409、管理端补录成功并留审计 → 补录一个没登录过的地址返 404 且文案正确 → 租户关闭邀请后入口消失、管理端仍可查。
- `aapt dump xmltree` 确认新 APK 里有 `/app/invite/` 的 `autoVerify` intent filter 且原 `/app/wc` 仍在；`curl` 确认每个目标租户的 `assetlinks.json` 与落地页可访问。

### 8.2 存量用户

回填只发码、不建关系。**所有存量用户注册都已超过 7 天，窗口已关，只能走管理端补录。** 这是 D2 的自然后果（否决"永远可补绑"就意味着否决"给存量用户重开窗口"），不是缺陷，但运营必须提前知道，否则会当 bug 报。

### 8.3 发布与回滚

顺序：服务端（迁移 + 接口 + 落地页 + §6 的注册限流）→ 管理端 → App 全量包。

落地页与 `assetlinks.json` 必须先在位：Android 在**安装时**校验域名归属，文件不在位这一版装上去就是未校验状态，要等系统下次重试。2026-09-11 那次 App Links 上线踩的就是这个顺序。

发布窗口期内还没升级的用户点邀请链接：系统未校验新路径，链接落到浏览器的**落地页**，可以看到邀请码并手动输入。这条路径要实际验证。

回滚：四个列留在库里不做反向迁移（迁移只向前）。因为 `invite_code` 永久可空（§3.3），**旧二进制回滚后登录不受影响**——这正是不把它收紧为 `NOT NULL` 的直接收益。App 回退 APK；把 `referral.enabled` 改回 `false` 即可让功能对用户消失，行为见 §3.6。

## 9. 决策记录

用户决策（2026-09-15）：

| # | 决策 | 备选与否决理由 |
|---|---|---|
| D1 | 一期只做邀请关系，做成基础通用服务 | 关系与返佣一起做会让关系随规则改动而改动 |
| D2 | 绑定窗口 = 注册后 7 天（租户可配） | 「仅注册当次」会让深链丢失或先装后拿码的用户永久绑不上；「永远可补绑」会在返佣上线后产生"老用户突然有了上级"的分成争议 |
| D3 | 邀请入口一次做全，含 App Links 深链，直接出新 APK | 分两步可以更快上线，但用户选择一次到位 |
| D4 | 管理端只能补录，不能解绑 | 解绑会让后续返佣账本引用的关系可变，历史无从对账 |
| D5 | 文案改「邀请好友」，一期不出现收益字样 | 保留"邀请返佣"+"即将开放"等于对用户做还没做的承诺 |

设计决定（实施时可再议）：

| # | 决定 |
|---|---|
| D6 | 上溯上界改为服务端常量且取个位数，不做租户配置 |
| D7 | 绑定前必须弹 Dialog 确认；深链暂存 30 分钟 |
| D8 | 一期不做 App 内扫码，二维码只展示 |
| D9 | 封禁不改变已有关系 |
| D10 | `invite_code` 永久可空，不进登录 INSERT |
| D11 | 绑定按租户 `GET_LOCK` 串行化，不用行锁 |
| D12 | 移动端接口不返回任何地址派生值 |
| D13 | 注册限流与绑定留证与本设计同窗口上线 |

## 10. 评审改动（2026-09-15，四路对抗评审）

| 原稿 | 改为 | 依据 |
|---|---|---|
| 迁移写成一条 ALTER | 四个独立幂等迁移版本，且不收紧 `NOT NULL` | 实测 ERROR 1062；回滚实测 ERROR 1364 |
| `invite_code NOT NULL`、碰撞由唯一键兜底 | 永久可空、移出登录 INSERT、单独 UPDATE 后捕获 1062 重试 | ODUP 在多唯一键下会改错行且不抛 1062 |
| 条件更新即可保证正确 | 增加按租户 `GET_LOCK` 串行化 | REPEATABLE READ 快照下互绑造环，零锁冲突 |
| 2 个索引 | 3 个索引 | 管理端列表实测 filesort |
| 三列同生共死是应用层约定 | 加 CHECK 约束，查询显式带 `IS NOT NULL` | NULL `invited_at` 会让 `total` 与可翻页数对不上 |
| 接口返回脱敏地址、"隐私已保护" | 不返回任何地址派生值；邀请人用码、下级用 per-viewer 别名、`codes/:code` 只返回 `valid` | 前 6 后 4 = 32 bit，对现实候选集等同唯一键 |
| "防止拿它枚举"是主要风险 | 盲枚举不可行；真实风险是返回内容 | 命中率 N/1.1×10¹²，估算规模需 ~10⁸ 请求 |
| 补录只要 reason | 加 `confirm`、乐观锁、租户日配额、禁 `x-admin-key` | 全平台单份管理凭证 + Host 头隔离 + 管理端无限流 + 不可解绑 |
| 一期不做反作弊「收益为零」 | 改为不判定但必须留证，并要求注册限流同窗口上线 | 3 请求/账号、零限流；关系不可解绑使事后清理在结构上不可能 |
| 深链暂存 `bindWindowHours` | 30 分钟 | 7 天的攻击者可控输入会在用户忘记的某次登录上生效 |
| `pathPrefix: "/app/invite"` | 带尾斜杠 | 前缀会匹配 `/app/invitexyz` |
| 失败与枚举无日志 | 失败记 `slog.Warn`，限流写 `audit_events` | 全仓无访问日志中间件，否则零记录 |
| 用循环是因为"MySQL 版本未确认" | 版本是 MySQL 8.x（已在用 `LEFT JOIN LATERAL`）；选循环的理由是可测、边界显式 | 事实更正 |
| 删除：返佣手续费口径、iOS AASA、DEX、设备标记、返佣侧拦截论证 | 移出本期 | 不服务于本期三个问题 |

## 11. 范围边界

- **返佣的金额口径**：不在本期，返佣立项时单独调研。
- **iOS 深链**：不在本期，仓库尚无 Apple Team ID 与签名体系。
- **注册链路限流**：不属于邀请关系，但必须与本设计同窗口上线（§6）。
