# 转出页重排与资产链信息（2026-09-02）

## 背景（真机反馈）

- 资产列表仍显示演示余额：真机跑的是 OTA `ota_xir97eugZscn98BtwogbpQ`（runtime 1.2.6），它打包的是 03:07 之前的代码，不含 03:26 之后的链切换与按链余额改动；不是代码回退，是包没更新。
- 一条链不可用时"重试"用了拉伸的次级按钮，把整行撑爆。
- 转出页一进来就是地址栏，币种要往下翻；地址栏没有清空，没有扫码，地址簿是空的。
- 资产行只写了 `BSC` 这样的缩写，看不出"这个 USDC 在哪条链"。

## 改动

### 资产页

- 每个币的头像右下角叠链徽标（链品牌色 + 首字母），副标题写链全名（`CHAINS[chain].name`），同一符号在两条链上一眼可分。`TokenAvatar` 从资产页导出，转出页复用。
- 启用的链多于一条时，列表上方多一排链筛选（全部 / 各链，测试链带"测试网"），只列 `enabledChains()`；配置刷新把选中的链关掉时回到"全部"。
- 按链不可用提示的"重试"改为圆形图标按钮（`chain-unavailable-retry-<chain>`），不再拉伸。

### 转出页：币 → 地址 → 数量

- 第一块是**币种选择器**：显示当前选中的币（头像 + 链徽标、符号、链名、可用余额），点开面板按启用的链分组列出所有有余额的资产（含估值，无参考价显示"—"）；某条链余额不可用在该组内提示并可重试。选另一条链上的币，链跟着切换——不再有独立的"网络"分段控件。
- 第二块是**收款地址**，尾部动作：清空（有内容时出现）、粘贴、最近转出。粘贴与后续扫码共用 `recipientFromText`：接受纯地址与 EIP-681 链接（`ethereum:0x…@chainId?value=`），只取地址，链与金额一律不采纳——换链、填金额都要用户自己确认。
- **最近转出**（`useRecentRecipients`）：从 `wallet.listTransfers` 里取 `kind: "send"` 的对手地址，按地址去重、时间倒序、最多 5 条；地址栏为空时在栏下内联前 3 条，面板里列全部。空态如实写"还没有转出记录"。原来永远为空的地址簿入口与 `send.addressBook*` 文案删除。
- 第三块数量与之前一致；确认页不再显示地址簿标签。

### 文案

新增 `send.clear / send.recent / send.recentEmpty / send.pickToken / send.available / send.noBalanceOnChain / send.loadingBalances`，删除 `send.addressBook / send.addressBookEmpty`；`i18n/seed` 已导出（765 键），服务端种子同步见 RN-Server。

## OP Sepolia RPC 核对

线上 bootstrap（`api.anyfun.win`，租户 100000001）里 op-sepolia 的 `rpcUrls` 仍是平台默认 `https://sepolia.optimism.io`，管理端改的 Pocket 地址落在了 `explorerUrl` 字段。两条端点都能正常回答 `eth_chainId` 与 Multicall3，所以 App 侧"重试"来自旧 OTA 包，不来自端点；但浏览器字段要改回 `https://sepolia-optimism.etherscan.io`，否则"在浏览器查看"会打开 RPC 地址。

## 验证

- `pnpm check`：新增转出页币种选择 / 清空 / 粘贴 EIP-681 / 最近转出 / `recipientFromText` 用例，资产页链徽标与链筛选用例。
- 本次是纯 JS 改动，可作为 runtime 1.2.6 的 OTA 发布；扫码（`expo-camera`）是原生依赖，随 1.2.7 全量包（ADR 0010）。
