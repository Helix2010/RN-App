# 设计：灰度发布与设备白名单（全量包 + OTA）

- 状态：已实现（2026-09-11）
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

| 用途                  | 位置                                                     | 现在的条件                                               |
| --------------------- | -------------------------------------------------------- | -------------------------------------------------------- |
| bootstrap 的更新决策  | `simplified_releases.go` `activeSimplifiedRelease`       | `status='active' ORDER BY build_number DESC LIMIT 1`     |
| 公开最新版本          | `simplified_releases.go` `publicLatestReleaseFromDomain` | 同上                                                     |
| 公开下载              | `simplified_releases.go` `publicReleaseDownload`         | `id=? AND status='active'`                               |
| OTA manifest          | `ota.go` `otaManifest`                                   | `o.status='active' ... ORDER BY o.revision DESC LIMIT 1` |
| bootstrap 的 OTA 提示 | `server.go` bootstrap 内联查询                           | 同上（实现时发现的第五条，见 §11）                       |

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

迁移 39 `release_canary`（38 已被 `release_notes_line_arrays` 占用），前向执行，两步：

```sql
ALTER TABLE app_releases MODIFY status ENUM('uploaded','verified','active','canary','paused','completed','rejected','rolled_back') NOT NULL COMMENT '发布状态';
ALTER TABLE app_releases ADD COLUMN canary_installations JSON NULL COMMENT '灰度设备白名单…' AFTER status;
ALTER TABLE ota_releases MODIFY status ENUM('draft','verified','active','canary','paused','superseded','rejected') NOT NULL COMMENT 'OTA状态';
ALTER TABLE ota_releases ADD COLUMN canary_installations JSON NULL COMMENT '灰度设备白名单…' AFTER status;
```

按既有迁移的写法先查 `INFORMATION_SCHEMA.COLUMNS` 判重，可重复执行（抽成了 `addColumnIfMissing`）。
**列注释里不能出现单引号**，它会提前终止 SQL 字符串字面量——第一版写成 `仅 status='canary' 时有意义` 直接让迁移报 1064，集成测试当场挡下。

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

- **名单里的设备必须已经上报过安装**。服务端按 `(tenant, platform, installation_id)` 校验存在性，拼错一个字符会当场被拒（`CANARY_INSTALLATION_UNKNOWN`）——不这么做的话，错的 ID 只会表现为"发了但那台机器没收到"，查起来很贵。
- **令牌是"这次存、下次生效"**。extra params 由原生侧持久化，本次启动那一次 manifest 请求已经发出去了。所以刚加入名单的设备通常要多开一次 App 才会拿到灰度 OTA。全量包没有这个延迟（bootstrap 当场就按身份匹配）。
- **灰度 OTA 的资源请求带不了身份**。`Expo-Extra-Params` 只加在 manifest 请求上，资源请求没有。所以 `otaAsset` 对 `canary` 的放行与 `paused` / `superseded` 同档：把关的是 manifest，资源路径只能从已经过灰度校验的 manifest 里拿到，且要逐条对得上 `object_metadata`。
- **harmony 没有安装上报**，管理端在那个平台上只能粘贴安装 ID，勾选列表是空的。

## 9. 可行性与安全性论证

本节的每条结论都在真实环境上验证过，不是推断。

### 9.1 查询计划：OR + JSON_CONTAINS 不会拖垮启动接口

顾虑是 bootstrap 每次启动都打，而 `JSON_CONTAINS` 用不上索引。在生产库（MySQL 8.0.45）上对同形状的语句取执行计划：

```
type: ref
key: uq_release_tenant_platform_build
ref: const,const
rows: 23
Extra: Using where; Backward index scan
```

三点结论：

- 走的是 `(tenant_id, platform, build_number)` 唯一索引的 **ref** 访问，不是全表扫；
- `ORDER BY build_number DESC` 由索引反向扫描满足，**没有 filesort**；
- 配合 `LIMIT 1`，MySQL 从最大 build 往下走、命中第一条满足 `WHERE` 的就停。现实里最新一条通常就是 `active`，所以实际检查的行数是个位数，`JSON_CONTAINS` 只在这几行上求值。

当前该租户 Android 发布记录共 23 条，即便退化成全部扫一遍也是 23 行的 JSON 求值。规模按 3.2 节的门槛管控即可。

### 9.2 身份校验：现成的纯函数，正好适配可选鉴权

`verifyInstallationCredential`（`installations.go:336`）读了一遍就返回错误码，**不写 `problem()` 响应、不写库**：一条 SELECT 取出凭证哈希、版本、过期时间、吊销状态，然后 `subtle.ConstantTimeCompare` 比对 SHA-256。它同时按 `(tenant, application_id, platform, installation_id)` 四元组定位记录，而这三个头客户端本来就在发。

