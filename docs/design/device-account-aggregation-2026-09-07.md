# 设备、账号与版本信息的管理端聚合设计（2026-09-07，v2 已决）

需求来源：2026-09-07 与用户的四轮讨论。本稿是对讨论中口头方案的评审与完善，
评审改动见 §7。服务端决策摘要在 RN-Server `docs/decisions/0014-device-account-aggregation.md`。

## 0. 需求回顾

1. 管理端能看到设备上报的账号信息。
2. 同一台设备上的多个账号要聚合；卸载重装要归到同一台设备。
3. 设备上 App 的版本信息：APK 版本 / 构建号、runtime、OTA（正在运行的、可用的）。
4. 标记当前活跃的账号。
5. 同一个账号可能在不同租户下使用。
6. 约束（用户既有规则）：先复用再建表；每表每列 COMMENT；不写兜底，缺失或不符即失败，只允许声明式且管理端可见的默认；签名密钥测试阶段不换（正式包时再换，设备标识会重置一次）。

## 1. 目标 / 非目标

目标：管理端能回答五个问题——这版 OTA 生效了多少设备、还有多少待生效；某账号在哪些设备上、当前在哪台；某设备上有哪些账号、当前是哪个；某地址跨租户的全貌（仅平台管理员）；活跃账号数与活跃设备数（1d / 7d / 30d）。

非目标：不合并跨租户的资产或预测平台数据（代理钱包按租户隔离，聚合只做识别）；不记录 IP 与地理位置；不把设备标识用于任何安全判定；不做实时在线状态（以心跳与会话最近使用时间为准）。

## 2. 事实（2026-09-07 核对）

### 2.1 可复用

- `wallet_user`：租户内地址即账号（唯一键 tenant + address_key），有首次 / 最近登录、登录次数、`status('active','blocked')`。
- `wallet_session`：每次登录一条，`connector`、`chains`、`issued_at / expires_at / last_seen_at / revoked_at`，`installation_id`（1.2.9 起登录携带安装凭证时写入）。会话每次校验都会刷新 `last_seen_at`（wallet_auth.go:353），登出写 `revoked_at`（:320）。
- `app_installations`：安装实例，带 APK 版本 / 构建号 / runtime / `ota_channel` / `ota_revision` / 语言 / 主题 / 系统版本，`device_client_id` 指向 `device_clients`。
- `device_clients`：平台级设备归并（Android ID / iOS IDFV 的 HMAC，密钥平台级、不含租户），同一部手机上不同租户的 App 归到同一行。
- 管理端：`GET /installations/overview`、`GET /installations`（固定 500 条，无分页筛选）、`POST /installations/:id/revoke`；平台级路由分组 `/v1/admin/platform/*` 由 `PLATFORM_ADMIN_USERNAMES` 门禁。
- App：一次只有一个会话；切换钱包 = 先登出再用新地址重新签名登录（`useSwitchAccount`）；心跳在冷启动 / 回前台 / 指纹变化时发送，30 分钟节流。

### 2.2 坑（必须在本设计里修）

- `app_installations.ota_revision` 存的是 bootstrap 下发的"最新可用修订号"，不是设备正在跑的版本；管理端"Runtime / OTA"列展示的就是它。
- 登录与安装实例的关联事实上没有生效：线上 8 条会话 0 条带 `installation_id`。原因是登录时若安装凭证缺失或失效就退化为不关联登录（"登录照常"），而 9 月 2 日到 9 月 7 日之间安装凭证因应用身份改写问题（RN-Server 87e88d7 已修）持续失效。可选关联在实践中等于没有关联。
- 租户级封禁在登录时已校验（`WALLET_USER_BLOCKED`），但封禁不结束已有会话，也没有管理端入口。
- 撤销安装实例只撤凭证和推送 Token，不结束该实例上的会话。
- `wallet_session` 没有清理任务。
- 心跳指纹在 55ef275 之前不含应用身份（已修，随 OTA rev 5 发布）。

### 2.3 数据现状

