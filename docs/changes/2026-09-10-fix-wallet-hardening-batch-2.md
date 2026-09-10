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

- Given 有人改了金库条目的 `kind` 或 `path`，When 解密，Then 直接失败，不再只靠地址重算兜底。
- Given 升级前写下的老条目，When 第一次成功解开，Then 就地重新加密成带 AAD 的形式；升级失败不影响本次操作。
- Given 用户切走 App，When 进后台，Then 立即清掉内存里的密钥；界面是否上锁仍按自动锁定时长。
- Given 用户复制助记词后又复制了别的内容，When 60 秒到点，Then 不清剪贴板；页面卸载则取消定时器。
- Given 设备不支持防截屏，When 展示助记词，Then 页面上如实提示，而不是让用户以为安全。
- Given 进入备份校验，When 出题，Then 位置与干扰词每次随机；连续错 3 次退回抄写页。
- Given 新建钱包，When 跳转备份页，Then 助记词经模块级一次性通道交接，取走即清，不进导航参数。
- Given 装了 MetaMask / Trust，When 配对，Then 先用各自域名的通用链接，自定义 scheme 兜底。
- Given WalletConnect 已连接，When 查看 AsyncStorage，Then 只有密文；升级时删掉 SDK 早先写下的明文条目。
- Given 服务端下发的登录消息域名 / 账户 / nonce 与预期不符，When 点签名，Then 拒绝，不把签名交出去。
- Given 语言包的 `tenantId` 与本机首次认定的不一致，When 应用，Then 拒绝并保留内置文案。
- Given 代码里把 `mnemonic` 打进 `console.log`，When 跑 lint，Then 报错。

## UI 与交互状态

备份页在防截屏不可用时多一条橙色提示（`backup.screenProtectUnavailable`）；连续答错三次多一条提示（`backup.rereadAfterMisses`）并退回第一步。防截屏新增覆盖 WalletConnect 二维码与登录签名确认两屏。其余为不可见的加固。

## 技术影响

- 新增 `features/wallet/model/backup-quiz.ts`（CSPRNG 出题，拒绝采样避免模偏差）、`features/wallet/model/pending-reveal.ts`（一次性交接）、`features/session/model/siwe.ts`（EIP-4361 解析与断言）、`features/wallet/api/encrypted-wc-storage.ts`（AES-GCM 包裹 SDK 存储，密钥在钥匙串）。
- `core/security/screen-protect.ts` 改为返回状态并支持 `active` 开关（常驻挂载的 sheet 按需开关）。
- `core/wallet/vault/expo-ports.ts` 新增 `expoSecureStoreIn(keychainService)`；预测凭证走 `foundation.predict.credentials`，WalletConnect 存储密钥走 `foundation.walletconnect`，钱包金库保留默认空间以免读不到既有条目。
- `navigation/types.ts` 的 `WalletBackup` 参数改为 `undefined`。
- 金库条目新增 `aad?: 1` 标记；无标记的老条目按原样解密并在 `revealMnemonic` / `withPrivateKey` 成功后就地升级。
- ESLint 新增两条 `no-restricted-syntax`：`console.*` 的参数里出现 `phrase` / `mnemonic` / `privateKey` / `secret` / `wrapKey` 等标识符，或 `.params` / `.phrase` 之类成员访问，一律报错。
- 内置文案 +2 键（种子 1122 → 1124）。

## 验证与发布

- `pnpm check` 全绿：127 套 / 904 用例，format / lint / typecheck / api / config / i18n 均通过。
- 新增测试：`backup-quiz.spec.ts`（10）、`pending-reveal.spec.ts`（4）、`siwe.spec.ts`（10）、`encrypted-wc-storage.spec.ts`（10）、`expo-ports.spec.ts`（3）、`wallet-deep-links.spec.ts`（5）；金库 spec 增 3 例（AAD 拒改元数据、老条目就地升级）；`bootstrap-repository.spec.ts` 增 2 例（跨租户语言包拒收、首次钉住）；`app-lock-gate.spec.tsx` 增 1 例（进后台即锁）。
- **一次性影响**：换用加密存储后，升级前建立的 WalletConnect 会话读不到，用户需要重新连接一次外部钱包；同时删除 SDK 早先写下的明文条目。内置钱包不受影响。
- `app-lock-gate.spec.tsx` 的新用例放在文件末尾：它把 `AppState.addEventListener` 换成替身，替身在位期间挂载的组件不会真正注册监听器，排在它后面的用例会读到残留状态。
- 本轮**未做**：`A3-5` 服务端 `/.well-known/assetlinks.json` 与 AASA（N13 的服务端一半），通用链接在钱包厂商域名上生效不依赖它，但本 App 自己的深链要防抢注仍需它。
- 无原生变更，可随 OTA 发布。
