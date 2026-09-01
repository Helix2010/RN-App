# 外部钱包唤起、操作反馈、强制升级（2026-09-01）

三批改动，起因是两句用户反馈：「钱包操作点了没反馈，其实已经操作了」「点 MetaMask 或 OKX 连接外部钱包，点了没反应」，以及一个需求：「管理端发版时能选强制升级」。

## 第一批：外部钱包"点了没反应"

不是反馈问题，是功能真的用不了。四个独立缺陷叠在一起。

### 1. AndroidManifest 缺 `<queries>`，`canOpenURL` 恒为 false

`android/app/src/main/AndroidManifest.xml` 的 `<queries>` 只有 Expo 默认加的 `https`，targetSdk=36。RN 的 `Linking.canOpenURL` 实现是 `Intent.resolveActivity(packageManager) != null`（`IntentModule.kt:153`），而 Android 11+ 的 package visibility 会把**未在 `<queries>` 声明的 scheme 一律过滤掉**——哪怕 MetaMask 就装在机器上。

两处都栽在它上面：连接时唤起钱包（落到二维码，手机没法扫自己的屏幕），以及**签名时把用户切到钱包**（请求已经通过 relay 发出去，用户却被留在原地，App 干等到超时）。后者正是"其实已经操作了"的来源。

改法两条腿：
- 新增 config plugin `plugins/with-wallet-deep-links.js` 声明四个 package 与对应 scheme，让探测恢复真实；
- **唤起动作不再依赖 `canOpenURL`**，直接 `openURL` 失败再退。`openURL` 走 startActivity，不受 package visibility 限制。即使以后漏声明某个钱包，唤起照样能成。

### 2. OKX 的 scheme 是错的

代码里写 `okx://main/wc?uri=`。查 Reown 官方钱包注册表（用本租户 projectId 实时查的，钱包厂商自己提交的数据）：

| 钱包 | scheme | Android package |
| --- | --- | --- |
| MetaMask | `metamask://` | `io.metamask` |
| Trust | `trust://` | `com.wallet.crypto.trustapp` |
| OKX（交易所主 App） | `okex://main` | `com.okinc.okex.gp` |
| OKX（独立钱包 App） | `okxwallet://main` | `com.okx.wallet` |

`okx://` 根本不存在，而且 OKX 有两个 App。深链表收进 `wallet-deep-links.ts` 作为唯一真相源，每个钱包是候选列表，按顺序试。

### 3. `metadata` 没有 `redirect`，`url` 是占位符

`url` 填的是 `https://walletconnect.com`，且没有 `redirect`。SDK 支持 `redirect: {native, universal}`，App 自己注册了 `anyfun://`。缺了它，用户在钱包里点完批准会停在钱包里，回到 App 才看到结果。现在 `url` 用租户 API 域名，`redirect.native` 用租户 scheme。

### 4. `restore()` 把钱包身份写死成 `walletconnect`

冷启动恢复会话后用 MetaMask 签名，`openWallet("walletconnect")` 查不到深链，什么都不做。现在从会话对端的自述名字认回真实钱包。

### 附带

- **`installed` 在撒谎**：它其实是"租户配了 projectId 没有"，UI 却显示「已安装」并据此置灰。拆成 `configured`（决定是否可点）和 `installed`（只决定文案）。没装钱包的行**保持可点**——点了走扫码，置灰才是真的"点了没反应"。
- **连接过程无超时无取消**：`approval()` 加了 120 秒超时；关掉二维码会真的取消这次连接（含"二维码刚弹出就被关掉"的竞态）。
- **connect 失败静默**：以前失败只是把 sheet 退回钱包列表，什么都不说。现在按超时/取消/失败分类提示。

### 设备实测

模拟器上装新包后：三个钱包行都正确显示「Not installed · tap to scan instead」（旧包在没装 MetaMask 的机器上显示「Installed」），点 MetaMask 立刻出现「Opening MetaMask…」，唤起失败后二维码明确写出「MetaMask was not found on this device. You can scan with another wallet.」。`<queries>` 声明也用 aapt2 在成品 APK 里确认了。

**没有验证的**：真机装了 MetaMask 时能否唤起并签名。模拟器上没有真钱包，构造一个注册了 `metamask://` 的假 App 只能测探测、测不了配对。不过唤起路径已经不依赖探测，这一步的风险主要在 scheme 拼写，而 scheme 取自官方注册表。

## 第二批：强制升级

App 端的强更 UI 本来就是对的（forced 时不渲染「稍后再说」、遮罩点不掉、返回键顶住、每次启动必弹）。缺的是**管理端发版时选不了**：运营得先在发布管理上线新包，再跑到应用配置手改全局 `minSupportedVersion` 字符串，两处互不感知。

- `app_releases` 加**一个** `mandatory` 列。原本设计了第二列存"为什么强制"，核实后发现多余：为什么强制走既有的审计 reason（每次发布动作都要填），给用户看的说明是 `release_notes`，两者都已经有地方存了。
- active 发布声明 mandatory 时，等效于把最低支持版本提到它自己那一版。仍然走 semver 比较而不是让布尔位直接决定结果（`docs/RELIABILITY_AND_RELEASE.md` 的既有约束），而且**只升不降**——把老版本标成强制再激活，不该让所有人被要求"升级"到更老的包。因为读的是 `status='active'` 的记录，"包已经能装"天然成立，比任何前置校验都可靠（原方案里写的"发布时拦一次"因此没有必要）。
- **去掉 required 的静默降级**：以前只要渠道解析不出 actionURL 就降成 recommended，于是运营以为强更生效了、正式包用户看到的却是带「稍后再说」的软更。现在只有 development 这种本来就没有安装入口的渠道才降级。
- 决策逻辑从 bootstrap handler 里提成 `resolveUpdateDecision`（controller 不该装业务规则），7 个用例覆盖。
- 管理端发布表单加开关，勾上时展开警示（后果 + 只用于安全漏洞/协议不兼容/法律合规），列表标出哪些版本是强制的。
- **补上返回键的真接线**：`resolveSystemBack` 的 `updateLocked` 分支在调用处被硬编码成 `false`，是死代码；强更顶住返回键全靠原生 Modal 的空 `onRequestClose`，换个实现就会被无声绕过。handler 提成 `useSystemBackHandler` 以便测接线本身。

