# 钱包与链参数的管理端配置（2026-09-01）

## 起因

App 端的钱包底座已经把 `walletConnectProjectId`、启用的链、每条链的 RPC 与区块浏览器地址全部改成"服务端下发、无构建期兜底"。问题是：**这些值当时只能靠直接改数据库来设置**。核实 RN-Server 与 RN-Admin 之后确认了一个功能缺口和一个真缺陷。

## 核实结果

### RN-Server：能存，但不能安全地改

`wallet` 段本来就在 `app_configs` 的 `mobile-bootstrap` 配置里，`GET/PATCH /v1/admin/app-config` 已经能读写它。缺的是：

- `validConfig` 完全不看 `wallet`。运营填了 `http://` 明文 RPC、不存在的链名、或者把整个 Reown 项目链接粘进 Project ID，服务端照样 200 存下来，**读的时候再静默丢掉**——界面上看着保存成功了，实际什么都没变。
- 没有把平台支持的链目录暴露出去，管理端只能自己抄一份链表。这正是我上一轮在 App 端刚清掉的"两个真相来源"。
- `configSummary` 里没有钱包状态，管理端概览看不出"外部钱包能不能用"。

### RN-Admin：完全没有入口，而且会把配置清空

- 三个页面（配置中心 / 多语言 / 品牌与启动）里没有任何钱包配置界面。
- **真缺陷**：`managedAppConfigSchema` 没声明 `wallet`。zod 的 `z.object` 默认剥掉未声明字段，而配置中心是"GET 整份配置 → 改一个字段 → PATCH 整份回去"。所以**在配置中心保存任何东西（改个主题色、调个 TTL）都会把该租户的 Project ID 和链端点一起清空**，外部钱包随即连不上，且没有任何报错。

## 改动

### RN-Server

- `walletCatalog()`：把平台支持的链（id / 显示名 / chainId / 默认 RPC / 默认浏览器地址）放到 `GET /v1/admin/app-config` 的 `metadata.walletCatalog`，管理端不再自己维护链表。`supportedNetworks` 补了显示名。
- `validateWalletSection()`：PATCH 路径上校验并返回 `400 INVALID_WALLET_CONFIG` + 中文原因。读路径继续保持宽容（坏配置回退默认值，App 照样能启动）；**写路径不能沉默**——运营需要知道自己填错了。覆盖：未知字段、Project ID 格式（挡住粘链接）、空链列表、不支持的链、改写 `chainId`、明文 RPC / 浏览器地址。
- 缺省保留：PATCH 不带 `wallet` 时，从库里把已存的那段带过来（事务内 `SELECT ... FOR UPDATE`）。这样即使某个客户端的 schema 不认识 `wallet`，也不会因为一次无关编辑把租户配置清空。沿用的旧值不再校验——它已经在库里，读路径会归一化。
- `configSummary` 增加 `wallet: {chains, walletConnectConfigured}`。
- `contracts/openapi.json` 补上 `/v1/mobile/auth/*` 四条路由（上一轮加了路由但没同步契约），并说明 app-config 的 `wallet` 段与 400 错误码。

### RN-Admin

- `managedAppConfigSchema` 补上 `wallet`（带 default，兼容还没升级的服务端），`configViewSchema.metadata` 补上 `walletCatalog`，`configSummarySchema` 补上 `wallet`。这一条是上面那个清空缺陷的修复。
- 新页面「钱包与链」（应用配置插件下，`/wallet`）：
  - **WalletConnect 项目**：Project ID 单字段，说明写清"在 cloud.reown.com 建 AppKit 项目"、"这不是密钥、会随 bootstrap 下发给所有客户端"。格式不对时字段下即时报错。留空是合法状态，页面明确告诉运营"App 内『连接外部钱包』入口会隐藏，内置钱包不受影响"——否则会被当成整个钱包功能坏了。
  - **链与端点**：每条链一个开关；chainId 只读展示（平台固定）；RPC 一行一个，占位符就是平台默认值，说明里写明"下发给客户端的 RPC 是公开的，只能填可公开的端点"；每条链一个「恢复平台默认」。最后一条启用的链的开关被禁用（至少保留一条）。
  - 端点留空即存空值，由服务端在读的时候填平台默认——**不把当前默认值抄进租户配置**，否则平台以后换默认端点，这个租户会被固化在旧快照上。
  - 保存沿用现有的渐进式流程：校验 → 列出所有问题 → 填修改原因（≥3 字，写审计）→ 最终确认弹窗。未编辑态是只读概览，会标出每条链用的是"平台默认 RPC"还是"租户自定义 RPC"。
  - loading / error / empty / content 四态齐全（含"服务端没有下发链目录"的兼容态）。
- `tokens.css` 增加 `.status-configured` / `.status-required` 两个状态色（含深色主题），复用现有 StatusPill 文案「已配置」/「待配置」。

## 验证

