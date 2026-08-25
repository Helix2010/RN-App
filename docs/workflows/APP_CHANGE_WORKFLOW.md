# RN-App 可靠变更工作流

本工作流只针对 App 开发。服务端按常规接口工程维护，不要求复制此流程。

## 1. 创建任务证据

复杂需求或缺陷先运行：

```bash
pnpm workflow:new feature swap-confirmation
pnpm workflow:new bugfix wrong-token-decimals
```

生成的 Change Spec 必须在编码前填完用户场景、验收条件、全页面状态、链/钱包/精度影响、OTA/全量更新判断和回滚。

## 2. 新需求工作流

```text
需求证据
 -> Given/When/Then
 -> 设计令牌与组件复用判断
 -> API/OpenAPI 与运行时 schema
 -> vertical slice
 -> unit/component/contract/E2E
 -> iOS + Android
 -> staging 灰度
```

硬门禁：

- feature 代码不能直接导入 Tamagui、直接 fetch 或复制远程服务端状态；必须通过 `design-system`、`core/network` 与 Query hooks。
- 页面在实现 content 前先列出 loading/empty/error/offline/permission/blocked。
- 钱包签名必须展示 chain、token、amount、spender/recipient、gas 与风险；禁止签名盲文案。
- 金额禁止用 JS `number` 做链上精度运算。引入 decimal/bigint 方案前需在该 feature 明确单位边界。
- 新增原生模块、权限、scheme、entitlement、Manifest/Info.plist 变化必须标记“全量更新”，不能发 OTA。
- 新功能默认有 kill switch、观测指标和安全失败值。

## 3. Bug 修复工作流

```text
稳定复现
 -> 从屏幕追到 state/query/network/wallet/native
 -> 失败测试
 -> 根因最小修复
 -> 相邻边界回归
 -> 双端与版本影响
 -> 监控/历史数据处理
```

必须证明根因，不能靠吞异常、扩大 retry、默认填零、删除校验、关闭按钮或升级全部依赖掩盖问题。链上问题还要核对 chainId、token address、decimals、block/tag、RPC provider、钱包返回码和交易最终状态。

## 4. 验证矩阵

| 变更 | 最低验证 |
| --- | --- |
| 纯逻辑 | unit + typecheck + lint |
| UI/组件 | 上述 + 交互测试 + light/dark + 字体放大 |
| API | 上述 + OpenAPI pin + runtime schema + 超时/错误 |
| 钱包/签名 | mock unit + 测试链/真机 + 拒签/切链/重入 |
| 原生/权限 | iOS/Android Development Build |
| OTA/升级 | embedded/OTA/rollback + full channel |

`pnpm check` 是提交最低门禁。PR 必须如实区分 passed、failed、not run。

## 5. 交付格式

每次交付固定报告：用户结果、根因/关键决策、改动文件、实际验证、未验证项、API/数据/钱包影响、OTA/全量判断、灰度和回滚。