4 个租户（100000001 Predict.Kim / anyfun、100000002、100000003 test、100000004），钱包用户只在 100000001 有 5 个；`test` 租户（域名 test.com / test1.com）可用于跨租户场景验证。

## 3. 术语与不变量

- 账号：EIP-55 钱包地址。租户内以 `wallet_user` 一行表示；跨租户以 `address_key`（小写地址）识别。
- 设备：`device_clients` 一行。仅用于聚合展示，不做安全判定（模拟器 / root 可伪造；出厂重置或签名密钥切换后重置）。
- 安装实例：`app_installations` 一行（tenant + application_id + installation_id）。
- 当前账号（安装实例维度）：该实例上唯一一条有效会话（`revoked_at IS NULL AND expires_at > now`）对应的账号。不变量：**一个安装实例同一时刻最多一条有效会话**，由服务端在签发会话时替代旧会话保证，不依赖 App 行为。
- 当前活跃设备（账号维度）：该账号有效会话去重后的安装实例；一个账号可同时在多台设备活跃，也可同时在多个租户的 App 里各有一条会话。
- 活跃分级（管理端展示）：会话有效 且 设备 7 天内有心跳 → "当前活跃"；会话有效但心跳过期 → "会话有效 · 设备不活跃"；无有效会话 → "未登录"。

## 4. 设计

### 4.1 版本信息上报（心跳）

心跳报文新增两个字段，服务端解析后落到 `app_installations`：

| 字段 | 取值 | 说明 |
|---|---|---|
| `launchSource` | `"embedded"` / `"ota"` | 来自 `Updates.isEmbeddedLaunch`。旧版 App 不发该字段，服务端存 NULL，管理端显示"未上报（旧版）"，不把 NULL 当内置 |
| `runningUpdateId` | UUID 或 null | 来自 `Updates.updateId`；`launchSource=embedded` 时必须为 null，否则必须为 UUID，不符返回 422 |

服务端用 `runningUpdateId` 关联本租户 `ota_releases.update_id` 得到 `running_ota_revision`；关联不上（回退、已删除、他租户）存 NULL，管理端显示"未知更新 <id>"，不猜。现有 `ota_revision` 保留，COMMENT 改为"bootstrap 下发的最新可用修订号"；两者之差就是"待生效"。

两个字段纳入心跳指纹，OTA 生效后的第一次启动立即上报。

### 4.2 账号与安装实例的关联（登录路径）

- 登录（`/v1/mobile/auth/verify`）**必须**携带安装凭证。App 在启动心跳里已经拿到凭证；凭证失效返回 `INSTALLATION_CREDENTIAL_INVALID` 时，App 先重新注册再带新凭证重试一次；仍失败则登录失败，错误码 `INSTALLATION_REQUIRED`，界面显示明确文案。不再退化为无关联登录。
- 服务端签发会话时在同一事务里：对该安装实例的其他有效会话写 `revoked_at=now, ended_reason='superseded'`；写入 / 更新 `wallet_user_installation`（首次 / 最近登录、次数、最近连接器）。
- 登出写 `ended_reason='logout'`；管理端撤销会话写 `'admin'`；封禁写 `'blocked'`。过期不写标记，读取时按 `expires_at` 判断。
- 撤销安装实例时同时结束该实例的全部有效会话（`'admin'`），App 下次校验会话得到 401 后回到未登录态。
- 登录时校验封禁：先平台级 `platform_wallet_block`，再租户级 `wallet_user.status='blocked'`；命中返回 403，错误码分别为 `WALLET_BLOCKED_PLATFORM` / `WALLET_USER_BLOCKED`（沿用现有码），App 显示对应文案；封禁动作同时结束该账号的有效会话（租户级只结束本租户的）。

### 4.3 当前活跃账号

不在 `app_installations` 上加"当前账号"冗余列。登录、登出、过期、撤销、封禁都写会话表，冗余列多一处必然不同步。"当前"始终从 `wallet_session` 按索引 `(tenant_id, installation_id, revoked_at, expires_at)` 派生；`wallet_user_installation` 只记历史。

