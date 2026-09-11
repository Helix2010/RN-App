# 设计：灰度发布与设备白名单（全量包 + OTA）

- 状态：Draft，待评审
- 日期：2026-09-11
- 涉及仓库：RN-Server（主）、RN-App、RN-Admin

## 1. 目标与非目标

**目标**：让一次发布只对**指定设备**生效，全量包（APK）与热更新（OTA）两条链路都支持，且不改动现有的「发布即全量」逻辑。

**非目标**：

- 按百分比随机灰度。本轮只做显式设备名单；百分比灰度需要稳定的分桶函数与回收策略，另行设计。
- 按地区 / 版本 / 渠道的定向。这些维度服务端已有数据，但不在本轮。
- iOS。iOS 侧尚无签名与分发链路。

## 2. 现状

发布状态机只有一条主干（`internal/api/server.go:527`）：

```go
var transitions = map[string]map[string]string{
    "publish": {"verified": "active", "paused": "active"},
    "pause":   {"active": "paused"},
}
```

发布时会把同平台其它活跃版本一律收尾（`server.go` releaseAction 事务内）：

```sql
UPDATE app_releases SET status='completed' WHERE tenant_id=? AND id<>? AND platform=? AND status='active'
```

因此**同一平台同一时刻只有一条 active**，`status='active'` 的含义就是「所有人现在该拿的那一个」。全仓有 22 处读路径依赖这个不变量。

四条相关读路径：

| 用途                 | 位置                                                     | 现在的条件                                               |
| -------------------- | -------------------------------------------------------- | -------------------------------------------------------- |
| bootstrap 的更新决策 | `simplified_releases.go` `activeSimplifiedRelease`       | `status='active' ORDER BY build_number DESC LIMIT 1`     |
| 公开最新版本         | `simplified_releases.go` `publicLatestReleaseFromDomain` | 同上                                                     |
| 公开下载             | `simplified_releases.go` `publicReleaseDownload`         | `id=? AND status='active'`                               |
| OTA manifest         | `ota.go` `otaManifest`                                   | `o.status='active' ... ORDER BY o.revision DESC LIMIT 1` |

**服务端目前不知道请求来自哪台设备**。bootstrap 只读 `x-app-version`、`x-build-number`、`x-distribution-channel`、`x-platform`；OTA manifest 只读 expo 的平台 / 运行时 / 渠道；`/v1/public/releases/latest` 完全匿名。安装 ID 是有的（`app_installations.installation_id`，客户端存在 SecureStore），但只在登录相关接口上作为 `X-Installation-ID` 发送。

状态列都是 ENUM，加值需要迁移：

```
app_releases.status ENUM('uploaded','verified','active','paused','completed','rejected','rolled_back')
ota_releases.status ENUM('draft','verified','active','paused','superseded','rejected')
```

## 3. 方案

### 3.1 灰度是一个独立状态，不是 active 的变体

新增状态 `canary`，与 `active` 平行：

```
verified --publish--> active
verified --canary---> canary
canary   --promote--> active      （同一条记录转正，不重新上传）
canary   --cancel---> rejected
active   --pause----> paused
```

关键性质：`publish` 事务里那句收尾语句只扫 `status='active'`，灰度行天然不受影响；反过来，转灰度也不收尾任何 active 行。**两条主干互不干涉，现有发布逻辑一行不改。**

**允许多条灰度并存**（面向不同名单），设备按 `build_number` 取最大的一条。不做互斥，因为互斥会逼着运营为了发第二个灰度先取消第一个。

**灰度会变成死行，要提示但不要自动处理**：发布一个 `build_number` 不低于某条灰度的 active 之后，那条灰度永远不会再被任何设备选中。管理端在发布时检测并提示运营去取消，但不自动改它的状态——静默的状态变更会让人查不清发生过什么。

`status='active'` 的不变量保留：它仍然只有一条，仍然是「所有人该拿的那一个」。22 处依赖它的读路径里，只有第 2 节表中的四条需要改。

### 3.2 白名单挂在发布记录上，不是设备标签

`app_releases` 与 `ota_releases` 各加一列：

```sql
canary_installations JSON NULL COMMENT '灰度设备白名单，installation_id 字符串数组；仅 canary 状态有意义'
```

**为什么挂在记录上而不是给设备打全局标签**：同一台机器可以在 A 版本的灰度里、不在 B 版本的灰度里，全局标签表达不了。挂在记录上还能在转灰度时强制校验「名单为空即拒绝」，这正是"灰度发布必须指定设备"的落点。