这正是可选鉴权需要的形状：bootstrap 调它，拿到空错误码就用这个身份匹配灰度，拿到任何错误码就当匿名继续往下走，配置照发。相比之下 `authenticateInstallation` 会直接写 401 响应，只适合强鉴权端点，不能用在这里。

抗攻击性上，凭证是 32 字节随机数的 `icred_` 串，服务端只存 SHA-256，比对是常量时间的，且带过期与吊销。这与会话令牌同一档。

### 9.3 灰度令牌：复用既有的认证加密，不自造密码学

服务端已有一套令牌机制在用（`encodeReleaseArtifactToken`）：`secrets.Encrypt(json, aad)` 做认证加密，`base64.RawURLEncoding` 编码，过期时间写在载荷里，租户通过 AAD 与字段双重绑定。灰度令牌原样复刻，只换 AAD 前缀与载荷字段。

由此得到的性质不是"签名"而是"认证加密"，比签名更强：

- 客户端**读不出**里面的安装 ID，令牌对它是不透明的；
- 改一个字节就解不开，无法延长有效期或换成别人的安装 ID；
- 24 小时过期，且过期判断在服务端；
- 密钥是 `STORAGE_MASTER_KEY`，与发布产物令牌同源，不新增密钥管理面。

### 9.4 OTA 通道：extra params 是唯一能用的通道，且格式可控

`Expo-Extra-Params` 由原生侧在 manifest 请求上发出（Android `FileDownloader.kt:943`，iOS `FileDownloader.swift:359`），值是 RFC 8941 的结构化字典，形如 `canary-token="…"`。三点：

- **键必须全小写**。`expo-structured-headers` 的 `Utils.checkKey` 只接受 `lcalpha / digit / _ - . *`，键里有一个大写字母就在拼请求头时抛 `IllegalArgumentException`——`setExtraParamAsync` 本身不校验，炸在下一次启动的更新检查上。本文早先写的 `canaryToken` 会踩这个坑，实现时改成 `canary-token`。