### 4.4 设备归并与跨租户

- 设备归并沿用 `device_clients`。签名密钥切换当日所有 Android ID 变化，归并从切换日重新开始；切换前的历史留在安装实例与 `wallet_user_installation`，写进切换日 runbook。跨租户设备聚合要求各租户正式包共用同一把密钥。
- 租户管理员只看本租户：所有查询带 `tenant_id`；`device_client_id` 不出现在租户接口的响应里，租户内"同设备的其他安装实例"由服务端 join 后直接返回列表。
- 平台管理员：按地址查（该地址在哪些租户注册、各租户状态与最近登录、跨租户按设备聚合的安装实例与当前会话）、按设备查（该设备上所有租户的安装实例与当前账号）。每次查询写审计事件（谁、查了什么）。

### 4.5 封禁

| 级别 | 存储 | 效果 |
|---|---|---|
| 租户级 | `wallet_user.status='blocked'`（已有） | 本租户拒绝登录、结束本租户会话 |
| 平台级 | 新表 `platform_wallet_block` | 所有租户拒绝登录、结束所有租户会话；解除后各租户级状态不变 |

管理端明确显示封禁来自哪一级、原因、操作人、时间。

### 4.6 表结构（新增 2 表、4 列、3 索引；全部带 COMMENT）

```sql
ALTER TABLE app_installations
  ADD COLUMN launch_source ENUM('embedded','ota') NULL COMMENT '心跳上报的启动来源：embedded=内置 bundle，ota=OTA bundle；NULL=旧版 App 未上报',
  ADD COLUMN running_update_id CHAR(36) NULL COMMENT '正在运行的 expo-updates update id；launch_source=embedded 时为 NULL',
  ADD COLUMN running_ota_revision INT UNSIGNED NULL COMMENT '由 running_update_id 关联本租户 ota_releases.update_id 得到的修订号；关联不上为 NULL，管理端显示未知更新',
  ADD COLUMN client_session_state ENUM('signed_in','signed_out') NULL COMMENT '心跳上报的客户端登录态，只用于与 wallet_session 对账，不参与任何判定；NULL=旧版 App 未上报',
  MODIFY COLUMN ota_revision INT UNSIGNED NULL COMMENT 'bootstrap 下发的最新可用 OTA 修订号（服务端视角），不是运行中的版本';

ALTER TABLE wallet_session
  ADD COLUMN ended_reason ENUM('logout','superseded','admin','blocked') NULL COMMENT '会话主动结束的原因：logout=用户登出，superseded=同安装实例新登录替代，admin=管理端撤销，blocked=封禁；NULL=未被主动结束（是否过期看 expires_at）',
  ADD KEY ix_wallet_session_installation (tenant_id, installation_id, revoked_at, expires_at) COMMENT '按安装实例取当前有效会话';

ALTER TABLE wallet_user
  ADD KEY ix_wallet_user_address (address_key) COMMENT '平台级按地址跨租户查找';

CREATE TABLE wallet_user_installation (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  tenant_id BIGINT UNSIGNED NOT NULL COMMENT '租户ID',
  user_id BIGINT UNSIGNED NOT NULL COMMENT 'wallet_user.id',
  installation_id VARCHAR(80) NOT NULL COMMENT 'app_installations.installation_id',
  first_login_at DATETIME(3) NOT NULL COMMENT '该账号在该安装实例首次登录时间',
  last_login_at DATETIME(3) NOT NULL COMMENT '该账号在该安装实例最近登录时间',
  login_count INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '该账号在该安装实例的登录次数',
  last_connector VARCHAR(32) NOT NULL COMMENT '最近一次登录使用的钱包连接器',
  created_at DATETIME(3) NOT NULL COMMENT '创建时间',
  updated_at DATETIME(3) NOT NULL COMMENT '更新时间',
  PRIMARY KEY (id),
  UNIQUE KEY uq_user_installation (tenant_id, user_id, installation_id),
  KEY ix_installation_users (tenant_id, installation_id, last_login_at)
) ENGINE=InnoDB COMMENT='账号与安装实例的登录历史汇总，登录时与会话同事务写入；当前账号不看此表，看 wallet_session';

CREATE TABLE platform_wallet_block (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  address_key VARCHAR(42) NOT NULL COMMENT '小写地址，跨租户唯一',
  address VARCHAR(42) NOT NULL COMMENT 'EIP-55 校验和地址，展示用',
  reason VARCHAR(255) NOT NULL COMMENT '封禁原因，管理端必填',
  created_by VARCHAR(120) NOT NULL COMMENT '操作的平台管理员（x-admin-id）',
  created_at DATETIME(3) NOT NULL COMMENT '封禁时间',
  revoked_at DATETIME(3) NULL COMMENT '解除时间；NULL=生效中',
  revoked_by VARCHAR(120) NULL COMMENT '解除封禁的平台管理员',
  revoked_reason VARCHAR(255) NULL COMMENT '解除原因',
  PRIMARY KEY (id),
  KEY ix_platform_block_address (address_key, revoked_at)
) ENGINE=InnoDB COMMENT='平台级钱包封禁，对所有租户生效；租户级封禁在 wallet_user.status';
```