- RN-Server：`go vet ./...`、`go test ./...` 全绿。新增 6 组测试：链目录字段完整、合法配置通过、9 种非法输入各自的报错、允许清空 Project ID、缺省保留（含无配置 / 无 wallet / 坏 JSON）、摘要如实反映是否已配置。
- RN-Admin：`pnpm check`（format + lint + typecheck + test + build）全绿，8 files / 44 tests。
  - `src/core/api.spec.ts` 两例走真实 zod：一例断言 `wallet` 与 `walletCatalog` 能活着穿过 schema——**去掉修复后这两例会失败**（已实测）；一例断言老服务端不下发这些字段时页面仍能加载。
  - `wallet-page.spec.tsx` 五例：未配置时的提示、平台默认标记、粘链接 + 明文 RPC 被拦且不发请求、启用新链并存自定义端点（chainId 来自目录、未改的链存空值）、最后一条链不可关 + 恢复默认。
  - `pages.spec.tsx` 一例：配置中心保存无关字段时 `wallet` 原样带回。注意这一例走的是被 mock 的 adminApi，**不经过 zod**，所以它只能保证页面不丢字段，真正守住剥字段那个 bug 的是 `api.spec.ts` 那两例。
### 线上实测（部署后，`api.anyfun.win` / `console.anyfun.win`）

- `GET /v1/admin/app-config` 返回 `metadata.walletCatalog`（三条链带 chainId 与默认端点）和 `summary.wallet = {chains:[bsc,eth,base], walletConnectConfigured:false}`——当前租户确实还没填 Project ID。
- 三次非法 PATCH 全部 `400 INVALID_WALLET_CONFIG`，报文就是运营能看懂的那句：
  - 粘了项目链接 → `walletConnectProjectId 格式不对：…不要填入完整链接`
  - `chains:["solana"]` → `不支持的链 "solana"：当前平台支持 bsc / eth / base`
  - `networks[0].chainId=1` → `bsc 的 chainId 固定为 56，不可修改`
- 三次拒绝之后 `databaseVersion` 仍是 4，确认是在写入之前被拦下来的。
- 控制台 `https://console.anyfun.win/wallet` 返回 200，线上 JS 包里能搜到「钱包与链」「WalletConnect 项目」与 `walletCatalog`。

### 未做的验证

没有对线上租户做一次**成功**的 PATCH——那会 bump 配置版本并给所有设备发 `bootstrap_updated` 推送。所以"缺省保留旧 wallet 段"这条只有单测 + 管理端 round-trip 测试覆盖，没有线上写入实测。真正填 Project ID 时会顺带验证到。

## 端到端实测（运营在新页面填入 Project ID 之后，2026-09-01 10:05-10:20）

链路：管理端保存 → 服务端下发 → App 缓存 → App UI → WalletConnect relay。

1. **管理端写入**：`databaseVersion` 4→5，`updatedBy=amos@chainup.com`，审计记录 `config_update / reason=发布链`。`summary.wallet.walletConnectConfigured` 变成 `true`。
2. **服务端下发**：`GET /v1/mobile/bootstrap` 的 `wallet.walletConnectProjectId` 是 32 位十六进制，`networks` 三条链带 chainId / rpcUrls / explorerUrl。
3. **设备落缓存**：模拟器上 1.2.4(18) 的包，AsyncStorage 里 `foundation.bootstrap.v3.*` 的 `savedAt=10:09:10`（在运营 10:05 保存之后），`wallet` 段含完整 projectId 与三条 networks。schema 不匹配会静默回落到 fallback，缓存里就不会有这段，所以缓存里有即证明 App 端接受了。
4. **App UI**：钱包入口出现 `CONNECT EXTERNAL WALLET` 分组（MetaMask 标着 Installed、OKX Wallet、Trust Wallet、Other wallets）。**没配 projectId 时这一组是隐藏的**，出现即说明 App 读到了下发值。
5. **真实 relay 会话**：点 Other wallets 生成二维码，截图解码得到 `wc:08d51f05…@2?…relay-protocol=irn&symKey=…`。用一个本地"钱包端" SignClient pair 这个 URI，**收到了 App 发出的 session_proposal**，其中 `chains=[eip155:56, eip155:1, eip155:8453]`、`methods=[personal_sign, eth_signTypedData_v4, eth_sendTransaction, eth_signTransaction]`，与 `walletconnect-connector.ts` 里的配置和下发的三条链完全一致。没有批准这个会话（不代替用户在真实钱包里签授权），sheet 停在"等待钱包批准"，随后关闭。
6. **对照实验（确认判据有判别力）**：同样的脚本换成伪造的 `000…0` 和格式非法的 `not-a-project-id`，在**独立进程**里都在约 61 秒后失败于 `Failed to publish custom payload`；下发的那个 261ms 就 `relayConnected: true`。
   注意第一次做这个对照时把两个 ID 放在同一个进程里跑，SignClient 复用了已初始化的 Core（日志里就写着 `Core is already initialized`），伪造 ID 也"通过"了——那个结果无效，分进程后才有判别力。

结论：`walletConnectProjectId` 与链端点的服务端下发链路端到端可用，外部钱包连接已经能真正建立 relay 会话。剩下的只有"在真实钱包里批准并签名"这一步，需要一台装了 MetaMask 的真机去扫码。
