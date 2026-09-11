# Bugfix: 钱包安全无争议项第二批（N9 AAD / N13 / N14 / N15 / N21 / N23 / N24 / N25 / N26 SIWE / N27 / N36 / 0c-2 / 12.2）

状态：Done

## 用户场景与现状证据

阶段 0 范围 A 里 13 项一直没落地（见 `docs/design/wallet-security-phase0-scope-2026-09-10.md` §6 修正后的未做清单）。逐条现状：

- **A1-7（N9）** 金库密文只认证密文本身，`address` / `kind` / `path` 都在普通存储里，改了照样解得开。
- **A1-8（0c-2）** 进后台只记时间戳，密钥留在内存里，直到用户回前台才按自动锁定时长判定。
- **A1-11（N15）** 助记词输入框没关自动填充、拼写词典和键盘学习。
- **A1-12（N23）** 复制助记词后 60 秒裸 `setTimeout` 清剪贴板：不取消、不比对，用户这一分钟里复制的别的东西会被清掉。
- **A1-13（N24）** 防截屏只覆盖备份页与导入页；失败被 `.catch(() => {})` 吞掉，用户以为截不了图。
- **A1-14（N25）** 备份校验用固定 seed，考的位置和干扰词恒定；答错无上限。
- **A1-15（N36）** 助记词作为导航参数传递，会进导航状态、持久化和崩溃上报。
- **A1-17（N13）** 外部钱包只用自定义 scheme，装了恶意应用的机器上配对 URI 可能被接走。
- **A1-18（N14）** WalletConnect SDK 把会话（含 `symKey`）明文写 AsyncStorage。
- **A1-19（N26）** 客户端不解析服务端下发的 EIP-4361 消息，域名 / 账户 / nonce 全凭服务端。
- **A1-22（N21）** 预测平台凭证与钱包私钥共用同一个钥匙串命名空间。
- **N27** 语言包只比 `languageCode` / `version`，`tenantId` 从不比对。
- **A2-7（12.2）** 没有规则阻止把助记词、私钥、路由参数打进 `console`。

## Given / When / Then

- Given 有人改了金库条目的 `kind` 或 `path`，When 解密**带 `aad:1` 标记的条目**，Then 直接失败；升级前写下的老条目仍按原样解密，靠地址重算兜底，读过一次后自动升级。
- Given 升级前写下的老条目，When 第一次成功解开，Then 就地重新加密成带 AAD 的形式；升级失败不影响本次操作。
- Given 用户切走 App，When 进后台，Then 立即清掉内存里的密钥；界面是否上锁仍按自动锁定时长。
- Given 用户复制助记词后又复制了别的内容，When 60 秒到点，Then 不清剪贴板；Given 用户在 60 秒内离开页面，When 卸载，Then 立刻抹掉（仍先比对内容）。
- Given 设备不支持防截屏，When 展示助记词，Then 页面上如实提示，而不是让用户以为安全。
- Given 进入备份校验，When 出题，Then 位置与干扰词每次随机；连续错 3 次退回抄写页**并换一套题**，不能靠反复进出穷举。
- Given 新建钱包，When 跳转备份页，Then 助记词经模块级一次性通道交接，取走即清，不进导航参数。
- Given 装了 MetaMask / Trust，When 配对，Then 先用各自域名的通用链接，自定义 scheme 兜底。
- Given WalletConnect 已连接，When 查看 AsyncStorage，Then 只有密文；Given 升级前留下的明文条目，When App 启动，Then 立即删除，不等到下次建立 WC 客户端。
- Given 服务端下发的登录消息域名 / 账户 / nonce / 链与预期不符，When 点签名，Then 拒绝，不把签名交出去；域名比较去掉端口，与服务端的 Host 归一化对齐。
- Given 语言包的 `tenantId` 与本机首次认定的不一致，When 应用，Then 拒绝并保留内置文案。
- Given 代码里把 `mnemonic` 打进 `console.log`，When 跑 lint，Then 报错。