回填：`wallet_user_installation` 从现有 `wallet_session.installation_id` 回填，但线上 0 条会话带该字段，实际从本设计上线后开始积累。

### 4.7 接口

租户级（现有分组，全部带 tenant 过滤）：

| 接口 | 说明 |
|---|---|
| `GET /installations?cursor&limit&q&platform&appVersion&runningOtaRevision&launchSource&activeWithin` | 游标分页取代固定 500 条；新增字段 `launchSource`、`runningUpdateId`、`runningOtaRevision`、`availableOtaRevision`、`currentAccount{address,sessionId,lastSeenAt}`、`accountsCount`、`activity`（§3 三档） |
| `GET /installations/:id` | 版本三元组、当前账号、账号历史（汇总表）、同设备其他安装实例（本租户）、推送 Token 状态、会话列表 |
| `GET /installations/overview` | 新增 `otaRevisions[]{revision, running, available}`、`launchSources{embedded,ota,unreported}`、`signedInInstallations`、`activeAccounts{oneDay,sevenDays,thirtyDays}` |
| `GET /wallet/users?cursor&limit&q&status&activeWithin` | 地址、状态、首次 / 最近登录、登录次数、设备数、当前活跃设备数、最近活跃设备摘要 |
| `GET /wallet/users/:id` | 按设备分组的安装实例（含当前标记、版本、最近活跃）、有效与历史会话 |
| `POST /wallet/users/:id/block` / `unblock` | body `{reason, confirm:true}`；封禁结束本租户有效会话；写审计 |
| `POST /wallet/sessions/:id/revoke` | body `{reason, confirm:true}`；`ended_reason='admin'`；写审计 |

平台级（`/platform` 分组，`requirePlatformAdmin`，每次调用写审计）：

| 接口 | 说明 |
|---|---|
| `GET /platform/wallet/lookup?address=` | 各租户的账号状态与最近登录；跨租户按设备聚合的安装实例（标注租户）与当前会话；平台级封禁状态 |
| `GET /platform/devices/:deviceClientId` | 该设备上所有租户的安装实例、版本、当前账号 |
| `POST /platform/wallet/blocks` / `DELETE /platform/wallet/blocks/:id` | body `{address, reason, confirm:true}`；封禁结束所有租户会话 |

错误码：`INSTALLATION_REQUIRED`（登录缺安装关联）、`WALLET_USER_BLOCKED`、`WALLET_BLOCKED_PLATFORM`、`WALLET_BLOCK_CHECK_FAILED`（平台封禁表不可读，登录失败而不是放行）、`OTA_RUNNING_UPDATE_INVALID`（心跳字段不符）。

### 4.8 管理端功能（RN-Admin）

