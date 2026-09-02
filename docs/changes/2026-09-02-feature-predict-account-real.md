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

## 不做的事

- 没有任何「平台不可用就用演示数据」的路径：关联缺失显示未配置，public-info 对不上直接报错。
- 主网 `unwrapDelay` 到期提醒、持仓 / 行情 / 下单接入：后续阶段。

## 运维待办

- 新建 dev 租户 + dev App 包，关联 `predict.prax1s.xyz` / scopeId `0xfb05…454a` / op-sepolia；线上租户 anyfun 保持 `modules.predict=false`，不得指向 dev。
- 租户目录上 USDW（`0x790e…6098`，6 位）以便转入路径 B 显示 EOA 的 USDW。

## 验证

- RN-App `pnpm check` 全绿；新增 spec：`http-predict-account-gateway.spec.ts`（假平台 + 假链，覆盖启用 / 余额 / 转入 / 两阶段转出 / 关联变化清凭证）、`transfer-form.spec.tsx`、`predict-enable-screen.spec.tsx`，`market-list-screen.spec.tsx` 改为账户网关状态驱动。
- 真机对 dev 环境的端到端联调待 dev 租户建好后进行。
