# 链上收款记录：接入平台扫链索引（第三期 App 侧）

- 日期：2026-09-06
- 设计与决策：`docs/design/wallet-receive-index-2026-09-06.md`（§4.11 接口、§4.13 合并规则）
- 服务端：RN-Server `GET /v1/mobile/wallet/transfers`（分支 `feat/chain-scan-indexer`），契约已同步到 `contracts/rn-server.openapi.json`

## 现状与问题

1. 记录页"钱包转账"只有本机发起的转出；别人打进来的钱（收款）没有任何记录，用户只能去区块浏览器看。
2. 收款页给了地址就结束了，钱到没到账 App 不知道，也不刷新余额。
3. 没有索引状态的概念：一条链没开索引、索引中断或落后时，界面无法说明"记录可能不完整"。

## Given / When / Then

- Given 已登录且租户开了链上转出 When 打开记录页"钱包转账" Then 列出平台索引的收款与转出（含其他软件从本地址发起的转出）∪ 本机进行中 / 失败的转出；同一笔本机转出被索引到后只显示服务端那行。
- Given 某条链索引正常 Then 顶部一行"{链} 已索引到 {时间}"；落后超过 10 分钟再加"落后 N 分钟"。
- Given 某条链 `unconfigured / stalled / paused` Then 顶部说明"未开启收款索引 / 索引中断 / 已暂停"，并给区块浏览器链接。
- Given 索引服务没答上 Then 顶部提示"收款索引暂时不可用：{原因}。以下只有本机记录"，本机记录照常显示。
- Given 记录的代币不在目录（服务端 `token=null`）或与客户端白名单精度不符 Then 该行不显示，顶部说明"N 条记录的代币不在目录中，未显示"。
- Given `attribution=unattributed` 的收款 Then 行与详情显示"来源待确认（合约内部转账或服务中断期间）"，没有对手方与哈希。
- Given 收款页打开且 App 在前台 When 每 15 秒轮询发现新收款 Then toast"收到 {金额} {币}"并刷新余额与资产页；收款页没打开时不报。

## 技术影响

- `WalletGateway` 新增 `transferFeed(address): WalletTransferFeed`（`items` / `index` / `indexError` / `hidden`）；`listTransfers` 取其 `items`。
- 新增 `features/wallet/api/http-wallet-index.ts`（`HttpWalletIndex`，按会话地址查询，跟随 `nextCursor` 最多 5 页 × 200 行；`transferOf` 行映射）。`EmbeddedWalletGateway` 新依赖 `index`，按 `(chain, txHash)` 合并本机账本，索引记录同样过 `trustedTokens`。
- `WalletTransfer` 加 `attribution` / `blockTime`；新类型 `TransferIndex` / `TransferIndexState` / `WalletTransferFeed`。
- hooks：`useWalletTransfers` → `useWalletTransferFeed(address, { refetchInterval })`；新增 `useIncomingTransferWatch`（AppState 前台 + 收款页打开时才轮询）。
- 记录页 `IndexNotices`；收款页用 `useImperativeHandle` 包一层拿到打开 / 关闭时机。
- i18n 新键 `records.index.*`、`records.unattributed`、`receive.arrived`；删除 `records.receiveNote`；`i18n/seed` 已导出。
- 无原生依赖变化；可走 OTA。服务端未部署前 `HttpWalletIndex` 会收到 404 → 记录页显示"收款索引暂时不可用"，本机记录不受影响。

## 验证

- `pnpm check` 全绿（新增 `http-wallet-index.spec.ts`、`embedded-wallet-gateway.spec.ts` 合并用例、`records-screen.spec.tsx`）。
- 服务端接口用本地 MySQL + 真实 OP Sepolia 索引验证：分页游标、`index.lagSeconds`、401 / 400 码（见 RN-Server 提交 733330d）。
