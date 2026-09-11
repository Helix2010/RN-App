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

## 验证与发布

- **passed** — `pnpm check` 全绿，130 套 / 953 用例（+1 套 +12 用例）。
- **passed** — `pnpm android:verify artifacts/anyfun-1.3.7-build33-release.apk anyfun`：已上线产物的 34 条权限全部在允许列表上，门禁通过。
- **not run** — 模拟器/真机。合约钉住的失败路径没有在真机上走过（需要一个会换地址的平台环境）。
- 无原生变更，可走 OTA。