### 验证

`resolveUpdateDecision` 7 例（含 mandatory 提升、只升不降、正式渠道保持 required、development 降级）；管理端 1 例断言默认不强制 + 1 例断言勾选后出现警示；返回键 3 例（强更时吞掉、非强更时放行、强更时内层页面仍可返回）。

线上：迁移 27 已生效（`listReleases` 的 SELECT 带了 `mandatory` 列，列不存在会 500，而它正常返回），管理端能读到 `mandatory=false`，1.2.4 客户端在 1.2.5 非强制时拿到 `recommended`。

**没有验证的**：完整的"勾选强制 → 发布上线 → 设备看到不可跳过的弹窗"。那需要真的发一个强制版本，会立刻对所有低版本设备生效，属于运营动作，不该由我代做。

## 第三批：让反馈成为默认行为

盘点发现"点了没反馈"是系统性的，不是个别疏漏：Tamagui 的 `Button` 没有 `loading` prop，所以每个异步按钮都在手写 `disabled={pending}` 加文案切换；`Spinner` 没从 design-system 导出，于是没人加转圈。钱包管理里一次就漏了五处，全是**完全静默失败**（`void promise` 把异常丢掉，或 mutation 只写了 `onSuccess`）：重命名、断开连接、备份验证确认、切换账户、一键撤销全部授权。

- `ActionButton`：`loading` 时自动禁用、显示 Spinner、可换文案。
- `useAsyncAction`：包住异步 handler，提供 pending 状态、**必填的**失败提示、可选的成功提示，并用 ref 挡住第一次还没结束时的第二次点击（`setState` 是异步的，光靠 pending 挡不住连点）。
- 三处退出登录补 `onError`（原来失败只是按钮变回可点）。
- 五处剪贴板复制原来一个 `.catch` 都没有，收进 `copyToClipboard` 助手，成功失败都说话。

## 交付

- RN-App `pnpm check`：55 suites / 280 tests
- RN-Admin `pnpm check`：8 files / 45 tests + build
- RN-Server `go vet` + `go test ./...` 全绿
- 三个仓库的 GitHub Actions 均 success，web4 已部署

**注意 `<queries>` 改的是原生 manifest，必须重新打包，OTA 覆盖不了。** 其余 JS 改动可以走 OTA。

## Review 与死代码清理（同日）

通读三批改动 + 全量未引用导出扫描。查出**三个真缺陷**，其中一个是我自己在第三批引入的。

### 1. 假成功提示（第三批引入）

`useAsyncAction` 在 action resolve 后无条件弹成功提示，而 `saveLabel` 里有守卫
`if (!address || !label.trim()) return;`——名字为空时点保存，什么都没改却提示"已更新显示名"。
第一批手写的版本反而没这个问题（先 return 再 toast）。

改法两层：hook 支持 action 返回 `false` 表示"守卫拦下了，别报成功"，同时把空名字的保存
按钮置灰（本来就该有——点了什么都不发生也是一种"点了没反应"）。

### 2. 只装了 OKX 独立钱包 App 的用户被误标"未安装"

`probeLink` 只探测第一个候选 scheme，而 OKX 有两个 App（`okex://main` 交易所主 App、
`okxwallet://main` 独立钱包）。改成探测所有候选，任一命中即视为已安装。

### 3. 勾过的强制升级开关会残留到下一次发布

管理端打开「上传 APK」表单时只重置了成功态，`mandatory` 保留上次的值。勾了强制但没发成功、
关掉表单再打开，开关还是勾着——版本号残留在输入框里是看得见的，checkbox 不是，而后果是所有
低版本用户被锁。现在每次打开表单都从关闭开始。撤销修复后回归测试确实会失败（验过判别力）。

### 死代码

- 删 `resetWalletConnectClient`（我加的测试后门，没有任何测试用它）
- 收回 `WalletConnectTimeoutError`、`connectorOf` 的导出（只在模块内使用；上层是按 message
  匹配 `/timeout/i` 分类的，没人 import 这个类）
- 删 RN-Admin 的 `WalletNetworkSection` 类型（无人引用）

扫描报告的其余未引用导出都是既有代码（`update-service` 的类型、`test/mocks/reanimated` 的
jest mock 等），不在本次范围。

### 顺带

- backup 备份验证也统一到 `useAsyncAction` / `ActionButton`，不再手写 pending 状态——新基础
  设施要真的成为默认写法，而不是只用在改过的那两处。
- `onPairingDismissed` 注册的监听器不取消订阅：`createGateways` 由 `useMemo` 在整个 App
  生命周期只跑一次，且 `cancelConnect` 幂等。加了注释说明这个约束，免得以后有人把
  `createGateways` 挪进每次渲染的路径。

验证：RN-App 55 suites / 282 tests，RN-Admin 8 files / 46 tests + build，RN-Server 全绿。
