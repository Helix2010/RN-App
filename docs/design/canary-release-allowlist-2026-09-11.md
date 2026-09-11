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

| 用途 | 位置 | 现在的条件 |
| --- | --- | --- |
| bootstrap 的更新决策 | `simplified_releases.go` `activeSimplifiedRelease` | `status='active' ORDER BY build_number DESC LIMIT 1` |
| 公开最新版本 | `simplified_releases.go` `publicLatestReleaseFromDomain` | 同上 |
| 公开下载 | `simplified_releases.go` `publicReleaseDownload` | `id=? AND status='active'` |
| OTA manifest | `ota.go` `otaManifest` | `o.status='active' ... ORDER BY o.revision DESC LIMIT 1` |

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

`status='active'` 的不变量保留：它仍然只有一条，仍然是「所有人该拿的那一个」。22 处依赖它的读路径里，只有第 2 节表中的四条需要改。

### 3.2 白名单挂在发布记录上，不是设备标签

`app_releases` 与 `ota_releases` 各加一列：

```sql
canary_installations JSON NULL COMMENT '灰度设备白名单，installation_id 字符串数组；仅 canary 状态有意义'
```

**为什么挂在记录上而不是给设备打全局标签**：同一台机器可以在 A 版本的灰度里、不在 B 版本的灰度里，全局标签表达不了。挂在记录上还能在转灰度时强制校验「名单为空即拒绝」，这正是"灰度发布必须指定设备"的落点。

**容量**：JSON 列适用于几十到一两百台测试机。超过这个规模再拆成 `release_canary_installations` 关联表（届时读路径改成 `EXISTS (SELECT 1 FROM ... )`，查询形状不变）。文档里写明这个门槛，不要等它慢慢长大。

### 3.3 设备身份送到决策点

| 链路 | 做法 |
| --- | --- |
| bootstrap / latest / download | `api-client.ts` 的默认请求头加 `X-Installation-ID`（已有的三个头旁边），服务端读取 |
| OTA manifest | `expo-updates` 自带 `Updates.setExtraParamAsync("installationId", id)`，manifest 请求原生携带 `Expo-Extra-Params`，这是它为灰度设计的机制，不要自造 |

设置时机：安装注册成功之后（`installation-service.ts` 拿到 id 的同一处），失败不影响启动。

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

### 3.5 灰度版本的行为约束

- **不得设 `mandatory`**。强制升级提示影响的是全量用户的决策口径，灰度版本设了它没有意义且危险。转灰度时校验，已是 `mandatory` 的记录拒绝转灰度。
- **不参与 `minSupportedVersion` 判定**。`resolveUpdateDecision` 的 `Latest` 入参在灰度设备上用灰度版本，`MandatoryVersion` 仍只来自 active 记录。
- **OTA 的基线校验不变**：灰度 OTA 的 `baseReleaseId` 仍必须是 `verified` 或 `active` 的基线包，`applicationId` 绑定照旧。

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

| # | 场景 | 期望 |
| --- | --- | --- |
| 1 | 白名单内设备请求 bootstrap | 拿到灰度版本 |
| 2 | 白名单外设备请求 bootstrap | 拿到 active 版本，完全看不到灰度版本 |
| 3 | 不带安装 ID 的请求 | 只拿 active，灰度分支不生效 |
| 4 | 匿名 `/v1/public/releases/latest` | 永远只返回 active |
| 5 | 白名单内设备下载灰度包 | 200 / 206，不是 404 |
| 6 | 白名单外设备拿灰度包 ID 直接下载 | 404，不能靠猜 ID 绕过 |
| 7 | 灰度期间发布一个新的全量版本 | 灰度记录不被收尾；白名单设备按 build 取大的那个 |
| 8 | 灰度转正 | 同一条记录变 active，旧 active 被收尾，审计链连续 |
| 9 | 名单为空时转灰度 | 拒绝，`CANARY_AUDIENCE_REQUIRED` |
| 10 | 给灰度记录设 mandatory | 拒绝 |
| 11 | OTA 灰度，白名单内 / 外设备取 manifest | 内拿到灰度修订，外拿到 active 修订 |
| 12 | 灰度 OTA 的基线是 verified 包 | 允许，与现有规则一致 |

## 8. 已知限制

**白名单只对会上报身份的版本有效。** bootstrap 与 manifest 现在都不带安装 ID，所以**第一个灰度版本无法定向到尚未升级的老设备**。必须先全量发一版带身份上报的客户端，之后才能开始灰度。这是链条的固有顺序，没有绕法。

安装 ID 是客户端自报的，可被改机工具伪造。它挡的是「误发给不该收的人」，不是「阻止有心人拿到灰度包」。灰度包本身仍然经过完整的签名与完整性校验，拿到也无法篡改。真要防的话需要把名单绑到已登录账户或设备证明，不在本轮。

## 9. 分期与工作量

| 阶段 | 内容 | 估时 |
| --- | --- | --- |
| 1 | 客户端上报身份（请求头 + OTA extra param），随下一个全量版本发布 | 0.5 天 |
| 2 | 服务端迁移 38、状态机两个转换、四条读路径、灰度约束校验、审计 | 1 天 |
| 3 | 管理端灰度动作与设备选择、列表展示、契约同步 | 1 天 |

阶段 1 必须先上线并铺开，阶段 2、3 才有意义。
