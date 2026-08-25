# DEX / Web3 UI 规范补充

## 1. 组件体系

Tamagui 只作为底层主题与原子组件。feature 只能从 `src/design-system` 使用公共组件，避免供应商 API 扩散。领域组件分三层：

- 基础：AmountText、AddressText、PriceChange、Badge、Button、PageState；
- Web3 pattern：TokenAvatar、NetworkBadge、AmountInput、WalletIdentity、RiskNotice；
- 交易 pattern：QuoteSummary、PriceImpact、ApprovalStep、TransactionTimeline、SignatureReview。

只有两个真实 feature 复用后，pattern 才进入公共层。

## 2. 金额与行情

- 链上原始数量使用 bigint/string + decimals，展示层才格式化；禁止以 JS number 计算可签名金额。
- 金额使用 tabular numerals，对齐小数点；不因刷新导致布局跳动。
- 显示精度与计算精度分离，截断/四舍五入策略必须可说明。
- 涨跌不能只靠红绿，必须同时有正负号、箭头或文字；颜色语义使用 `pricePositive/priceNegative`。
- fiat 估值标明币种，极小数值采用统一 `<0.000001` 规则，不显示误导性的零。

## 3. 地址、网络和 Token

- 地址至少展示首 6 后 4，并提供复制/完整查看；ENS/别名不能替代可核对地址。
- 网络必须有文字名称，颜色/logo 只能辅助；切链前后清理不兼容 quote 和 token selection。
- Token 同 symbol 冲突时展示 network 与短地址；未经验证 token 有风险标识。
- Token logo 加载失败提供确定性 fallback，不以 symbol 首字母冒充已验证资产。

## 4. Swap 与签名

- 输入区明确“支付/获得”，显示余额、最大值规则和手续费保留。
- quote 必须显示来源、过期倒计时、minimum received、price impact、fee、slippage 和 route 摘要。
- Approve 与 Swap 是两个状态明确的交易，不把授权伪装成一次操作。
- 钱包签名前显示 chain、spender/recipient、amount、gas、deadline；高风险 allowance 单独确认。
- 交易状态至少区分 preparing、awaiting-signature、submitted、confirming、confirmed、failed、replaced/cancelled。
- 提交 hash 不等于成功；UI 必须等待业务要求的确认数或索引状态。

## 5. 主题与无障碍

深色优先不等于只做深色。light/dark 都满足文字、焦点、风险和 disabled 对比度；远程主题只允许覆盖 schema 中的语义色。大字号下金额、Token selector 和主按钮不能相互遮挡。所有图标操作有 accessibilityLabel，地址和 hash 的读法提供可理解描述。
