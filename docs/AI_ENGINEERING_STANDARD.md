# AI 工程规范

目标不是让 AI “写得更多”，而是让任何新接手者在缺少隐性上下文时仍能做出小、准、可证明、可回滚的变更。

## 1. 仓库必须提供的机器可读上下文

- 根 `AGENTS.md`：不可违反的执行规则。
- `docs/ARCHITECTURE.md`：层次、依赖方向、数据所有权。
- ADR：已经做出的重要技术决策及原因，禁止同一问题反复选型。
- OpenAPI 生成客户端：避免凭猜测手写 API。
- 统一脚本：`pnpm check` 不依赖 AI 记忆一串隐含命令。
- feature `README.md`（复杂 feature 才需要）：不变量、入口、状态机、接口和测试地图。
- 组件目录和测试 fixture：提供确定性视觉/数据样例。

文档描述当前事实，不存放可能马上失效的长篇愿景。代码行为改变时，同一个变更中更新相关文档。

## 2. 标准变更流程

### 2.1 Discover

1. 阅读规则、相关 feature、相邻测试和最近 ADR。
2. 检查 git 状态，识别用户已有改动。
3. 从入口追踪真实调用链，禁止只根据文件名猜测。
4. 查询 generated header、API contract、持久化 schema 和 feature flag。

输出：现状证据、影响面、未知项。

### 2.2 Specify

使用 `pnpm workflow:new feature <short-name>` 或 `pnpm workflow:new bugfix <short-name>` 生成变更记录，并按 [App 可靠变更工作流](workflows/APP_CHANGE_WORKFLOW.md) 明确：

- 用户场景与非目标；
- Given/When/Then 验收条件；
- loading/empty/error/offline/content；
- API、数据、权限、隐私、升级和监控影响；
- 回归测试与回滚。

小改动可在任务描述中包含同等信息，不强制制造文档。

### 2.3 Implement

- 先建立失败测试或最小复现，再修改实现。
- 在正确层解决根因，不在页面复制平台逻辑。
- 只改达成验收条件所需的范围。
- 生成文件通过官方脚本更新，并一起检查 diff。
- 不确定的外部行为以本地类型、源码、测试或官方文档验证。

### 2.4 Verify

验证按风险分层：

| 变更          | 最低验证                                            |
| ------------- | --------------------------------------------------- |
| 纯函数/模型   | 单元测试、typecheck、lint                           |
| UI 组件       | 上述 + 交互测试 + light/dark/字体放大截图           |
| 页面/导航     | 上述 + 状态矩阵 + 对应 E2E                          |
| API           | 上述 + client regenerate + contract test + 错误路径 |
| 持久化        | migration 前后、进程重启、降级/回滚测试             |
| 原生/权限/SDK | iOS/Android development build + 真机关键路径        |
| 更新/启动     | embedded/OTA/回滚/离线/启动崩溃矩阵                 |

测试报告必须区分 passed、failed、not run；禁止把“代码看起来正确”写成“已验证”。

### 2.5 Handoff

交付信息固定包含：结果、关键决策、改动文件、运行命令及结果、未验证项、发布影响、数据/API 兼容、回滚方式。

## 3. 缺陷修复协议

修 bug 时必须回答：

1. 可观测症状是什么，影响哪些用户/版本？
2. 从 UI 到状态、网络、服务端的真实调用链是什么？
3. 根因证据是什么，为什么不是相邻假设？
4. 哪个测试在修复前失败、修复后通过？
5. 是否存在历史脏数据、缓存或已发布 OTA 需要额外修复？
6. 是否需要监控该问题不再发生？

禁止仅 catch 异常、扩大重试、加空值默认值来掩盖不变量破坏，除非这本身就是经过论证的降级策略。

## 4. 新需求协议

新需求必须从 vertical slice 完成：可触达入口 -> 页面全状态 -> API 契约 -> 监控 -> 测试 -> 灰度。不要先建设没有用户路径的“万能抽象”。

若需求会增加原生能力、权限、持久化、后台行为、推送、深链或公开 API，必须在编码前标明需要全量发版还是可热更。

## 5. AI 禁止行为

- 未读 `AGENTS.md` 就修改代码。
- 修改任务外用户已有变更，或使用破坏性 git 命令清理工作区。
- 手改 generated、lockfile 或原生生成目录来“让 diff 看起来通过”。
- 编造不存在的接口、配置、测试结果、设备验证或性能数据。
- 直接引入第二套网络、状态、表单、日志或 UI 体系。
- 把密钥、token、真实用户数据加入 fixture、日志或提交。
- 用全局 `any`、关闭 lint/typecheck、删除失败测试来通过门禁。
- 未证明兼容就通过 OTA 交付原生变化。
- 在同一个 bug PR 中做无关格式化、依赖升级和架构重构。

## 6. 自动化门禁

最终 `pnpm check` 应按固定顺序执行 format-check、lint、boundary check、typecheck、unit/component tests、OpenAPI drift check。CI 另执行 dependency/secret/license scan、原生构建和选定 E2E。

重要不变量必须变成自动规则，例如：

- 禁止 feature 直接 `fetch`；
- 禁止跨 feature 深层 import；
- 禁止业务层使用 raw color；
- 禁止导入 generated 内部实现；
- 禁止 ErrorBoundary/telemetry 记录敏感 key；
- 禁止 OpenAPI breaking change 未审批。

规则能被 lint/test 表达时，不要只写在文档里。

## 7. 文档防漂移

- README 只做地图，不复制完整规范。
- ADR 只追加状态和替代关系，不悄悄重写历史原因。
- 文件路径、命令和配置键由文档测试/链接检查验证。
- 每季度执行一次“从零接手演练”：新 AI 仅依据仓库文档完成一个小 feature 和一个 bug，记录缺失上下文并修正规范。
