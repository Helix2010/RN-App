# Bugfix: 大额验证规模、无限额授权确认、会话地址绑定与 EIP-712 载荷（N11 / N22 / N26 / N30 / N37）

状态：Done

## 用户场景与现状证据

- 用户/角色：使用本机钱包或外部钱包（WalletConnect）的持币用户。
- 当前行为或复现：
  - 划转、领取、下单、启用预测账户、兑换五处调用 `requireVerification()` 不带参数。`useRequireVerification` 把 `usdValue === undefined` 判成"非大额"，`smart` 策略下只要 5 分钟内验证过一次，之后多大金额都不再验证；`off` 策略下则完全不验证。大额门槛形同虚设。
  - 兑换页首次卖某个 ERC-20 时，主按钮直接发出**无限额** approve，用户没见过 spender 地址、没有确认层、也没有身份验证。
  - 登录 `verify()` 把服务端返回的 `address` 原样写进会话；`refresh()` 每次用服务端的 `address` 覆盖本地。服务端返回别的账户时，界面会把它当成用户自己的账户。
  - 外部钱包的结构化签名只发 `{domain, types, message}`，缺 `primaryType` 与 `EIP712Domain`，钱包只能自己猜主类型。
  - 全仓没有任何 `client.on(...)`：钱包侧断开或换账户后，App 仍把会话当有效，下一次签名要等到超时才失败。
  - `submitTransaction` 用 `transaction.from ?? connection.address` 静默兜底，上层传错地址不会被发现。
- 代码调用链：`use-require-verification.ts` → 五处调用方；`swap-screen.tsx` `onPrimary`；`http-session-gateway.ts` `verify`/`refresh`；`walletconnect-connector.ts` `signTypedData`/`submitTransaction`/`WalletConnectSigner.send`。
- 非目标：本轮不做 SIWE 载荷断言（A1-19）、WalletConnect 会话存储加密（A1-18）、Universal Link（A1-17）、GCM AAD（A1-7）。

## Given / When / Then

- Given `off` 策略且刚验证过，When 划转 5 万 USDC，Then 仍弹身份验证（金额即规模）。
- Given 下单预览还没返回，When 提交订单，Then 规模按未知处理，一律验证。
- Given 首次卖某个 ERC-20，When 点主按钮，Then 打开确认层展示 spender 完整地址与"无限额"提示，**不**发出授权；When 在确认层点授权，Then 先过身份验证再发。
- Given 服务端登录响应里的地址与刚签名的账户不同，When 登录，Then 抛错且不落任何会话。
- Given 令牌对应的账户与本地会话不同，When 刷新，Then 清空本地会话并通知登出，而不是改写本地地址。
- Given 钱包侧删除了会话，When 用已经拿到手的签名器签名，Then 立刻抛 `WalletConnectRejectedError`，不发请求、不等超时。
- Given 钱包只是改了启用的链，When 收到 `session_update`，Then 连接保留、默认链跟着变。
- Given 外部钱包签结构化数据，When 发出请求，Then 载荷含 `primaryType` 与 `EIP712Domain`。
- Given 调用方传了别的 `from`，When 发交易，Then 拒绝，而不是改成当前账户。

## UI 与交互状态

兑换确认层新增授权区：橙色无限额提示（含代币符号）、`swap.spender` 明细行展示被授权合约的完整地址、主按钮变为「授权 {symbol}」，授权进行中显示「授权中」。授权成功后报价失效重取，`needsApproval` 转 false，按钮回到「确认兑换」。新增内置文案键 `swap.approveUnlimited`、`swap.spender`、`swap.approve.verifyReason`（种子 1119 → 1122 键）。

## 技术影响

- `use-require-verification.spec.ts` 增静态扫描：凡是 `useRequireVerification()` 的调用点，第一个实参必须是含 `usdValue` 的对象字面量；规模未知要显式写 `null`。防止以后再漏。
- `SignClientLike` 增可选 `on`，连接器首次取客户端时订阅 `session_delete` / `session_update` / `session_event`。`Connection` 增 `revoked` 标记：光从连接表删不够，已发出的签名器仍握着对象引用。
- 会话地址比较统一用大小写无关的十六进制比对，服务端回 EIP-55 或全小写都能通过。
- `TypedDataEncoder.getPayload` 来自 ethers，与内置签名器同一套编码规则。

## 验证与发布

- 新增/修改测试：`use-require-verification.spec.ts`（静态扫描）、`http-session-gateway.spec.ts`（登录地址不符、大小写差异、刷新账户不符）、`walletconnect-connector.spec.ts`（完整 EIP-712 载荷、from 不符拒绝、`session_delete` 后拒签、换账户断开、仅换链保留）、`swap-screen.spec.tsx`（授权只在确认层发生且先验证）。
- `pnpm check`：格式、lint、typecheck、`api:check`、`config:check`、`i18n:check` 通过；测试 852 例中 851 通过，唯一失败的 `src/design-system/snap-carousel.spec.tsx` 属同一工作区里另一会话正在进行的 design-system 改动，与本次改动无关（本次未触碰 `src/design-system/`）。
- 无原生变更，可随 OTA 发布。
