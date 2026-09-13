# RN-App 工程执行约束

本文件对人类开发者与 AI 同等生效。`MUST / MUST NOT / SHOULD / MAY` 分别表示必须、禁止、建议、可选。

## 开始任务前

1. MUST 阅读根 README、本文件，以及与任务相关的 `docs/` 文档。
2. MUST 检查工作区和当前分支，不覆盖、不回滚任务范围外的改动。
3. MUST 先写清验收条件、现有行为、预期行为和风险；新增需求或 Bug 修复按 [App 可靠变更工作流](docs/workflows/APP_CHANGE_WORKFLOW.md) 执行，并可使用 `pnpm workflow:new` 生成变更记录。
4. 修复缺陷时 MUST 先建立稳定复现或失败测试；新增需求时 MUST 先明确页面状态、接口契约与异常路径。

## 架构边界

- 业务代码 MUST 放在 `src/features/<feature>`，按业务能力内聚。
- HTTP 请求 MUST 经 `src/core/network`；业务层禁止直接调用 `fetch` 或第三方 HTTP 客户端。
- 服务端数据 MUST 由 TanStack Query 管理；跨页面客户端状态才可使用 Zustand；表单状态使用 React Hook Form。禁止为同一状态建立多个事实源。
- 颜色、字号、间距、圆角、阴影、层级和动效时长 MUST 使用设计令牌；业务代码禁止裸值复制 UI。
- 页面 MUST 使用设计系统组件表达 loading、empty、error、offline、permission-denied 和 content 状态。
- 原生插件、权限、持久化结构、深链、推送、后台任务或热更新 runtime 的变化 MUST 先做影响分析；原生 ABI 变化禁止通过热更新交付。
- `src/generated/**` MUST 由工具生成，禁止手改。
- feature 之间 MUST NOT 直接深层导入；共享能力先判断属于 design-system、core，还是独立领域模块。

## SaaS 租户构建

- 生产构建 MUST 显式选择租户 slug；Android 直装包统一使用 `pnpm android:release <slug>`。
- `tenants/<slug>/tenant.json` MUST 是该租户构建信息的唯一事实源，集中维护域名、applicationId、应用名、scheme、Android 包名、iOS Bundle ID、发布渠道、OTA Channel、版本、Build 与图标配置。
- `app.config.ts`、`eas.json`、CI 参数和本地命令 MUST NOT 再硬编码或复制租户 API、applicationId、包名、版本和 Build；环境变量只允许传递租户 slug 或密钥类配置。
- Release 构建 MUST 在产物复制前读取 APK 内嵌 `app.config`，校验租户域名、渠道、应用身份、版本、Build、OTA 和 runtimeVersion；任一不一致必须失败。
- 新租户 MUST 新建独立 `tenant.json` 与品牌资产，禁止复用其他租户包名、签名、域名或缓存命名空间。
- 完整打包命令、EAS 用法、发布检查和回滚要求 MUST 以 `docs/SAAS_TENANT_BUILD_RUNBOOK.md` 为准；Claude 规则见根目录 `CLAUDE.md`。

## 安全与隐私

- MUST NOT 在代码、日志、埋点、异常附件或截图中写入 token、密码、验证码、身份证件、银行卡等敏感信息。
- token MUST 存储在系统安全存储中；普通配置与敏感凭证禁止混用。
- 新权限 MUST 采用按需申请，并提供拒绝、受限和永久拒绝后的可恢复路径。
- 外部输入、深链参数、本地持久化数据和服务端响应 MUST 在边界校验。

## 机密的操作纪律（不让机密进入会回显的地方）

上面「安全与隐私」管的是**代码和日志**里不许出现机密；这一节管的是**执行命令时**不许
把机密带到会被回显的地方：对话记录、CI 日志、终端滚动区、提交信息、PR、工单、截图。
规则与 RN-Server `AGENTS.md` 同名小节一致，这里只列本仓库最容易踩的几条。

- 机密 MUST NOT 出现在对话、日志、提交信息、PR、工单、截图里。已经出现就 MUST 立刻
  轮换，并在交付说明里写清泄了什么、轮换了没有。
- 本仓库的机密清单：release keystore 与它的口令、OTA 签名私钥、bootstrap 签名私钥、
  `.env.local` / `.env.tenant` 里的路径与口令、测试钱包助记词。构建脚本打印的每一行
  MUST 先确认不含这些——Gradle 失败时很乐意把整条命令行打出来。
- 取口令 MUST 只取那一个值，MUST NOT `cat` 整个 `.env.local` 或口令文件。默认不开
  `set -x`、不用 `curl -v`、不把口令放命令行参数（`ps` 看得到）。
