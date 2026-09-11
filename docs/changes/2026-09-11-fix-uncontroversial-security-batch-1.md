# Fix: 钱包安全评审剩余项里的无争议第一批（N17 / N19 / N13 iOS / §6 删除语义）

状态：Done

涉及仓库：RN-Server（主）、RN-App。评审：`docs/design/cross-platform-wallet-key-security-adversarial-review-2026-09-09.md`。

挑选标准：不需要产品/组织决策、不需要原生工程、不需要外部资源（KMS、Apple Team ID、真机）的剩余项。需要决策或原生的部分**没有**在这一批里被"顺手"改掉。

## 用户场景与现状证据

- 用户/角色：发版运营（管理端身份）、用外部钱包签名的 iOS 用户、以为"退出登录 / 卸载 = 删除钱包"的普通用户。
- 当前行为与代码证据：
  - `server.go:356` 的 `x-admin-key` 通道把请求自报的 `x-admin-id` 直接写进 `audit_events.created_by`。持钥者可以把 actor 填成任何人，追责链没有依据（评审 N17）。`grep -i rbac` 零命中。
  - `config.go:92` `ADMIN_COOKIE_SECURE` 默认 `false`，部署忘了设就是明文可携带的管理会话 cookie。
  - `app.config.ts:266` 只在 `EXPO_UPDATES_CODE_SIGNING_CERTIFICATE` 存在时注入 OTA 信任根，缺失静默跳过；仓库里没有任何"必须有证书"的开关（评审 N19）。证书路径拼错也没人检查。
  - RN-Server 有 `/.well-known/assetlinks.json`，没有 `apple-app-site-association`：N13 的 iOS 入站方向一直空着。
  - `wallets-screen.tsx` 的红色"断开此钱包"对内置钱包只是把它移出当前使用——`embedded-wallet-gateway.ts:265` 的 `disconnect` 根本不碰金库条目，可界面上没有一个字说明这件事（评审 §6 删除语义）。
- 非目标：`x-admin-key` 旁路的存废、RBAC 与双人审批、OTA 密钥仪式与服务端签名实现、iOS AASA 的真实 Team ID、删除工作流本身。这些要么等决策要么等外部资源。

## Given / When / Then

- Given 请求带正确的 `x-admin-key` 和伪造的 `x-admin-id`，When 走管理端鉴权，Then actor 记成 `ADMIN_API_ACTOR` 配置值，伪造的那个只进一条 warning 日志。
- Given 请求带正确的 key 但**不带** `x-admin-id`，Then 照样通过（身份不再从请求里来，也就不再需要它）。
- Given key 不对或未配置 `ADMIN_API_KEY`，Then 仍是 401 `ADMIN_AUTH_REQUIRED`。
- Given 没有设置 `ADMIN_COOKIE_SECURE`，Then 管理会话 cookie 带 `Secure`；显式设 `false` 才关掉。
- Given `EXPO_REQUIRE_OTA_SIGNING=1` 且非 development 构建缺证书，When 跑 `pnpm android:release` 或 `expo prebuild`，Then 两道都直接失败；开关不开时行为不变。
- Given `EXPO_UPDATES_CODE_SIGNING_CERTIFICATE` 指向不存在的文件，Then `app.config.ts` 当场报错，而不是让构建出一个不验签的包。
- Given 租户登记了 `release.ios`，When 系统拉 `https://<租户域名>/.well-known/apple-app-site-association`，Then 返回只声明 `/app/wc` 一条路径的归属声明；没登记则 404，不猜。
- Given 打开"断开此钱包"确认层，When 当前是内置钱包，Then 明确写出助记词与私钥仍留在本机；外部钱包则说明只是本应用不再持有会话。
- Given 打开安全中心，Then「钱包与会话」下方常驻一句：断开 / 退出 / 卸载都不删除本机密钥材料。

## UI 与交互状态

- 「断开此钱包」确认层新增一段说明，按 connector 分两种文案。
- 安全中心「钱包与会话」分组下新增脚注（`sec-wallets-footnote`）。
- 「断开所有会话」确认层、个人中心「断开连接并退出」确认层各补一句"不会删除本机助记词与私钥"。
- 新增 5 个字典键（内置字典 → seed 1124 → 1128）。

## 技术影响

**RN-Server**

- `config.go`：新增 `AdminAPIActor`（`ADMIN_API_ACTOR`，默认 `api-key-automation`）；`AdminCookieSecure` 默认由 `false` 改为 `true`。`.env.example` 里本地开发仍显式 `false`，`deploy/web4/compose.yaml` 的默认值同步改为 `true`。
- `server.go` `authenticate()`：api-key 分支的 actor 取配置值；自报的 `x-admin-id` 与配置不符时记 warning 后忽略；这条分支不再要求带那个头。
- 新增 `release_identity_apple.go`：`release.ios` 的读写（`GET/PUT /v1/admin/release-identity/ios`，Team ID 规范化为大写并校验 10 位字母数字，bundle id 校验反向域名）、`appleAppSiteAssociation()` 与 `/.well-known/apple-app-site-association` 路由。刻意与 `release_identity.go` 的 Android 版平行而不是抽公共层：两边字段没有交集，抽象出来的只有乐观锁那几行，不值得为它动一条已经上线的 P0 路径。
  - **文件名不能叫 `release_identity_ios.go`**：`_ios` 是 Go 的 GOOS 构建约束后缀，那样整个文件只在 `GOOS=ios` 时参与编译，本机 `go build` 会报"方法不存在"。