**容量**：JSON 列适用于几十到一两百台测试机。超过这个规模再拆成 `release_canary_installations` 关联表（届时读路径改成 `EXISTS (SELECT 1 FROM ... )`，查询形状不变）。文档里写明这个门槛，不要等它慢慢长大。

### 3.3 设备身份送到决策点

| 链路                          | 做法                                                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| bootstrap / latest / download | 带上已有的安装凭证（`installationAuthorization()` 给出的 `X-Installation-ID` + `Authorization: Installation …`），服务端验证后才认这个身份 |
| OTA manifest                  | bootstrap 下发的短时灰度令牌，客户端 `Updates.setExtraParamAsync("canaryToken", token)`，manifest 请求原生携带 `Expo-Extra-Params`         |

**不要只发一个裸的 `X-Installation-ID`**，理由与具体做法见 8.1。设置时机：bootstrap 成功返回之后，失败不影响启动。

### 3.4 读路径的统一形状

四条路径都改成「active 或（灰度且我在名单里）」，取 build 最大的一条：

```sql
-- bootstrap / latest
SELECT ... FROM app_releases
WHERE tenant_id=? AND platform=?
  AND (status='active'
       OR (status='canary' AND ? <> '' AND JSON_CONTAINS(canary_installations, JSON_QUOTE(?))))
ORDER BY build_number DESC LIMIT 1
```

```sql
-- download：灰度设备要能真的下载到它在 manifest 里看到的那一个
SELECT ... FROM app_releases
WHERE tenant_id=? AND id=?
  AND (status='active'
       OR (status='canary' AND ? <> '' AND JSON_CONTAINS(canary_installations, JSON_QUOTE(?))))
```

```sql
-- OTA manifest
... WHERE o.tenant_id=? AND o.platform=? AND o.channel=? AND o.runtime_version=?
  AND (o.status='active'
       OR (o.status='canary' AND ? <> '' AND JSON_CONTAINS(o.canary_installations, JSON_QUOTE(?))))
  ... ORDER BY o.revision DESC LIMIT 1
```

三点约束：

- **排序必须用 `build_number`（OTA 用 `revision`），不能用版本号字符串**。表上有 `UNIQUE(tenant_id, platform, build_number)`，而字符串排序会把 `1.3.10` 排在 `1.3.9` 前面。
- **认不出设备一律 fail-closed**：安装 ID 为空时那个 `? <> ''` 直接让灰度分支失效，只剩 `active`。老版本客户端、匿名请求、伪造不了任何东西。
- **下载接口必须同步放行**。不改它的话，灰度设备能从 bootstrap 拿到版本号和下载地址，一点下载就 404。这是本方案最容易漏的一处。

关于性能：`JSON_CONTAINS` 用不上索引，而 bootstrap 是每次启动都会打的接口。但候选集先被 `tenant_id + platform` 收敛（`ix_release_platform_build`），单租户单平台的发布记录是个位数量级，JSON 扫描发生在这几行上，可以接受。名单规模逼近 3.2 节说的门槛时，连同这一点一起拆成关联表。

### 3.5 灰度版本的行为约束

- **不得设 `mandatory`**。强制升级提示影响的是全量用户的决策口径，灰度版本设了它没有意义且危险。转灰度时校验，已是 `mandatory` 的记录拒绝转灰度。
- **不参与 `minSupportedVersion` 判定**。`resolveUpdateDecision` 的 `Latest` 入参在灰度设备上用灰度版本，`MandatoryVersion` 仍只来自 active 记录。
- **OTA 的基线校验不变**：灰度 OTA 的 `baseReleaseId` 仍必须是 `verified` 或 `active` 的基线包，`applicationId` 绑定照旧。灰度 OTA 的基线若本身是灰度 APK，不需要额外规则：manifest 按 `runtime_version` 匹配，没装那个基线的设备根本匹配不上。
- **取消灰度后，已装灰度版的设备会停在高于 active 的版本上**，直到出现更高的 active。这对测试机可以接受；补救手段是转正，或发一个 `build_number` 更高的 active。不要试图让客户端降级。

### 3.6 审计

进入灰度、修改名单、取消灰度、转正，四个动作都要落审计，与现有 `release_action` 同一套确认与原因要求。审计正文记**名单的设备数与内容哈希**，不灌完整设备列表——审计是用来回答"谁在什么时候把范围改成了什么"，完整名单在发布记录上随时可查。

## 4. 管理端

「发布总览」的状态筛选增加「灰度」。待发布记录上除「发布」外增加「灰度发布」，点击后要求选择设备：从「安装与设备」列表里勾选，或粘贴安装 ID。名单为空不允许提交。

