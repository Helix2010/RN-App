# 预测市场：提出争议（对齐平台网页流程）

- 日期：2026-09-06
- 设计与决策：`docs/design/review-2026-09-05.md` §4.3（平台事实与 App 设计）、`docs/design/predict-platform-integration-2026-09-02.md` §2.9 更正
- 对照：pm-cup2026 user-dapp `ResolutionProgress.tsx` RaiseDisputeModal（只读）

## 现状与问题

1. App 之前把"争议提交"当成平台没有的能力（`PredictUnsupportedError`），结算页的争议面板只是一个单行输入框，点了就报错。
2. 平台实际有完整的用户争议流程：证据意向接口 + LightOracle `disputePrice`（从 EOA 扣 USDW 押金）。押金不在 gamma 接口里，必须读链。

## Given / When / Then

- Given 市场处于 `liveness_period` 且适配器不是 `crypto_periodic` 且还没人争议 When 打开结算页 Then 显示"提出争议"按钮；`crypto_periodic` 显示"此类市场没有争议环节"；已有争议显示"已提出争议 · 等待仲裁"。
- Given 打开争议面板 Then 读链显示押金（USDW）、本地址 USDW 余额、手续费余额与链上到期倒计时；到期后按钮禁用并提示"争议窗口已关闭"。
- Given 证据不足 150 字 / 超过 1000 字 / 链接不是 https:// 或超过 5 条 Then 提交按钮不放行并在字段下方给出原因；计数按码点。
- Given 本地址 USDW 少于押金 Then 显示"还差 N"，钱包 USDC 够时给"用钱包 USDC 兑换 N USDW"一键操作（approve + wrap 到本地址），不够时说明先转入。
- Given 点提交 Then 先过交易验证策略（smart / always，同下单），再依次：提交证据 → 核对押金 → 授权（额度不够时）→ 链上 disputePrice，每步显示进度；广播前再核一次到期。
- Given 平台返回 409 Then 提示"本轮已有争议"（不动链上）；400 提示"证据未通过平台校验：…"；404 提示"平台不认识这个市场"；链上回执失败提示"链上交易失败"。
- Given 争议交易上链 Then 结算页立即显示已争议（乐观态），直到平台 indexer 返回 challenger。

## 技术影响

- `core/predict-platform`：`gamma.ts` schema 字段与 `postDisputeEvidence`；`public-info.ts` 适配器合约（可选）与 `adapterAddressFor`；`contracts.ts` LightOracle / adapter ABI、identifier 编码、`decodeAddress`。
- `features/predict`：`model/predict.ts`（`Adjudication.phase / adapter / disputeKey`、`DisputeTerms / DisputeStep / DisputeInput`）、`model/dispute.ts`（校验常量与函数、`PredictDisputeError`、`PredictInsufficientBondError`）、`api/gateway.ts`（`getDisputeTerms / submitDispute / wrapForDispute`）、`api/http-predict-gateway.ts`（四步实现、乐观态、等回执）、`api/mock-predict-gateway.ts`、`hooks/use-predict.ts`（`useDisputeTerms / useSubmitDispute / useWrapForDispute`）、`ui/dispute-sheet.tsx`、`ui/settlement-screen.tsx`。
- 设计系统：`TextField` 支持 `multiline`。
- i18n 新键 `predict.dispute.*`（约 40 个），删除 `predict.settlement.disputeReason`；`i18n/seed` 已导出。
- 无原生依赖变化；可走 OTA。

## 验证

- `pnpm check` 全绿；`model/dispute.spec.ts`、`http-predict-gateway.spec.ts` 新增争议用例（条款读取、四步 calldata、免授权、押金不足、409、到期、客户端校验、crypto_periodic、兑换）。
- dev 端到端待平台方提供一个处于 `proposed` 的 regular / neg_risk / sports 市场（review §5）。