- 契约 2026.09.12 增加两条路由与 `IOSReleaseIdentityWrite`；RN-App 的 pin 副本同步。
- **RN-Admin 暂无 iOS 发布身份界面**：没有 Apple Team ID，现在也没人能填。等 Team ID 到位时再补，接口先就位。

**RN-App**

- `app.config.ts`：证书路径存在性检查（无条件）＋ `EXPO_REQUIRE_OTA_SIGNING` 门禁（默认关）。
- `scripts/build-android-release.mjs`：同一条判定的前置版本，让 `pnpm android:release` 在跑任何构建步骤前就说清楚缺什么；`EXPO_UPDATES_CODE_SIGNING_CERTIFICATE` 与 `EXPO_REQUIRE_OTA_SIGNING` 加入允许从 `.env.local` 读的白名单（证书是公钥材料，开关也不是秘密）。
- `builtin-messages.ts` 新增 `security.wallets.footnote`、`security.disconnectAllHint`、`wallets.disconnectHint.embedded` / `.external`，并扩写 `profile.logoutHint`；`wallets-screen.tsx` 用两个字面量 key 的三元式而不是拼 key，保持静态可检。

## 追加：换签名密钥期间的直装门禁（第 2 档第 10 项，runbook §8.5）

线上核对（`GET /v1/admin/installations/overview`）发现生产租户 19 台装机里 **12 台还是 debug 签名**（build ≤ 25），6 台 7 天内活跃、5 台建过钱包，而 1.3.7 (33) 已经是 `active` + `mandatory`。这 12 台现在冷启动就弹不可关闭的强制更新，按钮亮着，下载能成功，装到系统安装器必定被签名不一致拒绝——点一次失败一次，没有解释也没有出口。

原计划的"按版本区间下发 `directUpdateEnabled`"需要新配置。改成按**事实**判定，不引入配置也不会忘了维护：

- `visibleSimplifiedRelease` 多读一列 `file_metadata`，取出目标包入库时记的 `signerSha256`（`simplified_releases.go:319` 早就在写）。
- 新增 `installedReleaseSigner`：按 `(tenant, platform, version, build_number)` 反查设备当前这个 build 的同一字段。
- 新增纯函数 `directInstallAllowed(featureEnabled, platform, installedSigner, targetSigner)`：两边都知道且不相等 → `false`；**任何一边不知道 → 保持原行为**。旧记录没有这个键、或那个 build 从没上传过，都不该把正常升级的设备一起挡掉。
- bootstrap 的 `features.directUpdateEnabled` 改由它决定；`app.buildNumber` 顺手复用同一个已解析的变量。

**必须说清楚的局限**：关掉直装之后客户端走 `Linking.openURL(actionUrl)`（`update-modal.tsx:122-125`），用浏览器下载同一个包——装到系统安装器那一步**仍然会被拒**。这一项消除的是应用内的失败循环，不是让旧签名装机能装上新包。真正的出路只有"备份助记词 → 卸载 → 重装"，要么写进 1.3.7 的 `releaseNotes`（强制更新弹层渲染前 3 条，该渲染自 `f0fc88f`/2026-08-31 起就在，早于 1.2.4，12 台全看得到），要么发 runbook §8 第 1 步的迁移 OTA。**两者都是改线上数据/发包，本批次没有动**，已在 `RELEASE_SIGNING_ROLLOUT.md` §8 登记为欠账。

## 验证与发布

- RN-Server：`gofmt` / `go vet` 干净，`go test ./...` 11 个包全绿。新增 `admin_identity_test.go`（自报身份被忽略 / 不带也能过 / 错 key 仍 401 / 未配置时整条通道关闭，走真实 gin 路由且不碰数据库）与 `release_identity_apple_test.go`（规范化与校验、请求体在触库前被拒、AASA 只声明一条窄路径）。
- RN-App：`pnpm check` 全绿，129 套 / 941 用例（+4）。新增用例：OTA 信任根开关开/关两种走向、断开内置钱包的说明文案、安全中心脚注。
- **线上存量核对已完成**（只读 admin API）：19 台装机，12 台 debug 签名，详见上一节与 `RELEASE_SIGNING_ROLLOUT.md` §8 的核对记录。结论是 §8 **不能**关闭。
- **未包含且需要你点头的两件**：改 1.3.7 的线上 `releaseNotes`、发 1.2.x runtime 的迁移 OTA。都会改变真实设备上看到的东西，不在"无争议"范围内。
- 无原生变更，可走 OTA；服务端改动需要重新部署，`ADMIN_COOKIE_SECURE` 未显式设置的环境会从"cookie 不带 Secure"变成"带 Secure"——web4 的 `.env` 已经是 `true`，其它环境部署前确认全链路 TLS。
