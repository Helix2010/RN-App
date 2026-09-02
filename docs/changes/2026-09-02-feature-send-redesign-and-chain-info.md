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

### 扫码（原生依赖，随 1.2.7 全量包）

- 引入 `expo-camera`（ADR 0010）；`app.config.ts` 加 config plugin，只申请相机权限。
- `AddressScanner`：全屏相机 + 取景框 + 手电筒；只认 QR；扫到的内容交给 `parsePaymentRequest`，不是地址时提示并 1.5 s 后恢复扫描；权限被永久拒绝时给"去设置"。
- EIP-681 链接里的 `chainId` 与当前选的币不在同一条链时，地址栏下方出黄字提示（`send-chain-hint`），不替用户换链；`value` 一律丢弃。
- `tenants/anyfun/tenant.json` 升到 1.2.7 / androidVersionCode 21 / iosBuildNumber 8。
- 测试替身 `src/test/mocks/expo-camera.tsx`：`CameraView` 把 `onBarcodeScanned` 挂在 View 上供 `fireEvent`，`setCameraPermission` 控制权限状态。

## OP Sepolia RPC 核对

线上 bootstrap（`api.anyfun.win`，租户 100000001）里 op-sepolia 的 `rpcUrls` 仍是平台默认 `https://sepolia.optimism.io`，管理端改的 Pocket 地址落在了 `explorerUrl` 字段。两条端点都能正常回答 `eth_chainId` 与 Multicall3，所以 App 侧"重试"来自旧 OTA 包，不来自端点；但浏览器字段要改回 `https://sepolia-optimism.etherscan.io`，否则"在浏览器查看"会打开 RPC 地址。

## 验证

- `pnpm check`：新增转出页币种选择 / 清空 / 粘贴 EIP-681 / 最近转出 / `recipientFromText` 用例，资产页链徽标与链筛选用例。
- 第一个提交（转出页重排、链信息）是纯 JS 改动，可作为 runtime 1.2.6 的 OTA 发布；第二个提交引入 `expo-camera`，是原生依赖，随 1.2.7 全量包（ADR 0010）。

## 审查修正（同日）

- 删掉 `recipientFromText`：`parsePaymentRequest` 落地后它只剩测试在用，测试改为直接测后者。
- 扫码授权只弹一次：此前效果跟着 `permission` 变化重复请求，Android 上"拒绝一次"后 `canAskAgain` 仍为 true，会把用户按在系统弹框里反复点。
- 转出主表单的链不可用提示只说当前链：余额改成查全部启用的链之后，别条链的故障会摆到转出表单上；各链自己的故障留在选币面板的分组里。
- 配置刷新间隔改用下发值（`localization.refreshIntervalSeconds`，管理端"刷新间隔"），此前客户端写死 15 分钟、把下发值只挂在 effect 依赖里不用——管理端那个输入框等于不起作用。App 端该字段改为必填（服务端始终下发，范围 300–86400）。
- 服务端：语言设置解析失败时不再静默跳过、下发一个缺刷新间隔与语言目录的 localization 段，改为 503（与代币目录、零条链的处理一致）。
- 个人中心与安全中心的"转账地址簿"去掉编出来的"2 个地址"计数（地址簿 CRUD 仍是 ADR 0009 记录的缺口），删除 `profile.addressBook.count` 文案。