- **持久化**：extra params 存在原生侧，**下次启动那一次原生请求就会带上**。而 `setUpdateRequestHeadersOverride` 由 JS 调用，对本次启动那一次检查已经来不及，并且标着 `@experimental`。所以令牌走 extra params 是唯一可行解，不是偏好问题。
- **无转义风险**：base64url 的字符集是 `A-Za-z0-9-_`，不含结构化字段需要转义的 `"` 与 `\`，服务端解析不会遇到歧义。

### 9.5 安全性：逐条对照攻击者能力

| 攻击者能做什么                          | 结果                      | 为什么                                                                                          |
| --------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------- |
| 伪造 `X-Installation-ID`                | 拿不到灰度                | 没有对应凭证，`verifyInstallationCredential` 返回 `INSTALLATION_CREDENTIAL_INVALID`，按匿名处理 |
| 抓到别人的安装 ID（日志、截图）         | 拿不到灰度                | 同上，ID 不是凭据                                                                               |
| 抓到灰度令牌（抓包 / 读 extra params）  | 24 小时内可冒充，之后失效 | 令牌短时；且令牌不泄漏凭证本身，无法续期                                                        |
| 篡改灰度令牌延长有效期 / 换安装 ID      | 失败                      | 认证加密，改一字节即解不开                                                                      |
| 拿到整台设备（含 SecureStore 里的凭证） | 等价于克隆这次安装        | 与会话令牌同一档；管理端可 `INSTALLATION_REVOKED` 吊销，下次请求即失效                          |
| 猜发布 ID 直接下下载接口                | 404                       | 下载接口同样带灰度条件（3.4 节），不是只靠"不告诉你 ID"                                         |
| 让服务端把灰度发给全体                  | 做不到                    | 灰度是独立状态，公开 `latest` 与匿名请求永远只看 `active`                                       |
| 拿到灰度包后篡改再分发                  | 做不到                    | 包过生产签名与 sha256 校验，服务端 pin 了签名者指纹（N1/N2/N33）                                |

### 9.6 fail-closed 的完整枚举

"认不出身份就只给 active"必须在每条分支上成立，逐个列出：

| 分支                                         | 行为                                            |
| -------------------------------------------- | ----------------------------------------------- |
| 不带任何身份头（老版本客户端）               | 匿名，只匹配 `active`                           |
| 带 ID 不带凭证                               | `INSTALLATION_CREDENTIAL_REQUIRED` → 匿名       |
| 凭证过期 / 被吊销 / 哈希不符                 | `INSTALLATION_CREDENTIAL_INVALID` → 匿名        |
| 安装记录不存在（换了 application_id 或平台） | 查询不到 → 匿名                                 |
| 不带灰度令牌取 manifest                      | 匿名，只匹配 `active` 修订                      |
| 灰度令牌过期 / 解不开 / 租户不符             | 解码失败 → 匿名                                 |
| `canary_installations` 为 NULL 或空数组      | `JSON_CONTAINS` 不成立 → 该灰度行对所有人不可见 |
| 数据库里出现 `canary` 但代码已回滚           | OR 分支不存在 → 该行对所有人不可见              |

最后两行是重点：**任何一处出错的方向都是"少发"而不是"多发"**。

### 9.7 这个方案不解决什么

- 不防有心人拿到灰度包。见 8.1 的威胁模型，目标是别误发与能撤销。
- 不防被灰度设备的持有者把包分享出去。包一旦装到设备上就在对方手里。
- 不提供百分比灰度、地区灰度。见第 1 节非目标。

## 10. 分期与工作量

| 阶段 | 内容                                                                                        | 估时   |
| ---- | ------------------------------------------------------------------------------------------- | ------ |
| 1    | 客户端上报身份（安装凭证 + OTA 短时令牌 extra param），随下一个全量版本发布                 | 0.5 天 |
| 2    | 服务端迁移 38、状态机两个转换、四条读路径、bootstrap 可选鉴权与令牌签发、灰度约束校验、审计 | 1.5 天 |
| 3    | 管理端灰度动作与设备选择、列表展示、契约同步                                                | 1 天   |
| 4    | 账户级灰度（名单换成钱包地址，凭 SIWE 会话证明），等有高价值灰度需求时再做                  | 1 天   |

阶段 1 必须先上线并铺开，阶段 2、3 才有意义。

## 11. 实现记录（2026-09-11）

阶段 1、2、3 已落地，阶段 4（账户级灰度）未做。与本文原稿的差异，逐条：

| 差异                                                                            | 原因                                                                                                                                                                  |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 迁移号 39，不是 38                                                              | 38 已被 `release_notes_line_arrays` 占用                                                                                                                              |
| OTA extra param 的键是 `canary-token`，不是 `canaryToken`                       | `expo-structured-headers` 拒绝大写键，见 §9.4                                                                                                                         |
| 读路径是**五**条，不是四条                                                      | bootstrap 里还有一条内联的 OTA 提示查询（`update.ota.revision`）。不改它的话，灰度设备在"升级中心"看到的修订号和它真正会下到的对不上                                  |
| `otaAsset` 的状态白名单加了 `canary`                                            | 不加的话灰度设备取到 manifest 却下不了资源，见 §8.2                                                                                                                   |
| `mandatoryVersion` 改为只查 active 记录                                         | 原来它跟着"取到的那一条"走。灰度记录不得设 mandatory，于是设备一进灰度就把 active 上的强制要求弄丢了——等于给那台机器单独解除了强制升级。抽出 `activeMandatoryVersion` |
| 名单里的安装 ID 校验存在性                                                      | 见 §8.2 第一条                                                                                                                                                        |
| `promote` 与 `publish` 分开                                                     | 状态机上完全一样（都到 active、都收尾旧 active），分开只为审计能区分"灰度转正"和"直接全量"                                                                            |
| `last_action` 改为存动作名（`publish` / `canary` / `promote`…），不再存目标状态 | 否则 `publish` 与 `promote`、`cancel-canary` 与其它拒绝在列表里长得一样。`set-mandatory` 本来就是这么存的，现在一致了                                                 |
| bootstrap 响应新增 `update.canary.{enrolled,otaToken}`                          | 令牌要有地方下发；`enrolled` 让客户端知道自己拿的是灰度包                                                                                                             |
| 客户端缓存快照里抹掉 `otaToken`                                                 | 缓存只用来决定启动页画哪版品牌，没必要把令牌留在明文 AsyncStorage 里                                                                                                  |

**验收用例覆盖**：§7 的 17 条里，1–11、13–17 有自动化用例（`RN-Server/internal/api/canary_test.go`，需要 `RN_TEST_MYSQL_HOST`）。第 12 条（灰度 OTA 的基线是 verified 包）走的是既有的基线校验，本轮一行没改，没有新增用例。

**代码位置**：

- 服务端：`internal/api/canary.go`（可见性 SQL、身份解析、令牌、名单校验）、`internal/store/migrations.go` 迁移 39、`internal/api/server.go`（状态机、bootstrap）、`internal/api/simplified_releases.go`、`internal/api/ota.go`。
- 客户端：`src/core/updates/canary-token.ts`、`src/core/config/bootstrap-repository.ts`、`src/core/config/bootstrap.schema.ts`。
- 管理端：`src/modules/release-management/canary-audience.tsx`、`pages.tsx`、`src/core/api.ts`。
