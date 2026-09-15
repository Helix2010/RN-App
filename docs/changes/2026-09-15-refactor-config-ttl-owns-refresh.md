# Refactor: config-ttl-owns-refresh

状态：Implemented（自动化验证完成；真机未运行）

## 现有行为

- 配置重拉的节奏读 `config.localization.refreshIntervalSeconds`（`runtime-context.tsx`）。这个
  值在服务端存于**语言设置**（`app_configs` 的 `languages` 行，平台默认 21600），管理端要去
  「多语言管理」里改一个跟语言无关的东西。
- 下发里另有一个顶层 `ttlSeconds`：两端都校验、也确实发到了设备，但 App 里**没有任何消费方**
  （全仓只有 schema 声明和内置兜底配置两处出现）。管理端「基础配置」上那个「缓存 TTL」
  改了不生效，而它的说明写着"用于 App 缓存失效"。
- `useBootstrap` 的 `staleTime` 是写死的 5 分钟，和上面两个值都没关系。
- 内置兜底配置里 `ttlSeconds: 300` 和 `refreshIntervalSeconds: 21600` 自相矛盾。

## 预期行为（验收条件）

1. 定时重拉的间隔 = 下发的 `ttlSeconds`；两个字段值不一致时按 `ttlSeconds` 走。
2. `staleTime` = `ttlSeconds`：重新挂载、回到前台的重拉和定时重拉是同一个口径。
3. 回到前台仍然立刻重拉一次，间隔只决定"一直开着不动"时的上限（不变）。
4. `ttlSeconds` 低于 300 的下发按解析失败处理，和服务端保存校验的下限一致。
5. 内置兜底配置的两个值一致（21600）。

## 改动

- `runtime-context.tsx`：重拉间隔改读 `config.ttlSeconds`，依赖数组同步。
- `use-bootstrap.ts`：`staleTime` 改为按当前数据的 `ttlSeconds` 计算。
- `bootstrap.schema.ts`：`ttlSeconds` 下限 300。
- `fallback-config.ts`：内置兜底的 `ttlSeconds` 改成 21600。

## 服务端（RN-Server `feat/base-config-truth`）

- 下发的 `localization.refreshIntervalSeconds` 改为读 `ttlSeconds`，语言设置不再接受这个字段的
  新覆盖；保存校验的 TTL 下限从 30 提到 300。
- 迁移 47 把每个租户**当时生效**的刷新间隔搬进 `ttlSeconds`（租户覆盖 > 平台默认 > 21600，
  夹到 [300, 86400]）。迁移和下发口径的改动在同一个二进制里：存量 `ttlSeconds` 大多是种子里
  的 300，先改口径会把全量设备的重拉从 6 小时变成 5 分钟，请求量涨 72 倍。
- 下发里 `refreshIntervalSeconds` 这个字段名**保留**（值等于 `ttlSeconds`）：已装机的 App 严格
  解析 bootstrap，少一个必填字段会让它们直接解析失败。

**上线顺序：先服务端后 App。** App 先上而服务端没上时，设备读到的 `ttlSeconds` 还是存量的
300，重拉会变成每 5 分钟一次——所以这一版**不能**先发。服务端上线后，两版 App 的行为一致
（旧版读别名，新版读 `ttlSeconds`，值相同）。

## 验证

- `runtime-context.spec.tsx`：新增"按下发的 ttlSeconds 重拉配置，不看 localization 里那个别名"
  （两个字段给不同的值，899 秒不拉、901 秒拉）。撤掉修复时该用例失败。
- `pnpm check`（format / lint / typecheck / test / api:check）。
- 真机未运行；生产租户上改一次 TTL 观察生效时间的端到端未做。

## 回滚

回退本提交即可，不需要服务端跟着回滚：下发里 `refreshIntervalSeconds` 仍然在，值也等于
`ttlSeconds`，旧代码读它得到同一个结果。