- 需要人工执行的取密动作 MUST 在他自己的终端里跑，MUST NOT 用会把输出送回对话的通道。
- 可以贴的只有公开部分：签名证书、证书指纹（`signerSha256`）、bootstrap 签名**地址**、
  公钥。私钥、keystore 口令、助记词一律不行。

## 变更纪律

- MUST 做最小、聚焦的变更；禁止顺手重构无关模块。
- 新增生产依赖、跨层抽象或替换核心库 MUST 新增 ADR，写明替代方案、体积、维护性、原生影响和退出策略。
- 公共组件至少证明两个真实复用场景；否则留在 feature 内。
- 禁止吞异常、空 `catch`、无说明的 `any`、永久 TODO、依赖时间或网络的非确定性测试。
- API 变更必须与 RN-Server 的 OpenAPI 契约同步，并通过兼容性检查。

## 正式场景开发原则（不写回退 / 兜底）

- 一切按正式场景开发。每个值只有一个正式来源（服务端下发 / 链上 / 用户输入 / 租户构建配置）；禁止 `?? 默认值`、禁止"老服务端没下发时"分支、禁止"配置坏了换一个值顶上"。契约变更与 RN-Server、RN-Admin 同步发布。
- 缺失或不符即失败：bootstrap 任何一段解析失败就是整份无效（运行时继续用上一次成功的快照，那是既有的可靠性机制，不是兜底），不逐条丢弃、不用默认值补。客户端安全断言（chainId、https、地址校验和、精度关系）拒绝不符的条目并留 warning，但**不修、不补、不猜**。
- 状态如实呈现：查询失败是错误状态（保留上次真实值或显示不可用），不显示演示数据、不显示 0；没有启用的链就是空态；调用方问了未启用的链直接抛错。
- 允许的只有**声明式默认**：租户"未配置"时的平台默认值，必须文档化且在管理端可见。演示账本是显式的租户状态（`onchainSends=false`），不是回退；真链模式下任何链上失败都以错误呈现。
- 测试必须显式搭建正式场景（`src/test/wallet-config.ts` 搭租户钱包段，`renderWithProviders` 的 `config` 选项换配置），不依赖代码里的默认值。
- 代码与交付说明里不出现"回落 / 兜底 / 老服务端"这类措辞来描述新行为；出现就是设计还没到位。

## 租户身份与外部系统的对应

- RN-Server 的租户 id 只在本平台内有意义。接入任何外部系统（预测市场平台、CEX、其它 SaaS）时，**不得假定两边的租户 id 相同**——线上数据恰好一致（2026-09-02 时四个租户两边 id 与 scope_id 相同）是现状，不是规则，不能写进代码或推理。
- 两边的对应关系必须是租户应用配置里的**显式关联属性**，由管理端在开启对应模块时填写、随 bootstrap 下发（预测市场：`services.predict` 的接口域名 + 平台 `scopeId` + 我们这边的链，可选 `endpoints` 逐服务覆盖地址，留空按域名规则派生）。没有这条配置就没有关联，模块不可用。
- 关联键用对方系统的**正式身份标识**（预测平台是 `scopeId`，它出现在对方所有签名、JWT 与密钥里），不用对方的自增 id、slug 或域名。
- 保存与使用两端都要核验：管理端保存前向对方接口回读身份并与所填比对；App 拿到下发后做同样的比对，不符即不启用该模块并留痕。
- 不得读取外部系统的数据库表来推导或"补全"关联，即使它就在同一台数据库实例上——那是另一个服务的内部结构。

## 数据库表设计原则（先复用再建表）

- App 侧设计文档里提出的服务端表结构，遵守 RN-Server `AGENTS.md`「数据库表设计原则」：先盘点既有表（配置进 `app_configs`、历史进 `audit_events`、运行状态用 JSON 列合并、派生集合不建登记表），只有新实体才建表，并附"复用映射表"说明每张拟新增表的处理与理由；每表每列带 `COMMENT`（含义、来源、取值或单位、特殊值）。
- 本地持久化同理：新增存储键前先看既有键（`foundation.*`）与既有 store 能否承载；每个键在代码注释里写明内容、版本与迁移方式，不把同一事实存两处。

## 完成任务前

脚手架落地后，最低门禁为：

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm api:check
pnpm check
```

涉及原生代码、插件、权限或构建配置时还 MUST 完成 iOS 与 Android 开发构建；涉及关键用户路径时 MUST 完成对应 E2E。若环境导致某项未运行，交付说明中必须明确列出，禁止写“全部通过”。

交付说明 MUST 包含：实现结果、改动文件、实际运行的验证、未验证项、兼容/发布影响和回滚方式。
