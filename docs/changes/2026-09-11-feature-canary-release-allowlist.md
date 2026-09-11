# Feature: 灰度发布与设备白名单（全量包 + OTA）

状态：Done

涉及仓库：RN-Server（主）、RN-App、RN-Admin。设计与论证：`docs/design/canary-release-allowlist-2026-09-11.md`。

## 用户场景与现状证据

- 用户/角色：发版运营。想把一个新版本先只发给几台测试机，确认没问题再全量。
- 当前行为：发布只有"全量"一档。`publish` 事务会把同平台其它 active 一律收尾，`status='active'` 就是"所有人现在该拿的那一个"，全仓 22 处读路径依赖这个不变量。想定向只能靠不告诉别人下载地址——而 `/v1/public/releases/latest` 是匿名公开的，猜不出也拿得到。
- 代码调用链：`server.go` `transitions` → `releaseAction` 事务；读路径 `activeSimplifiedRelease`（bootstrap）、`publicLatestReleaseFromDomain`、`publicReleaseDownload`、`ota.go` `otaManifest`，外加 bootstrap 里一条内联的 OTA 提示查询。
- **服务端此前不知道请求来自哪台设备**：bootstrap 只读 `x-app-version` / `x-build-number` / `x-distribution-channel` / `x-platform`，OTA manifest 只读 expo 的平台 / 运行时 / 渠道。安装凭证机制（`app_installations.credential_hash`、`verifyInstallationCredential`、客户端 `installationAuthorization()`）早就有，只是没用在这条路径上。
- 非目标：百分比灰度、地区灰度、iOS；账户级灰度（设计阶段 4）留到真有高价值灰度需求时再做。

## Given / When / Then

- Given 一条 `canary` 记录且我的安装在名单里，When 拉 bootstrap，Then 拿到灰度版本；Given 我不在名单里，Then 只拿到 active，完全看不到它。
- Given 请求不带安装 ID，或带了 ID 没带凭证，或凭证过期 / 被吊销 / 对不上，When 拉 bootstrap，Then 按匿名处理只给 active，**而 bootstrap 本身照常返回完整配置**——它是启动门禁，不能因为身份问题失败。
- Given 我在名单里，When 下载灰度包，Then 200 / 206；Given 我不在名单里但知道发布 ID，Then 404。
- Given 灰度期间发布了一个新的全量版本，When 名单内设备再拉 bootstrap，Then 按 `build_number` 取大的那个；灰度记录本身不被收尾。
- Given 名单为空，When 转灰度，Then `CANARY_AUDIENCE_REQUIRED`；Given 名单里有这个租户下不存在的安装 ID，Then `CANARY_INSTALLATION_UNKNOWN` 并列出是哪几个。
- Given 一条记录已勾"强制升级"，When 转灰度，Then `CANARY_MANDATORY_FORBIDDEN`；Given 一条记录在灰度中，When 开强制升级，Then `RELEASE_FLAG_LOCKED`。
- Given 我拿到的是灰度版本，When active 记录上有强制升级要求，Then 那个要求仍然生效——不会因为进了灰度就被单独解除。
- Given 灰度转正，When 执行 `promote`，Then 同一条记录变 active、旧 active 转历史、名单清空，审计链上 `canary` 与 `promote` 两条都在。
- Given OTA 灰度，When 名单内设备取 manifest（带 bootstrap 下发的灰度令牌），Then 拿到灰度修订；令牌过期 / 伪造 / 不带，Then 静默回到 active 修订，不报错。
- Given 令牌是另一个租户签发的或被改过一个字节，When 解码，Then 失败，按匿名处理。

## UI 与交互状态

管理端「发布记录」：`verified` 行多一个「灰度发布」（已勾强制升级时置灰并说明原因），`canary` 行有「转为正式发布」「修改设备」「取消灰度」，状态列下显示名单设备数。同平台出现 build 不低于它的 active 时，灰度行多一条提示「已被更高的正式版盖过……建议取消」——**只提示，不自动改状态**，静默的状态变更事后查不清。