## UI 与交互状态

备份页与导入页在防截屏不可用时多一条橙色提示（`backup.screenProtectUnavailable`）；备份页在保护落地前不渲染单词。连续答错三次多一条提示（`backup.rereadAfterMisses`）并退回第一步、换一套题。防截屏新增覆盖 WalletConnect 二维码、登录签名确认、转出确认三屏，并在启动时开启应用切换器隐私遮罩。其余为不可见的加固。

## 技术影响

- 新增 `features/wallet/model/backup-quiz.ts`（CSPRNG 出题，拒绝采样避免模偏差）、`features/wallet/model/pending-reveal.ts`（一次性交接）、`features/session/model/siwe.ts`（EIP-4361 解析与断言）、`features/wallet/api/encrypted-wc-storage.ts`（AES-GCM 包裹 SDK 存储，密钥在钥匙串）。
- `core/security/screen-protect.ts` 改为返回状态并支持 `active` 开关（常驻挂载的 sheet 按需开关）。
- `core/wallet/vault/expo-ports.ts` 新增 `expoSecureStoreIn(keychainService)`；预测凭证走 `foundation.predict.credentials`，WalletConnect 存储密钥走 `foundation.walletconnect`，钱包金库保留默认空间以免读不到既有条目。
- `navigation/types.ts` 的 `WalletBackup` 参数改为 `undefined`。
- 金库条目新增 `aad?: 1` 标记；无标记的老条目按原样解密并在 `revealMnemonic` / `withPrivateKey` 成功后就地升级。
- ESLint 新增两条 `no-restricted-syntax`：`console.*` 的参数里出现 `phrase` / `mnemonic` / `privateKey` / `secret` / `wrapKey` 等标识符，或 `.params` / `.phrase` 之类成员访问，一律报错。
- 内置文案 +2 键（种子 1122 → 1124）。

## 验证与发布

- `pnpm check` 全绿：128 套 / 923 用例，format / lint / typecheck / api / config / i18n 均通过。
- 新增测试：`backup-quiz.spec.ts`（10）、`pending-reveal.spec.ts`（4）、`siwe.spec.ts`（10）、`encrypted-wc-storage.spec.ts`（10）、`expo-ports.spec.ts`（3）、`wallet-deep-links.spec.ts`（5）；金库 spec 增 3 例（AAD 拒改元数据、老条目就地升级）；`bootstrap-repository.spec.ts` 增 2 例（跨租户语言包拒收、首次钉住）；`app-lock-gate.spec.tsx` 增 1 例（进后台即锁）。
- **一次性影响**：换用加密存储后，升级前建立的 WalletConnect 会话读不到，用户需要重新连接一次外部钱包；同时删除 SDK 早先写下的明文条目。内置钱包不受影响。
- 本轮**未做**：`A3-5` 服务端 `/.well-known/assetlinks.json` 与 AASA（N13 的服务端一半），通用链接在钱包厂商域名上生效不依赖它，但本 App 自己的深链要防抢注仍需它。
- 无原生变更，可随 OTA 发布。

## 追加（2026-09-11）：对抗复核后的补齐与更正

独立复核逐条核对了"计划说什么"与"代码做了什么"，发现 6 处只做一半、2 处引入回归、4 条变更记录里的描述不成立。全部已修：

**真实缺陷**

