# Fix: 无争议第二批——平台合约 TOFU 钉住（N3）与权限允许列表（N28）

状态：Done

涉及仓库：RN-App。评审：`docs/design/cross-platform-wallet-key-security-adversarial-review-2026-09-09.md`。

## 用户场景与现状证据

- 用户/角色：开通预测账户并对平台合约授权的用户；发版负责人。
- 当前行为与代码证据：
  - `core/predict-platform/public-info.ts:146` 的 `platformContracts()` 把 `GET {gamma}/public-info` 返回的合约地址原样采纳，`http-predict-account-gateway.ts:199` 直接拿去用。那条链路的真实性只到 TLS 为止——**平台域名本身来自未签名的 bootstrap**。能改配置或能顶替那个域名的人，可以把 `collateralToken` / `ctfExchange` 换成自己的地址，而开通流程会对它做无限额授权。这是评审 N3 里的资金路径。
  - `scripts/lib/android-release-identity.js:15` 只有 `FORBIDDEN_PERMISSIONS`（一条）。禁用列表只认得我们已经想到的那几个；真正危险的是**新冒出来**的权限——某个依赖升级顺手加了录音、定位或读联系人，禁用列表永远不会提到它，而装机用户看到的是一个权限变多了的钱包。
- 非目标：N3 的终态（把地址编译期固化进 `tenant.json`，平台换合约就必须发原生版）。那要一个产品决策，本批次不碰。

## Given / When / Then

- Given 第一次成功取到平台合约，Then 整组地址与精度被记下来（按 domain + scopeId + chain 分键）。
- Given 之后某次 `public-info` 换了 `collateralToken`（或任何一个合约、任何一个精度），When 取平台上下文，Then 抛 `PredictPlatformContractsChangedError` 并说出是哪几个字段变了，预测功能拒绝继续，**不重试**。
- Given 平台只是换了地址的 checksum 大小写，Then 不算变化。
- Given 本地那条记录坏了（不是合法 JSON），Then 重新钉住而不是把用户永久卡死；重新钉住之后这条防线照常生效。
- Given 换了链或换了平台域名，Then 那是另一组合约，各钉各的，不会被上一组挡住。
- Given 正式包声明了允许列表之外的权限（含 `uses-permission-sdk-23:` 形式），When 跑 `pnpm android:verify` 或 CI 门禁，Then 构建失败并列出是哪几条。
- Given 商店渠道的包声明了 `REQUEST_INSTALL_PACKAGES`，Then 失败；直发渠道则允许。
- Given 包里有本租户的 `<package>.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`，Then 允许；换成别的租户前缀则失败。

## UI 与交互状态

无新增界面。合约不一致时预测相关查询进入错误态且不重试（`use-predict-account.ts` 的 `predictRetry`），与既有的 scopeId / chainId 不符走同一条路。

## 技术影响

- 新增 `src/core/predict-platform/contract-pin.ts`：`contractPinRecord`（地址小写、精度一并纳入、可选适配器缺省记 `null`）、`contractPinDiff`（按字段名报差异，错误信息能直接说出是哪个合约动了）、`assertPinnedPlatformContracts`（TOFU）。
- **精度也算合约身份的一部分**：USDW 的 `decimals` 变了，同一个数字就是另一笔钱，所以它和地址一起钉。
- **失败是有意 fail closed 的**。平台真的迁移合约时走 `CONTRACT_PIN_EPOCH`：改这个常量并发一次 App/OTA，所有设备重新 TOFU。"必须改代码才能放行"正是这条防线的意义——不要为了让某台设备恢复而在本地清记录。
- 本地记录损坏时选择重新钉住而不是拒绝：那个键只影响这一条防线，把损坏当成不一致会让用户永久卡住，重新钉住至少恢复到"从现在起不能再变"。
- `scripts/lib/android-release-identity.js`：新增 `ALLOWED_PERMISSIONS`（34 条，基线取自已上线的 anyfun 1.3.7 (33)，逐条 `aapt dump badging` 核对）、`DIRECT_ONLY_PERMISSIONS`（`REQUEST_INSTALL_PACKAGES`，只有直发渠道能有）、`allowedPermissionsFor(tenant)`（额外放行本租户的 `<package>.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`）。禁用列表保留，报错更直白。
  - 测试夹具里那条 `uses-permission-sdk-23: ACCESS_MEDIA_LOCATION` 是当初为了测 sdk-23 解析编出来的，两个真实 APK（1.2.11、1.3.7）都没有——允许列表正确地把它拦了下来，用例改成断言"它应该被拒"。