- 安装实例列表：新增"运行 OTA"（修订号 + update id 前 8 位；内置 / 未上报按实际显示）、"可用 OTA"、"当前账号"（地址缩写 + 会话最近使用时间；未登录 / 设备不活跃按 §3 显示）、"账号数"；分页、搜索、按版本 / OTA / 启动来源 / 活跃窗口筛选。
- 安装实例详情抽屉：版本三元组、当前账号、账号历史、同设备其他安装实例、推送状态、会话列表与撤销。
- 账号列表与详情页（新）：按 §4.7；设备卡片上"当前"徽标；封禁 / 解封 / 撤销会话按钮，操作需原因与确认。
- 概览：OTA 修订号分布（运行 vs 可用）、启动来源分布、当前登录账号数、活跃设备数。
- 平台视图（仅平台管理员菜单）：地址查询、设备查询、平台级封禁列表。

### 4.9 App 改动

- 心跳：`launchSource`、`runningUpdateId` 两字段并纳入指纹。
- 登录：安装凭证必带；`INSTALLATION_CREDENTIAL_INVALID` 时重新注册后重试一次；新增 `INSTALLATION_REQUIRED`、`WALLET_BLOCKED`、`WALLET_BLOCKED_PLATFORM` 的界面文案（i18n 种子两种语言）。
- 会话校验得到 401 时回到未登录态（现有 revalidator 已覆盖，补测试）。
- 不上报账号列表：账号是否登录以服务端会话为准。心跳带 `sessionState`（`signed_in` / `signed_out`）只用于对账：服务端存为 `client_session_state`，与会话表比对不一致时在管理端标"状态不一致"，不用它做任何决策（用户 2026-09-07 决定实施，字段随一期心跳一起上，差异展示在二期）。

### 4.10 数据保留

- `wallet_session`：永久保留，不做自动清理（用户 2026-09-07 决定）。过期状态在读取时按 `expires_at` 判断，`ended_reason` 只记录主动结束的原因（logout / superseded / admin / blocked），不设清理任务，因此不写 `expired`。
- `wallet_user_installation`、`platform_wallet_block`：永久保留。
- `app_installations`：现状不变（upsert，不增长）。

### 4.11 安全与隐私

- 设备标识只以 HMAC 存储，不出现在租户接口；跨租户关联只对平台管理员可见且逐次审计。
- 地址是链上公开信息，但"某地址在哪些租户使用"是新产生的关联信息，视为敏感：平台接口不提供批量导出，查询必须带完整地址。
- 封禁、撤销会话、撤销安装实例都要求原因与确认，写 `audit_events`。
- 登录关联安装从"可选"改为"必须"是安全边界的收紧：定向推送与当前账号都依赖它，缺失即失败并可见。

### 4.12 测试与验证

单元 / 接口测试：会话替代（同安装实例两次登录只剩一条有效）；封禁优先级与会话结束；心跳字段校验（embedded 带 update id → 422）；`running_ota_revision` 关联不上存 NULL；租户接口不泄露 `device_client_id`；平台接口无权限 403 且写审计。

模拟器场景（emulator-5570 + 第二台模拟器，租户 anyfun 与 test）：

1. OTA 生效后首个心跳带 `launchSource=ota`、`runningUpdateId`；管理端分布显示该设备在新修订号。
2. 同一模拟器登录账号 A → 切换到账号 B：管理端安装实例当前账号从 A 变 B，A 的会话 `ended_reason='superseded'`，汇总表两行。
3. 账号 A 在两台模拟器登录：账号详情显示两台设备均"当前"，撤销其中一台后只剩一台。
4. 撤销安装实例：会话结束，App 回到未登录态。
5. 租户级封禁 A：本租户登录 403 `WALLET_BLOCKED`，App 显示文案；test 租户仍可登录。平台级封禁：两个租户都 403。
6. 卸载重装：新安装实例归到同一设备，账号历史在设备维度可见。
7. 旧版 App（rev 5 之前）心跳：`launch_source` NULL，管理端显示"未上报（旧版）"。

## 5. 分期与交付（2026-09-07 全部上线）