灰度记录上提供「转为正式发布」（走 `promote`，等同 publish 的审计与确认）与「取消灰度」。列表里灰度行要显示名单设备数，点开可见清单。

`/v1/admin/releases` 的返回补 `canaryInstallations`（仅灰度状态返回），契约同步。

## 5. 迁移

迁移 38 `release_canary`，前向执行，两步：

```sql
ALTER TABLE app_releases MODIFY status ENUM('uploaded','verified','active','canary','paused','completed','rejected','rolled_back') NOT NULL COMMENT '发布状态';
ALTER TABLE app_releases ADD COLUMN canary_installations JSON NULL COMMENT '灰度设备白名单…' AFTER status;
ALTER TABLE ota_releases MODIFY status ENUM('draft','verified','active','canary','paused','superseded','rejected') NOT NULL COMMENT 'OTA状态';
ALTER TABLE ota_releases ADD COLUMN canary_installations JSON NULL COMMENT '灰度设备白名单…' AFTER status;
```

按既有迁移的写法先查 `INFORMATION_SCHEMA.COLUMNS` 判重，可重复执行。

**上线顺序**：迁移必须先于任何写入 `canary` 的代码。ENUM 里没有这个值时写入会被 MySQL 拒绝（严格模式）或静默截断（非严格模式），后者更糟。

## 6. 回滚

- 代码回滚：读路径的 OR 分支去掉即可，灰度记录变成「谁都拿不到」的孤儿行，不影响全量用户。
- 数据回滚：ENUM 里多一个值、多一个可空列，都不影响旧代码。**不要**在回滚里删这两处，留着即可。
- 运营回滚：灰度版本出问题时点「取消灰度」，设备下次请求即回到 active 版本；OTA 同理，回到上一条 active 修订。

## 7. 验收用例

| #   | 场景                                   | 期望                                                |
| --- | -------------------------------------- | --------------------------------------------------- |
| 1   | 白名单内设备请求 bootstrap             | 拿到灰度版本                                        |
| 2   | 白名单外设备请求 bootstrap             | 拿到 active 版本，完全看不到灰度版本                |
| 3   | 不带安装 ID 的请求                     | 只拿 active，灰度分支不生效                         |
| 4   | 匿名 `/v1/public/releases/latest`      | 永远只返回 active                                   |
| 5   | 白名单内设备下载灰度包                 | 200 / 206，不是 404                                 |
| 6   | 白名单外设备拿灰度包 ID 直接下载       | 404，不能靠猜 ID 绕过                               |
| 7   | 灰度期间发布一个新的全量版本           | 灰度记录不被收尾；白名单设备按 build 取大的那个     |
| 8   | 灰度转正                               | 同一条记录变 active，旧 active 被收尾，审计链连续   |
| 9   | 名单为空时转灰度                       | 拒绝，`CANARY_AUDIENCE_REQUIRED`                    |
| 10  | 给灰度记录设 mandatory                 | 拒绝                                                |
| 11  | OTA 灰度，白名单内 / 外设备取 manifest | 内拿到灰度修订，外拿到 active 修订                  |
| 12  | 灰度 OTA 的基线是 verified 包          | 允许，与现有规则一致                                |
| 13  | 带安装 ID 但凭证无效 / 过期            | 按匿名处理，只拿 active；bootstrap 本身照常返回配置 |
| 14  | 安装已被吊销                           | 同上，且灰度立即失效                                |
| 15  | 复制 A 设备的安装 ID 到 B（不带凭证）  | B 拿不到灰度                                        |
| 16  | 灰度令牌过期后取 OTA manifest          | 回到 active 修订，不报错                            |
| 17  | 伪造的灰度令牌                         | 验签失败，按匿名处理                                |

## 8. 身份加固与已知限制

**白名单只对会上报身份的版本有效。** bootstrap 与 manifest 现在都不带安装 ID，所以**第一个灰度版本无法定向到尚未升级的老设备**。必须先全量发一版带身份上报的客户端，之后才能开始灰度。这是链条的固有顺序，没有绕法。

### 8.1 身份加固

#### 威胁模型：先说清在防什么

灰度包被不该拿到的人拿到，属于**未发布代码的保密性**问题，不是完整性问题。包仍然过生产签名与 sha256 校验，拿到的人改不了它，也不能伪造成别人的升级——那条路在 N1/N2/N33 已经堵死。所以加固的目标是两条：**别误发**，以及**发错了能撤销**。不是"绝对拿不到"。真正不能泄漏的东西不该放进客户端包里，这条不因灰度而改变。

按此排序，下面四种手段的性价比差别很大。

#### 基线（必须做）：不要信任裸的 `X-Installation-ID`

