# 登录 sheet（L 组）与设计系统控件

- 状态：In Progress
- 日期：2026-08-30
- 设计稿：`UI/src/70-login.html` L-01 ~ L-03（L-04 备份助记词待内置钱包流程一起做）
- 决策：ADR 0007、ADR 0008

## 用户场景与现状证据

游客可浏览行情与市场；任何写操作拉起登录 sheet，登录后回到原操作。此前 RN-App 首页登录只是一个按钮直连 mock，无 sheet、无签名确认层、无账户切换。

## Given / When / Then

- Given 未登录 When 打开首页 Then 资产卡替换为欢迎卡（连接钱包 / 创建新钱包），铃铛隐藏。
- Given 未登录 When 点"连接钱包" Then 弹出半屏 sheet（可下拉 / 点遮罩 / × 关闭），列出内置钱包（创建 / 导入）与外部钱包（已安装排前）+ 其他钱包（WalletConnect）。
- Given 选择 MetaMask When 连接成功 Then 进入确认层：地址、链、余额，四行人话（登录到 / 用途 / 有效期 / 费用），"签名并登录" + "换一个钱包"。
- Given 确认层 When 点签名 Then 按钮变"等待钱包签名…"，sheet 锁定不可关闭；成功 → toast「登录成功」，sheet 关闭，意图交回原页面；拒签 → toast「已取消登录」，sheet 保留可重试；超时 → 「换一个钱包」高亮。
- Given 已登录 When 点资产卡右上地址 chip Then 弹出账户 sheet：账户列表（当前高亮、未备份标签）、复制地址（toast）、添加钱包（回到登录 sheet）、断开连接（清会话与账户缓存，保留偏好）。
- Given 已登录 When 切换到另一账户 Then 登出并要求重新签名（地址变化 = 身份变化）。

## UI 与交互状态

- `Sheet`：动态高度、键盘 interactive、`locked` 禁用三种关闭方式。
- 新控件：`Switch`（150ms）、`RadioRow`、`Tabs`（下划线）、`TextField`、`AmountInput`（数字清洗 + 快捷比例 + 最大）、`DetailRow`、`Toast`、`Sparkline` / `AreaChart` / `CandleChart`。
- 首页 DEX 行加入迷你走势。

## 技术影响

- 新依赖：`@gorhom/bottom-sheet`、`react-native-svg`、`expo-haptics`、`expo-clipboard`（后三者原生，需重建 dev client）。
- `useWalletLogin(domain)` 分步状态机：pick → connecting → confirm → signing → (error: rejected / timeout / failed)。
- `useAuthSheet` 全局 store：`requestAuth(intent)` / `fulfill()` / `consumeIntent()`；`AuthIntent` 复用 session model。
- i18n 新键：`login.*`、`account.*`、`common.*` 已加入 `fallback-config.ts` 双语表。

## 验证与发布

- 单测：新增 `auth-sheet-store.spec`（2 例）；`pnpm check` 全绿（format / lint 0 警告 / typecheck / jest 21 套件 87 例 / api:check / config:check）。
- Android Development Build（AVD `rn_smoke`，重建含 svg / haptics / clipboard 的 dev client，Metro :8091，2026-08-30 14:50–15:00）：
  - 游客首页：欢迎卡（连接钱包 / 创建新钱包），铃铛隐藏；DEX 行出现迷你走势（react-native-svg）。✅
  - 点"连接钱包" → 半屏 sheet 弹出，遮罩变暗，列出内置钱包（创建 / 导入）与外部钱包（MetaMask 已安装排前、OKX、Trust、其他钱包），底部协议说明。✅（截图 `login-sheet.png`）
  - 点 MetaMask → 确认层：`3F` 头像、"MetaMask 已连接"、地址缩写、BSC · 余额 0.842 BNB、四行人话（登录到 api.anyfun.win / 用途 / 有效期 7 天 / 费用 免费）、风险提示、"签名并登录" + "换一个钱包"。✅（`login-confirm.png`）
  - 点签名 → 按钮变"等待钱包签名…"并禁用（sheet 锁定），约 1s 后 sheet 关闭，首页切换为 kenneth.eth / 总资产。✅（`login-signing.png`）
  - 已登录点地址 chip → 账户 sheet：当前账户高亮 + "当前"徽标、复制地址 → toast「地址已复制」、断开连接 → toast「已断开连接」并回到游客态。✅（`account-sheet.png`）
  - 修复过程中发现并解决：(1) gorhom `BottomSheetModal` 在挂载时调用 `dismiss()` 会把延迟的 `onDismiss` 打到随后的 `present()` 上，导致 sheet 弹出即关闭——改为只在 `open` 真正翻转时调用；(2) 断开连接后账户 sheet 未自动关闭——成功回调里 dismiss；(3) 外部钱包列表误含原始 `walletconnect` 连接器——由"其他钱包"承载。
  - 未验证：拒签 / 超时错误态在真机 UI 的呈现（`nextSignatureOutcome` 仅单测覆盖）；iOS；键盘避让（本轮无输入框）。
- 回滚：回退本分支提交；无数据迁移。