| 期 | 交付 | 验证 |
|---|---|---|
| 一 | RN-Server `c0091b7`（迁移 35）、RN-Admin `1de6c17`、RN-App `a84244f`、OTA rev 6 | 模拟器心跳上报 launchSource=ota / update id / 登录态，概览分布 |
| 二 | RN-Server `7526d90`（迁移 36）+ `aab30e4`（文案种子每次启动补齐）、RN-Admin `e0bd8b8`、RN-App `c9960f1` + `a325e2c`、OTA rev 7 | 重新登录后会话关联安装实例、当前账号 / 登录历史 / 对账；封禁结束会话、App 回未登录态并显示原因；撤销会话 |
| 三 | RN-Server `608a9c6`、RN-Admin `e6291bb` | 平台级地址查询（各租户 + 跨租户设备归并，模拟器设备下归并出 4 个安装实例）、设备查询、平台级封禁 / 解除对 App 生效、非法地址 422、重复封禁 409、审计落库 |

跨租户登录场景只有一个租户有数据，接口按租户分组的结构已验证；第二个租户的登录待有对应 App 包时再做。

### 原分期计划

| 期 | 内容 | 交付 |
|---|---|---|
| 一 | §4.1 版本信息：服务端加列与解析（含 `client_session_state`）、概览与列表的 OTA 字段、分页筛选；App 心跳字段（`launchSource`、`runningUpdateId`、`sessionState`） | RN-Server、RN-Admin 部署；一次 OTA |
| 二 | §4.2 / 4.3 / 4.5 租户级：会话替代与 ended_reason、汇总表、登录必带安装、封禁校验、撤销安装结束会话、账号接口与页面、安装实例详情、登录态对账差异展示 | RN-Server、RN-Admin 部署；一次 OTA |
| 三 | §4.4 平台级：跨租户查询、设备视图、平台级封禁、审计 | RN-Server、RN-Admin 部署 |

## 6. 已决事项（用户 2026-09-07）

1. 登录必须关联安装：按 §4.2 实施，安装注册不可用时登录失败并显示 `INSTALLATION_REQUIRED`。
2. 会话数据永久保留，不做自动清理。
3. 租户管理员可见"同设备的其他安装实例（本租户）"。
4. 封禁立即结束现有会话。
5. 心跳对账字段实施：字段随一期心跳上报，差异展示在二期。

## 7. 评审记录（相对讨论中口头方案的修改）

- 新增 `launch_source`：口头方案用 `running_update_id IS NULL` 表示内置，评审发现旧版 App 不上报时也是 NULL，两种含义混在一起违反"不猜"原则，改为显式枚举，NULL 只表示未上报。
- 登录关联从"可选、失效时重试无关联登录"改为"必须"：核对线上数据发现 8 条会话 0 条关联，可选关联在实践中等于没有。
- 补上现状缺口：撤销安装不结束会话、封禁不结束会话且无管理端入口、会话无清理任务（后经用户决定永久保留）。评审稿曾误判"`blocked` 登录时未校验"，实施时核对代码发现已校验（`WALLET_USER_BLOCKED`），二期沿用该错误码。
- 当前账号明确"从会话派生 + 签发时替代旧会话"，删掉口头方案里的冗余列想法；"活跃"拆成三档，避免已卸载设备的有效会话被算成活跃。
- 跨租户：租户接口禁止暴露 `device_client_id`；平台查询要求完整地址且逐次审计；平台级封禁独立成表并定义与租户级的叠加关系。
- 回填预期修正：汇总表回填实际为空，数据从上线后积累。
- 实施中发现的既有缺口：服务端文案种子只在迁移 29（2026-09-02）种过一次，此后同步的新键从未进库，App 只能显示键名（本次登录限制文案、此前预测争议等文案都受影响）。改为每次启动补齐缺失键（只插不改，RN-Server `aab30e4`），同步种子 + 部署即生效。
- 分页与筛选列为一期硬需求（现状固定 500 条）。
- 签名密钥切换的影响写入设计（设备归并重置、跨租户聚合要求共用密钥），不再作为风险反复提出。