- **备份校验的三次上限形同虚设**：连续答错三次后只把计数归零，`useMemo` 依赖里没有"重新出题"的信号，退回抄写页再进来还是同一套题，四选一三题一轮可以无限穷举（64 种组合）。改为答错满次数时递增 `quizRound` 并重新出题。
- **剪贴板回归（本轮自己引入）**：卸载时只 `clearTimeout` 不清内容，用户在 60 秒内离开备份页，助记词就无限期留在剪贴板里，比改之前的裸 `setTimeout` 更糟。抽出 `core/ui/use-scrubbed-clipboard.ts`：到点抹、卸载立刻抹、抹前比对内容仍是它。
- **语言包租户校验只挡住了下载路径**：下载分支抛错后落到 `catch`，缓存回退只比 `languageCode`，别家租户的缓存包照样铺上去。回退路径补上同一道租户校验，"拒绝并保留内置文案"这句才成立。
- **加密存储的索引并发覆盖**：SDK 建会话时并发写多个键，各自读到同一份旧索引再写回，后写的把先写的键挤掉——条目还在但 `getKeys` 看不到，表现为会话丢失。索引的读-改-写改为串行队列。
- **AAD 用分隔符拼接**：解密时元数据取自普通存储（攻击者可写），拼接编码不是单射的，字段里塞分隔符有机会凑出同一个认证串。改为 `JSON.stringify` 数组编码。`createdAt` / `backedUpAt` 仍不纳入——`markBackedUp` 会改它们且不重新加密。

**计划里漏掉的子句**

- A1-12：计划点名的 `walletconnect-sheet` 复制配对 URI（内含会话对称密钥）此前完全没处理，现与助记词同一套。
- A1-13：补上转出确认页（`wallet-send-confirm`，按确认层展示状态开关）、启动时 `enableAppSwitcherProtectionAsync`（最近任务列表缩略图）、保护未落地前不渲染助记词、导入页同样显示"保护不可用"提示。
- A1-17：补上 Android 显式包名 intent（`expo-intent-launcher`，包名与 `plugins/with-wallet-deep-links.js` 的 `<queries>` 一致），隐式 `ACTION_VIEW` 只作兜底。抢注路径至此闭合。
- A1-19：补上 `chainId ∈ 会话链` 断言（登录消息把凭证绑在某条链上，服务端给一条本次会话没批准的链时不能替它签）。
- A1-20：补上 `parseAccounts` 多地址会话拒收（取首地址再并全部链，等于声称它在没批准的链上也能签）与签名器的 `chainId ∈ connection.chains` 断言。
- A2-7 / N11 扫描：静态扫描改为匹配文件内全部绑定，并把 `usdValue: undefined` 也判为漏传。
- A3-6：ADR-0002 措辞改为"与 bootstrap 指针一致的完整性，不是真实性"，并写明租户钉住是签名到位前的替代约束。

**登录消息的生产阻断（自查发现）**：服务端渲染 SIWE 消息用的是去掉端口的 Host（`normalizeHost` 走 `net.SplitHostPort`），客户端的 `domain` 来自 `new URL(apiBaseUrl).host` 带端口。生产域名没端口所以碰巧相等，开发 / 预发（`http://10.0.2.2:3100`）一比就不等，新加的断言会把登录整个挡死。比较前统一去端口，IPv6 字面量去方括号与 Go 侧对齐。

**记录更正**：原文"改了 kind 或 path 解密直接失败"只对带 `aad:1` 的条目成立，老条目仍靠地址重算兜底，已在正文说明；"升级时删掉明文条目"改为启动即清（`purgeLegacyWalletConnectStorage` 在网关构建时触发），不再等到下次建立 WC 客户端。

**测试**：新增 `core/ui/use-scrubbed-clipboard.spec.ts`（6）；金库增分隔符注入用例；连接器增跨链拒签、多地址会话拒收；客户端增 Android 显式 intent 与兜底；语言包增"缓存回退同样拒收别家租户"；加密存储增两条并发用例。`pnpm check` 全绿：128 套 / 923 用例。

**清理**：复核子代理在被限额中断前遗留了 `src/features/security/app-lock-gate.order-probe.spec.tsx`，已删除。`app-lock-gate.spec.tsx` 里替换 `AppState.addEventListener` 的用例仍需排在文件末尾：替身在位期间挂载的组件不注册真实监听器，它触发的 zustand 更新会让 React 19 把未 flush 完的 act 工作以 `AggregateError` 抛进后面的用例，原因已写在用例上方。