灰度动作的侧滑面板里是设备选择器：从「安装与设备」勾选，或粘贴安装 ID（空格 / 逗号 / 换行都当分隔符）。名单为空时「继续确认」置灰。二次确认弹窗里带上设备台数。OTA 列表同一套。

## 技术影响

**RN-Server**

- 迁移 39 `release_canary`：`app_releases` / `ota_releases` 的 status ENUM 各加 `canary`，各加一列 `canary_installations JSON NULL`。ENUM 只加值、列可空，旧代码读到都不受影响，回滚时不要删。
- 新增 `internal/api/canary.go`：可见性 SQL 片段（两条读路径共用，免得各写一遍走样）、`canaryAudienceID`（可选鉴权，认不出返回空串）、灰度令牌的认证加密与 RFC 8941 字典解析、名单规整与存在性校验、审计摘要。
- 状态机：`canary`（verified→canary）、`promote`（canary→active）、`cancel-canary`（canary→rejected）、`set-canary-audience`。`publish` 那句收尾语句只扫 `status='active'`，灰度行天然不受影响；转灰度也不收尾任何东西。**现有发布逻辑一行没改。**
- 五条读路径统一成「active 或（灰度且我在名单里）」，按 `build_number` / `revision` 取大的一条。
- bootstrap 变成可选鉴权，并在响应里加 `update.canary.{enrolled,otaToken}`。
- `verifyInstallationCredential` 抽出 `…For(c, tenant, id)`：bootstrap 不挂 `domainTenantScope`，上下文里没有 tenantId。

**RN-App**

- bootstrap 请求带上 `installationAuthorization()` 的 `X-Installation-ID` + `Authorization: Installation …`；没注册过就不带，照常启动。
- 新增 `core/updates/canary-token.ts`：把令牌交给 `Updates.setExtraParamAsync`。**键必须全小写**（`canary-token`）——`expo-structured-headers` 的 `Utils.checkKey` 只认 lcalpha/digit/`_-.*`，大写键会在拼 manifest 请求头时抛异常；`setExtraParamAsync` 本身不校验，炸在下一次启动的更新检查上。写失败一律吞掉（开发构建会直接抛）。
- 缓存快照里抹掉 `otaToken`：缓存只用来决定启动页画哪版品牌。

**RN-Admin**

- 新增 `CanaryAudiencePicker`；`adminApi.action` / `otaAction` 增加可选的 `installations`；`StatusPill` 与配色加 `canary`。

## 验证与发布

- RN-Server：`go vet` 干净；`go test ./...` 全绿；`canary_test.go` 的 14 组用例（覆盖设计 §7 的 1–11、13–17）在 MySQL 8.0.46 上跑通。第 12 条走既有基线校验，本轮没改，未新增用例。
- RN-App：`pnpm check` 全绿，129 套 / 931 用例；契约 2026.09.12。
- RN-Admin：`pnpm check` 全绿，14 套 / 102 用例。
- **上线顺序**：迁移必须先于任何写入 `canary` 的代码——ENUM 里没有这个值时严格模式报错、非严格模式静默截断，后者会把记录写坏。
- **第一个灰度版本定向不到尚未升级的老设备**：bootstrap 带身份是这一版才有的。必须先全量发一版带身份上报的客户端，之后才能开始灰度。这是链条的固有顺序。
- 无原生变更（`setExtraParamAsync` 是既有 API），客户端这部分可随 OTA 发布。

## 模拟器实测（2026-09-11，四台在线模拟器对生产环境）

