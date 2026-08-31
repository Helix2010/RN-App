# 个人中心与设置页面组（S-01 ~ S-09，钱包身份）

- 状态：In Progress
- 日期：2026-08-30
- 设计稿：`UI/src/60-settings.html`；规格 `UI/docs/settings-spec.md`（v2 钱包身份）
- 决策：ADR 0007、ADR 0008

## 用户场景与现状证据

用户主体是钱包地址。个人中心放"钱包是谁、有什么"，设置放"App 怎么表现"。语言 / 主题 / 涨跌色 / 应用锁是设备级偏好；通知与交易偏好一期落本地并按地址隔离（决策 D5），后续由 RN-Server 同步。旧的 profile / settings / appearance 依赖 `demo-data`（交易所账户语义：KYC、邮箱、谷歌验证器、资金账户），`mock-detail-screens.tsx` 已整体删除。

## Given / When / Then

- S-01 Given 已登录 When 进入个人中心 Then 头部 ENS + 钱包来源 pill + 地址（点击复制）+ 链数（整块进钱包管理）；快捷格 收款码 / 安全中心 / 邀请返佣 / 帮助客服；"钱包"组（钱包管理 = 钱包数 / 安全中心 = 应用锁状态 / 转账地址簿）；"我的"组随模块（预测持仓 + 可领取 pill / 自选代币 / 交易记录）；"更多"组（邀请返佣 / 帮助与客服 / 关于 = 版本号，有更新时红点）；ghost 按钮"断开连接并退出" → 二次确认 sheet → 清会话与账户缓存，保留设备偏好。游客进入 → 直接拉起登录 sheet。
- S-02 Given 打开设置 Then 五组：通用（语言 = 本地语言名 / 主题 / 涨跌颜色 = 着色的"涨 跌" / 计价货币）、通知（= 已开启 n 项）、交易偏好（随模块：预测下单前确认 Switch、默认订单类型、兑换默认滑点、高风险代币提醒 Switch；两模块都无则整组隐藏）、安全（应用锁 Switch、交易前验证 Switch、安全中心）、关于（检查更新 = 红点 + 发现新版本 x / 已是最新、用户协议、隐私政策、清除缓存 → 确认 → toast）；页脚 版本 (build) · 设备 ID（长按复制）。
- S-03 语言：每行 本地语言名（主）+ 当前界面语言译名（副），单选即生效。
- S-04 外观：主题三选一迷你屏幕预览（跟随系统左右对半），涨跌颜色单选带 ▲▼ 预览；切换只交换 `pricePositive / priceNegative` 两个 token（`FoundationThemeProvider`），Yes / No 语义色不跟随。
- S-05 推送通知：系统权限关闭时顶部 warn 横条 + 去开启；交易 / 预测（随模块）/ 兑换与行情（随模块）/ 其他 四组；安全提醒半透明不可关闭（点击 toast）；免打扰时段。
- S-08 安全中心：安全等级由 应用锁 / 交易前验证 / 内置钱包已备份 三项计算（高 / 中 / 低 + 三段条 + 建议文案）；应用保护（应用锁 / 自动锁定 立即·1·5·15 分钟 / 交易前验证 / 大额转出阈值）；钱包与会话（已连接钱包 → S-09 / 备份助记词（仅有内置钱包时）/ 登录会话 = 本机 · 有效至 / 登录记录）；资金安全（转出仅限地址簿 Switch / 地址簿 / 代币授权管理（DEX 开启时，值 = 数量 → D-06））；唯一危险色描边按钮"断开所有会话" → 二次确认。
- S-09 钱包管理：当前使用（单选高亮）/ 其他钱包（内置未备份 warn pill；点击切换 → 登出并要求重新签名，toast）；当前钱包操作组（复制地址 / 修改显示名 sheet / 区块浏览器（不跳外部 H5，复制链接）/ 断开此钱包 红字二次确认，断开后自动切到下一个或回游客态）；底部"添加钱包"复用 L-02。

## 技术影响

- `preferences-store`（`foundation.preferences.v1`）新增 colorScheme / appLockEnabled / appLockMethod / autoLockMinutes / txConfirm / largeAmountThresholdUsd / sendWhitelistOnly（有默认值，旧数据可直接升级）。
- 新增 `account-preferences-store`（`foundation.account-preferences.v1`，按地址隔离）：quoteCurrency / predict / dex / notifications / dnd；`useAccountPrefs(address)`。
- `WalletGateway.rename`；`IconButton` 支持 `testID`；`ProfileScreen` 导出 `Group` / `SRow` 设置行原语供 S 组复用。
- 路由新增 `Wallets`；`Profile` 直接以 `NativeStackScreenProps` 接线；About 简化为 S-06（品牌 + 版本 + 更新卡 → 升级中心 + 链接 + 页脚），升级中心（OTA / 全量 / 强更弹窗）沿用既有实现。
- i18n 新键 `profile.*`、`settings.*`、`appearance.*`、`notif.*`、`security.*`、`wallets.*`。

## 验证与发布

- `pnpm check` 全绿（jest 87 例）。
- Android Development Build（`rn_smoke`，2026-08-30 16:35–16:45）：
  - S-01：3F 头像、kenneth.eth + MetaMask pill、地址 · 3 条链 + 复制、四格快捷、钱包 / 我的（预测持仓 $1,184.21 / 自选代币 / 交易记录）/ 更多（关于 1.1.9）三组。✅ `profile.png`
  - S-02：通用（简体中文 / 深色 / 涨跌 着色 / USDT）、通知 已开启 7 项、交易偏好 4 行（Switch 可切）、安全、关于。✅ `settings.png`
  - S-04：三个主题预览（深色选中），涨跌颜色切到"红涨绿跌"后设置页"涨 跌"着色即时对调。✅ `appearance.png` / `appearance-red-up.png`
  - S-05：四组开关（预测 / 兑换与行情 随模块出现）、免打扰 23:00 – 08:00。✅ `notifications.png`
  - S-08：安全等级 高 · 已开启 3 项保护（三段绿条）、应用保护 / 钱包与会话 / 资金安全 三组、代币授权管理 1 项。✅ `security-center.png`
  - S-09：当前使用 kenneth.eth（单选高亮）、操作组四行、提示文案、底部添加钱包。✅ `wallets.png`
  - 修复：设置页曾用 `<Stack>{locale}</Stack>` 触发 "Text strings must be rendered within a <Text>" 报错，已移除。
  - 未在设备验证：语言切换后英文界面全量走查、系统通知权限关闭态横条（模拟器已授权）、断开连接 / 断开所有会话 / 切换钱包的回游客态流程（Mock 只有一个钱包）、清除缓存实际清理（仅 toast）、iOS。
- 回滚：回退本分支提交；本地存储键 `foundation.account-preferences.v1` 可清理。