3.3 节写的"加个请求头"是最低配，但没必要停在那里——**服务端早就有能证明"我是这个安装"的机制，只是没用在这条路径上**：

- `app_installations` 存 `credential_hash`、`credential_version`、`credential_expires_at`，凭证 90 天有效、到期前 14 天轮换（`installations.go:23-24`）；
- 服务端有现成的 `authenticateInstallation(c, installationID)`（`installations.go:320`）；
- 客户端有现成的 `installationAuthorization()`，同时给出 `X-Installation-ID` 与 `Authorization: Installation <凭证>`（`installation-service.ts:143`）；
- 已经有 `INSTALLATION_REVOKED`：设备丢了或凭证泄漏，管理端吊销该安装。

所以 bootstrap 改成**可选鉴权**：带凭证就验证，验证通过的安装 ID 才参与灰度匹配；不带、过期、被吊销一律按匿名处理，只给 active。注意两点：

- **凭证校验失败不能让 bootstrap 整体失败**。bootstrap 是启动门禁，配置必须照发，只是不给灰度。
- 这样"自报"就变成了"持有服务端签发的凭证"，与会话令牌同一档。复制凭证到另一台机器等价于克隆这次安装，而且可被吊销。

成本几乎为零——两侧机制都现成，只是接上。

#### OTA 这条路不能带 Authorization，用短时令牌解决

OTA 的 manifest 请求由 expo-updates 在**启动时、JS 跑起来之前**原生发出。这带来一个具体约束：

- `setUpdateRequestHeadersOverride` 确实存在，但它由 JS 调用，设进去的头对**本次启动那一次检查**已经来不及，而且标着 `@experimental`；
- `setExtraParamAsync` 设的值由原生侧持久化，**下次启动的那一次原生请求就会带上**，这才是能用的通道。

所以：bootstrap（已鉴权）在响应里附带一个**短时灰度令牌**，内容是签名过的 `{installationId, exp}`，有效期 24 小时；客户端 `setExtraParamAsync("canaryToken", token)`；manifest 处理函数验签取出 installationId 参与匹配。令牌过期而没来得及刷新时，设备静默回到 active——仍然 fail-closed。

这条同时解决了一个更隐蔽的问题：即便有人抓到了 `Expo-Extra-Params` 里的令牌，它 24 小时后失效，而安装凭证本身从未出现在这条链路上。

#### 高价值灰度：把名单绑到已登录账户

名单从安装 ID 换成钱包地址（或 `wallet_user` id），证明来自 SIWE 会话令牌——伪造它需要用户私钥，这是本 App 里最强的身份。

限制是 bootstrap 在冷启动、未登录时也要跑，那时拿不到账户。两种处理：接受"登录后才进灰度"（登录成功后重新拉一次 bootstrap），或者两档并存——未登录按安装凭证匹配，已登录按账户匹配，账户优先。建议前者，逻辑简单，而且需要账户级灰度的场景（真实资金、生产钱包）本来就是登录态。

#### 明确不建议：平台设备证明

Play Integrity / DeviceCheck 是这类问题的教科书答案，在这里却是错的：

- **它会把我们自己的灰度对象全部判为不可信**。灰度发给的是模拟器和 root 过的测试机，这正是完整性证明要拦的东西；
- 需要接 Google Cloud 项目、服务端验签、处理配额与降级；
- 换来的只是"更难伪造一个本来就只能拿到签名包的身份"。

收益与代价不成比例。等将来出现"必须确保某功能只在未越狱设备上开启"的需求时再单独引入，不要为了灰度名单引入它。

#### 落地顺序

基线那条（bootstrap 可选鉴权 + 短时令牌）与第 9 节的阶段 1、2 一起做，不额外排期；账户绑定作为阶段 4，等真有高价值灰度需求时再上。

### 8.2 其它限制

## 9. 分期与工作量

| 阶段 | 内容                                                                                        | 估时   |
| ---- | ------------------------------------------------------------------------------------------- | ------ |
| 1    | 客户端上报身份（安装凭证 + OTA 短时令牌 extra param），随下一个全量版本发布                 | 0.5 天 |
| 2    | 服务端迁移 38、状态机两个转换、四条读路径、bootstrap 可选鉴权与令牌签发、灰度约束校验、审计 | 1.5 天 |
| 3    | 管理端灰度动作与设备选择、列表展示、契约同步                                                | 1 天   |
| 4    | 账户级灰度（名单换成钱包地址，凭 SIWE 会话证明），等有高价值灰度需求时再做                  | 1 天   |

阶段 1 必须先上线并铺开，阶段 2、3 才有意义。
