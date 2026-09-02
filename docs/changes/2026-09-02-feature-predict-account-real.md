# 预测账户与划转接真实平台（2026-09-02）

## 背景

App 里的预测账户余额、存入 / 取出此前全是 `MockPredictGateway` 的演示账本。用户要求把账号与划转按 `docs/design/predict-platform-integration-2026-09-02.md` 改成真实的：不再 Mock，不留任何兜底；行情、下单、持仓等后续逐步接入。

## 改动

### RN-Server / RN-Admin（已部署）

- 租户配置新增 `services.predict {domain, scopeId, chain}`；`modules.predict` 开启时必须完整有效，否则保存被拒、bootstrap 返回 503。
- 管理端「预测市场」页：开关、域名、scopeId、链；保存前必须「测试连接」通过（服务端探测 `gamma-api.{domain}/public-info`，核对 scopeId 与 chainId）。
- 规则「租户身份与外部系统的对应」写入三个仓库的 AGENTS.md：两边租户 id 不假定相等，只认显式配置的 scopeId。

### RN-App

- **配置层**：bootstrap schema 新增 `services.predict`；`core/predict-platform/config.ts` 保存下发的关联，变化时通知网关。
- **平台客户端** `core/predict-platform/*`：租户头 HTTP 客户端、public-info 校验、EIP-712 登录 + JWT 刷新、Safe / MultiSend 编码、relayer、CLOB L1/L2 认证、data-service、faucet、凭证保管（系统安全存储，按域名 + scopeId + 地址分键）。
- **链层**：`ContractCallService`（任意合约调用，EOA 付 gas，gas 上限与余额检查）、`eth_call`、回执日志读取；广播逻辑抽成 `broadcast.ts`。
- **账户网关** `HttpPredictAccountGateway`：四步启用（登录 / 建 Safe / CLOB 密钥 / 授权 MultiSend，幂等）、余额（Safe 的 USDW + clob 可用 / 冻结）、转入（USDC：按额 approve + wrap；USDW：transfer）、两阶段转出（initiate-unwrap → 等 `unwrapDelay`（链上读）→ claim-unwrap + USDC 回 EOA）、待领取列表（平台子图 ∪ 本机乐观记录）、faucet。平台关联变化时清空所有凭证；登出时丢掉该地址凭证。
- **界面**：
  - 启用引导页 `PredictEnable`：四步进度，一个按钮跑完缺的步骤；进入预测市场时每个地址在本次进程里自动弹一次，顶栏 / 账户页 / 划转表单都能再进。
  - 划转表单重写：转入选 USDC / USDW、估手续费、原生币不够不让提交、测试网 faucet；取回显示等待期与最小额，待领取列表带倒计时与领取按钮；账户未启用时只给启用入口。
  - 资产页 / 首页 / 账户详情：预测账户按「已启用 / 未启用」两态显示；账户详情显示 Safe 地址、可用 / 挂单占用 / 账户余额、待领取；去掉演示的持仓市值、可领取与资金记录。
  - 市场 / 下单 / 拆分合并 / 个人页改用真实账户余额；持仓页「可领取」改由持仓列表（仍是 Mock，待接入）自己算。
- **Mock 边界**：`MockPredictGateway` 只剩行情、下单、持仓；测试用 `InMemoryPredictAccountGateway` 只在 `src/test/` 存在，生产接线只有 `HttpPredictAccountGateway`。

## 对照设计核查与深度评审后的修正（2026-09-02 晚）

按设计文档 §3.3 / §3.4 / §3.7 逐条核对，再对照平台源码做了一轮评审，修正如下（每条都有 spec）：

- 设计缺口：429 指数退避三次；登录 40101 重取 nonce 再签一次；CLOB 401 丢本地密钥、回到"缺 CLOB 密钥"由用户重签；重装后首次启动清凭证（普通存储安装标记）；同一 Safe 的 SafeTx 串行；启用页展示平台协议并要求接受必读项（`GET {gamma}/agreements`，本机按 scopeId 记接受版本）。
- 严重缺陷：读不到的代币余额曾被当成 0；划转金额精度写死 6 位（改从平台代币 `decimals` 取，输入精度随之，最小取出额 0.001 USDW 能输入）；`withdraw` 在节点落后时误报"没有事件"（先等回执）；待领取合并只问了未领列表，网页版领掉的记录永远删不掉（改为两个列表都问）；转入绕过了租户 `onchainSends` 开关（加门禁）。
- 重要：报价低估（approve 费 + wrap 4 倍上界）；配置错误与限流在查询层不重试（`predictRetry`）；每次轮询重跑整套启用检查（进程内缓存）；登出时凭证清理失败会卡住登出；`services.predict` 缺失拖垮整个资产页；CLOB derive 空 catch 吞掉一切错误。
- 死代码：relayer 提交体的 `metadata`（服务端 `SubmitRequest` 无此字段）、`MultiSendOp.value`、`AssetsOverview.predict.safe`、`ActivityType "WITHDRAW"`、若干只在文件内使用的 export；英文 `transfer.note` 过时文案。
- 平台侧隐患（已写入设计文档 §5）：EIP-712 域名 `PredictMarket` 是 gamma 配置项且不在 `public-info`；CLOB secret 的 base64url / base64 解码不一致；`USDC_UNDERLYING` / `USDW_WRAPPER` 需在平台管理端手工加自定义合约行。

## 不做的事

- 没有任何「平台不可用就用演示数据」的路径：关联缺失显示未配置，public-info 对不上直接报错。
- 主网 `unwrapDelay` 到期提醒、持仓 / 行情 / 下单接入：后续阶段。

## 运维待办

- 新建 dev 租户 + dev App 包，关联 `predict.prax1s.xyz` / scopeId `0xfb05…454a` / op-sepolia；线上租户 anyfun 保持 `modules.predict=false`，不得指向 dev。
- 租户目录上 USDW（`0x790e…6098`，6 位）以便转入路径 B 显示 EOA 的 USDW。

## 验证

- RN-App `pnpm check` 全绿；新增 spec：`http-predict-account-gateway.spec.ts`（假平台 + 假链，覆盖启用 / 余额 / 转入 / 两阶段转出 / 关联变化清凭证）、`transfer-form.spec.tsx`、`predict-enable-screen.spec.tsx`，`market-list-screen.spec.tsx` 改为账户网关状态驱动。
- 真机对 dev 环境的端到端联调待 dev 租户建好后进行。