## 追加：calldata 语义解码与补齐的费率表（N22 的无争议部分）

守卫此前只看 chainId / to / 手续费，对 `data` 里写着什么一无所知——"把全部余额的
支配权交给某个地址"和"转 1 块钱"在签名前长得一模一样（`transaction-guard.ts` 全文
91 行，`grep selector\|spender\|decode` 零命中）。

- 新增 `src/core/wallet/signer/calldata.ts`：`describeCalldata()` 用 ethers `Interface`
  解出 `approve` / `increaseAllowance` / `permit` / `setApprovalForAll` / `transfer` /
  `transferFrom`，给出 spender（或收款人）、金额与"是否无限额度"。
  - **`permit` 的 spender 在第 2 个参数位**，`approve` 在第 1 个。取错位置会在确认
    界面上显示成钱包自己的地址，看起来完全正常——专门有一条用例钉住它。
  - "无限"按 `>= 2^255-1` 判定：有些前端用 2^255-1，链上效果与 2^256-1 一样。
  - `grantsAllowance()` 把"交出支配权"和"转钱"分开，`setApprovalForAll(false)` 是撤销
    不算授权。
- `assertSubmittable` 现在会拦 `impossibleIntentReason()` 认定的组合：把额度授权给
  零地址（撤销应当是把额度设成 0）、转账到零地址（代币被销毁）。只列"任何正常流程
  都不会产生、且签下去救不回来"的情况，**不做策略判断**。
- **认不出来不拦**。解不开、不在词表里、参数截断，一律返回 `null` 放行——把"看不懂"
  变成拒绝就是拒绝服务。评审 §12.2 那条"真实资金档未知 calldata 默认拒绝"会改变现有
  流程的可用性，是待决策项，不在这里。
- 费率表补上 `monad` (143)：评审记的是"费率表仅 4 条链"，第 5 条链此前静默退回
  10000 Gwei 的通用红线。新增的用例用 `Record<ChainId, true>` 枚举全部链，往联合类型里
  加链却忘了给红线会直接变成**类型错误**，而不是一条悄悄没有保护的链。

仍未做（需要决策或原生）：把解码结果显示在每个确认层上、spender 白名单、未知
calldata 在真实资金档默认拒绝、`signTypedData` 的策略。

## 验证与发布

- **passed** — `pnpm check` 全绿，131 套 / 968 用例（+2 套 +27 用例）。
- **passed** — `pnpm android:verify artifacts/anyfun-1.3.7-build33-release.apk anyfun`：已上线产物的 34 条权限全部在允许列表上，门禁通过。
- **not run** — 模拟器/真机。合约钉住的失败路径没有在真机上走过（需要一个会换地址的平台环境）。
- 无原生变更，可走 OTA。

## 追加：依赖漏洞体检接入 CI（N28 的 SCA 一项）

`grep -rn "audit\|snyk\|osv" .github/workflows` 此前零命中——依赖漏洞完全没有人看。

- 新增 `scripts/check-dependency-audit.mjs`（`pnpm audit:deps`），整理 `pnpm audit --json`
  的结果成按严重度排序的表，同一个包的多条公告合成一行并附上引入路径。
  接进 `app-quality` 的 verify job。
- **当前是报告模式**：有漏洞不挡发布。"high/critical 一律阻断"要先定 SLA 与例外流程，
  否则上游第一次发公告就会把所有人的发布卡死，最后一定有人把这一步注释掉。
  定了之后加 `--fail-on high` 即可，判定逻辑和用例都已经在。
- **但 audit 跑不起来必须 fail closed**。评审里记过"本次 `pnpm audit` 未成功"，
  而那次失败是**静默**的：CI 绿着，没有人知道这项检查其实没跑。注册表不可达、
  代理拦截、输出不是合法 JSON，现在都会让这一步变红并打出原始 stderr。
  一个跑不起来的安全检查比没有这项检查更坏，因为它让人以为已经查过了。
- `--input <file>` 读一份抓好的结果：脚本因此可以用固定夹具测试，不依赖网络，
  也方便排查"CI 上看到的到底是哪一份"。