| 验证项                        | 结果                                                                                                     |
| ----------------------------- | -------------------------------------------------------------------------------------------------------- |
| 迁移 39 上生产                | `schema_migrations` 到 39，`app_releases.status` ENUM 含 `canary`，`canary_installations` 列在位         |
| 匿名 `latest` 回归            | 仍然只返回 active，灰度期间也一样                                                                        |
| bootstrap 新增段              | 匿名请求拿到 `canary={enrolled:false, otaToken:null}`，配置照发                                          |
| 客户端上报身份                | 四台都拿到了服务端签发的灰度令牌（只有验证过凭证的安装才发）                                             |
| 令牌落到原生侧                | `updates.db` 的 `json_data.extraParams` = `{"canary-token":"…"}`，键是小写                               |
| 带令牌的 manifest 请求        | `Check → CheckCompleteUnavailable`，无异常——大写键那个坑确实被绕开了                                     |
| 灰度只对名单可见              | 名单内那台 `latest=1.3.3 / decision=recommended / enrolled=true`，另外三台 `latest=1.3.2 / none / false` |
| 改名单                        | 把名单换到另一台后，原来那台掉回 1.3.2，新那台升到 1.3.3，始终只有一台                                   |
| 名单为空 / ID 拼错            | 生产上分别被 `CANARY_AUDIENCE_REQUIRED`、`CANARY_INSTALLATION_UNKNOWN` 拒绝                              |
| 匿名拿灰度包 ID 下载          | 404；同一时刻 active 包匿名下载 206                                                                      |
| 令牌不落明文缓存              | AsyncStorage 里的 bootstrap 快照 `otaToken=null`，令牌只在原生库里                                       |
| 服务端下载鉴权（curl 真凭证） | 带全套身份头 206，去掉凭证 404                                                                           |
| 死灰度行                      | 发了更高的 active 之后，灰度行仍是 `canary` 且名单还在——不自动改状态                                     |
| 取消灰度 / 转正               | `cancel-canary` → `rejected` 名单清空；`promote` → `active` 旧 active 收尾                               |
| **灰度设备下载灰度包**        | **两次失败才通**，原因见下——客户端下载器的坑                                                             |

## 实现时发现并修掉的坑

- **迁移注释里的单引号**把 SQL 字符串字面量提前截断，`ALTER TABLE` 报 1064。集成测试当场挡下。
- **`canaryToken` 这个键会让 manifest 请求在原生侧抛异常**（见上）。设计原稿写的就是它，改成 `canary-token`。
- **强制升级会被灰度悄悄解除**：`mandatoryVersion` 原来跟着"取到的那一条"走，而灰度记录不得设 mandatory——于是给某台机器发个灰度包就等于单独给它关掉了强制升级。抽出 `activeMandatoryVersion`，强制版本只认 active。
- **`otaAsset` 会把灰度设备卡在"取到 manifest 却下不了资源"**：它的状态白名单里没有 `canary`。资源请求不带 `Expo-Extra-Params`（只有 manifest 请求带），所以这里没有身份可验，与 `paused` / `superseded` 同档放行；把关的是 manifest。
- **bootstrap 里还有第五条读路径**（OTA 提示）。不改它的话，灰度设备在"升级中心"看到的修订号和它真正会下到的对不上。
- **安装包下载这条链路两层都漏**（只有真机点一次下载才暴露）。现象是：名单里的设备在设置页看得到"有新版本可用"，一点下载就是"下载失败"。设计 §3.4 点名它是"最容易漏的一处"，结果它漏了两次：(1) 客户端 `createExpoApkDownloadDeps` 把 `DownloadOptions` 传成 `{}`，请求匿名发出去；(2) 补上凭证后**仍然 404**——服务端按 `(tenant, application_id, platform, installation_id)` 四元组定位安装记录，而这条请求走 `expo-file-system`、不经过 `apiClient`，`X-Platform` 与 `X-Application-ID` 两个默认头根本没发，查询落到 `application_id='unknown'` 且 `platform=''`。修法是抽出 `installationTransportHeaders()`，给所有不走 `apiClient` 的传输共用。**对照实验**钉死了原因：同一台设备、同一个包，状态是 `canary` 时"下载失败"，`promote` 成 `active` 后同一步操作"Downloading 100%"。
- **静默 404 没法查**。客户端只看得到"下载失败"，分不清是没带凭证、四元组不全、凭证过期被吊销、还是真的不在名单里。服务端补了一条 warn：只在请求方自报了安装 ID、且目标确实是灰度记录时多查一次状态并记下原因。
