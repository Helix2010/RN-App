# 平台链目录加入 Monad 主网（2026-09-02）

## 背景

预测市场平台（pm-cup2026）的默认主网是 Monad（chainId 143）。接入分析（`docs/design/predict-platform-integration-2026-09-02.md`）里把"加链"列为主网前置条件，用户决定先加上。

## 事实核验

- `https://rpc.monad.xyz` 的 `eth_chainId` 返回 `0x8f`（143）。
- Multicall3 标准地址 `0xcA11…CA11` 在 Monad 上有代码，余额批量读取与其它链同一套。
- 原生币 MON，18 位；浏览器 `https://monadvision.com`。

## 改动

- RN-App：`ChainId` 增加 `"monad"`；`CHAINS` 目录、bootstrap 链枚举、`PROTOCOL` 断言表（143 / 主网）、DEX 链色、测试夹具同步。客户端白名单对 Monad 为空：平台用的 USDC 是否为 Circle 官方部署未确认，不背书，租户上目录后没有估值、转出一律验证。
- RN-Server：`supportedNetworks` 增加 monad（默认端点 rpc.monad.xyz）；`ChainTokenSeed` 增加 MON 原生币行；迁移 32 `chain_token_seed_monad` 以幂等方式补写原生币行（把种子写入抽成 `seedChainTokens`，以后加链只需再加一条迁移）。
- RN-Admin：链目录来自服务端，无改动。

## 影响

- 没有显式配置链集合的租户按声明式默认拿到"全部主网"，现在包含 Monad。线上唯一租户 anyfun 显式配置了 `[eth, op-sepolia]`，不受影响。
- 只是目录里多了一条链；租户要在管理端勾选才会下发到 App。

## 验证

- RN-App `pnpm check` 全绿；RN-Server `go test ./...` 全绿（三处按链数断言的测试同步更新）。