- 当前基线（2026-09-11）：23 条公告，17 high / 6 moderate，全部来自构建期工具链的
  传递依赖（`@expo/config-plugins` → `xcode` → `plist` → `@xmldom/xmldom`、
  `babel-jest` → `js-yaml`、`@react-navigation` → `decode-uri-component`）。
  没有一条在运行时的钱包路径上。

**未做**：SBOM。要么加 `@cyclonedx/cyclonedx-npm` 这类工具（本身是一次供应链决策），
要么自己拼 CycloneDX（容易产出"看着像官方格式但其实不对"的东西）。这一项需要先选定工具，
不属于"无争议"。

## 追加：SBOM（§12.2，替换上一节"未做"的结论）

上一节写的是"SBOM 需要先选工具，不属于无争议"。工具选定为 **syft**（Anchore 的 Go 单二进制，按固定版本 + 固定 sha256 下载，**不进 `package.json`**——为了做供应链安全而往依赖树里塞一个新的大依赖是自相矛盾的）。

### 扫什么：实测推翻了原计划

原本打算扫构建出来的 APK（"用户手机上装了什么"）。实测（syft 1.51.1）：

| 扫描目标 | 结果 |
| --- | --- |
| Android APK 本身 | **0 个组件** |
| 整个仓库目录 | 1689 个，约 27% 是噪声 |
| `pnpm-lock.yaml` | 1230 个 npm 包，全部带版本，零噪声 |

- **扫 APK 没用**：代码在 `classes.dex` 里，syft 没有 dex 编目器（它的 "apk" 支持指的是 Alpine 的 apk）。它不会报错，只会安静地输出一份 0 组件的合法 CycloneDX 文档。
- **扫仓库目录会说谎**：噪声全部来自 `node_modules` 内部 vendor 的文件——`react-native-qrcode-svg` 里的 `Gemfile.lock`（38 个 gem）、`react-native-svg` 里的 Windows 工程（10 个 nuget）、Expo 各包的 `-sources` jar（伪装成 maven）。这些一个都不进 APK，写进 SBOM 只会让人以为产物里有它们。

所以扫 lockfile。

### 实现

- 新增 `scripts/build-sbom.mjs`（`pnpm sbom`）：调 syft 扫 `pnpm-lock.yaml`，把结果**绑定到具体产物**——`metadata.component` 换成该 APK（包名、版本、sha256），`metadata.properties` 写进租户、buildNumber、产物文件名与 source commit。不绑定的 SBOM 只是"某次扫描的结果"，回答不了"用户手机上那个包里有什么"。
- **丢掉 syft 列出的"被扫文件自己"那一条**：它没有版本号，而且 `name` 是**绝对路径**（`/home/ubuntu/.../pnpm-lock.yaml`），会把构建机目录结构写进一份要分发出去的文件。依赖图里指向它的边一并清掉。
- **两条 fail-closed 守卫**，都来自 `pnpm audit` 那次教训（静默产出空结果的安全工具比没有更坏）：组件数低于 200 判定为"扫错了目标"而不是"依赖真的很少"；任何组件缺版本号即失败——SBOM 的全部意义就是回答"装的是哪个版本"。
- CI：`android-release-gate` 在 `pnpm android:verify` 通过后生成 SBOM，`actions/upload-artifact@ea165f8d`（v4.6.2）保留 90 天。syft 按 `SYFT_VERSION=1.51.1` + `SYFT_SHA256=8fcb3301…` 下载并校验。

### 已知边界（写在文件里，不只写在文档里）

**原生依赖不在这份 SBOM 里。** 本工程没有 Gradle 依赖锁定，仓库里没有权威的原生依赖清单可读；APK 又是 dex。文件的 `rn-app:coverage` 属性如实写着 `javascript-only`，`rn-app:coverage-note` 说明原因——拿到这份 SBOM 的人未必读过 runbook。补上这一半的前置条件是 N28 里另一项欠账：给 Gradle 加 `verification-metadata.xml`，那份文件本身就是权威的 Android 依赖列表。

### 实测验证

对已上线的 1.3.7 (33) 跑了一次：1230 个组件，绑定的 sha256 `b9e300ce…8e86` 与线上 `GET /v1/mobile/bootstrap` 返回的 `update.full.sha256` **逐字节一致**——这份 SBOM 绑的就是用户正在下载的那份字节。
