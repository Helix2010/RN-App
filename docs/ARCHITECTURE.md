# RN-App 总体架构蓝图

状态：Active

适用范围：iOS、Android；Web、桌面端与鸿蒙不在第一阶段承诺范围内。

目标：形成可复用的移动端产品基座，而不是一个包含所有可能能力的超级模板。

## 1. 设计目标

基座必须同时满足：

1. **一致体验**：相同的视觉语言、状态模型、导航行为和可访问性要求。
2. **可恢复可靠性**：网络失败、权限拒绝、离线、进程重启、版本不兼容时都有确定行为。
3. **可观测**：一次用户问题能通过 release、device、session、traceId 定位到端到端链路。
4. **可升级**：JS/资源热更新与原生全量更新边界明确，支持灰度、暂停、回滚和强更。
5. **业务隔离**：增加 feature 不侵蚀平台层；平台能力不依赖具体业务。
6. **AI 可维护**：目录、契约、命令和验收条件是机器可读、可执行、可验证的，不依赖口头经验。

非目标：首期不建设微前端、动态下发任意页面 DSL、跨业务超级组件库、完全离线优先、任意原生插件热替换。

## 2. 技术基线

推荐采用：

| 领域 | 决策 | 原因 |
| --- | --- | --- |
| RN 运行方式 | Expo Development Build + Prebuild | 保留 Expo 工具链、OTA 和配置插件能力，同时允许真实原生模块；不依赖 Expo Go |
| RN 架构 | React Native New Architecture | 以 Fabric / TurboModules 为长期基线，新依赖必须验证兼容性 |
| UI 底层 | Tamagui + 自有 Web3 Design System | 主题与原子组件成熟，适合 DEX 高定制和未来 RN/Web；feature 不直接依赖供应商组件 |
| 语言/包管理 | TypeScript strict + pnpm + Corepack | 收紧边界，确保本地与 CI 依赖一致 |
| 导航 | React Navigation，集中定义 typed route | 原生交互成熟，支持深链和嵌套路由 |
| 服务端状态 | TanStack Query | 缓存、失效、重试和异步状态有单一模型 |
| 客户端状态 | Zustand，仅用于跨页面/跨组件客户端状态 | API 小、样板少；不得复制服务端缓存 |
| 表单 | React Hook Form + 边界 schema 校验 | 高性能且能显式表达提交/字段错误 |
| API | OpenAPI 生成 TypeScript client + 平台网络适配器 | 契约可检查，业务不手写 URL 和响应类型 |
| 可观测 | Sentry 类错误平台 + OpenTelemetry 链路语义 | 移动崩溃还原与后端 trace 对齐 |
| 测试 | Vitest/Jest + React Native Testing Library + Maestro | 单元/组件/关键路径分层，避免全靠脆弱 E2E |

依赖的具体版本由脚手架初始化时选取当前稳定兼容组合，并由锁文件和 CI 固定。升级按月集中处理；RN/Expo 大版本升级独立立项，不在业务 PR 中顺带完成。

## 3. 分层与依赖方向

```text
src/
  app/                  # 启动编排、Provider、根边界，不含业务规则
    bootstrap/
    providers/
  core/                 # 无业务语义的平台能力
    auth/
    config/
    network/
    observability/
    permissions/
    storage/
    updates/
  design-system/        # tokens、primitives、patterns、icons
  features/
    <feature>/
      api/               # 只做 generated client 到领域模型的适配
      components/
      hooks/
      screens/
      state/             # 仅本 feature 的客户端状态
      model/
      __tests__/
      index.ts           # 唯一公共出口
  navigation/           # route contract、linking、guards
  generated/api/        # OpenAPI 生成产物，只读
  test/
assets/
e2e/
docs/
```

允许的依赖方向：

```text
app -> navigation -> features -> core
        |              |
        +-------> design-system

core ---------> 第三方平台适配器
design-system -> React Native 基础能力
```

约束：

- `core` 与 `design-system` 不得依赖 `features`。
- feature 只能从另一个 feature 的 `index.ts` 导入经批准的领域能力，常规页面协作通过 navigation 或应用级 orchestration 完成。
- 业务实体与 API DTO 分离。DTO 可以变化，领域模型只表达应用需要的语义。
- 第三方 SDK 包在 adapter 后方，业务层依赖内部接口，便于测试和替换。

依赖边界最终使用 ESLint import rules / dependency-cruiser 自动检查，而不是依赖代码评审记忆。

## 4. 启动状态机

应用启动不是一个无限 loading 页面，必须是有超时与降级的状态机：

```text
cold start
  -> load local config and last safe session
  -> initialize redacted observability
  -> fetch signed remote bootstrap config
  -> evaluate full-update policy
  -> evaluate compatible hot update
  -> restore or refresh authentication
  -> hydrate feature flags and essential dictionaries
  -> ready / degraded / blocked
```

- 本地配置、遥测初始化不能等待网络。
- 远端 bootstrap 设置总超时；失败时可使用未过期的签名缓存。
- `blocked` 只用于安全/协议无法兼容或强制全量更新，不能把普通网络失败变成强更。
- 非关键配置失败进入 `degraded`，应用仍应允许进入可用功能。
- 启动阶段记录 span 和阶段耗时，但不采集敏感载荷。

## 5. 配置与环境

环境最少分 `development`、`staging`、`production`，通过构建 profile 固化：

- bundle identifier/applicationId、图标、显示名、API origin、Sentry environment 必须成套变化。
- `.env` 只可保存非敏感构建参数；进入客户端包的任何值都视为公开信息。
- 密钥只存在 CI secret、原生安全能力或服务端；禁止把“加密后的密钥”当成客户端秘密。
- 远程配置只控制预先实现并验证过的行为；不得下发任意可执行代码。
- feature flag 必须有 owner、默认值、失效日期和故障安全值；废弃后删除双分支。

## 6. 数据与状态

### 6.1 数据所有权

- 远端资源：TanStack Query 是唯一事实源。
- 认证会话：Auth service 持有，refresh token 在系统安全存储中，access token 尽量留在内存。
- UI 临时状态：组件本地 state。
- 跨页面客户端状态：Zustand slice，必须说明生命周期和清除时机。
- 表单：React Hook Form；提交成功后由 query invalidation/update 驱动页面刷新。
- 持久化：MMKV/AsyncStorage 统一经过 storage repository，带 schema version、迁移和清理策略。

禁止把完整 Query Cache、访问令牌、无法过期的 PII 快照无差别持久化。

### 6.2 离线策略

默认是 **offline-aware**，不是 **offline-first**：

- GET 可显示标记了采集时间的安全缓存。
- mutation 默认失败并允许用户明确重试，不自动排队。
- 只有具备幂等键、冲突策略、过期时间和可见队列 UI 的业务，才能启用离线 mutation queue。
- 网络恢复不能触发提交风暴；重放必须限速并逐项报告结果。

## 7. 平台服务接口

业务只依赖下列内部能力，不直接依赖供应商 SDK：

- `AuthService`：登录、恢复、刷新、退出、会话失效事件。
- `ApiClient`：认证、trace、超时、重试、错误归一化。
- `StorageService` / `SecureStorageService`：版本化读写。
- `Telemetry`：error、event、span、breadcrumb，默认脱敏。
- `PermissionService`：统一权限状态与设置页恢复。
- `UpdateService`：检查、下载、应用、延后、回滚状态。
- `FeatureFlagService`：typed flags 与默认值。
- `Clock` / `IdGenerator`：关键业务避免硬依赖系统时间与随机数，保证可测。

## 8. 导航、深链与认证

- route name、参数 schema 和 deep-link mapping 集中定义并类型化。
- 深链先解析/校验，再做认证与权限 guard，最后导航；无效链接进入可恢复错误页。
- 登录成功返回原意图页面；退出必须清理敏感路由栈、缓存和通知角标。
- Android 返回键、iOS swipe back、模态关闭必须遵循同一页面状态规则。
- 禁止从任意 service 持有全局 navigation ref 来绕过页面流程；系统事件进入统一 intent coordinator。

## 9. 性能预算

基座建立可度量预算，具体阈值在真实设备基线后冻结：

- 监控冷启动到首个可交互、首屏渲染、JS bundle、原生包体、图片内存和页面掉帧。
- 列表默认考虑虚拟化、稳定 key、分页和图片尺寸；禁止在 render 中执行重计算。
- 首屏不等待非关键 SDK；低优先级初始化延后。
- 新依赖记录 JS/原生体积与启动影响；能用已有能力解决时不引入重型库。
- 性能回归门禁使用中低端真实 Android 和至少一个受支持 iPhone 档位验证。

## 10. 安全基线

- 认证优先 OAuth 2.1/OIDC Authorization Code + PKCE；不在 WebView 内收集第三方密码。
- 服务端所有请求使用 TLS；证书绑定仅在团队有双证书轮换和紧急开关能力后启用，不能作为默认口号。
- 本地敏感数据使用 Keychain/Keystore；登出、账号切换、设备风险事件时清除。
- 应用完整性、root/jailbreak 只能作为风险信号，默认不依赖单一信号粗暴封禁。
- 截图保护、剪贴板、推送内容脱敏按页面数据等级启用。
- 依赖扫描、secret scan、许可证清单、SBOM 纳入 CI；高危漏洞有明确 SLA。

## 11. 契约与兼容

RN-Server 是 OpenAPI 契约的所有者。发布流程产出不可变的版本化契约，RN-App 生成 client 并提交生成结果：

1. Server 修改 DTO/route，生成 OpenAPI。
2. CI 做 breaking-change 比较；移动端已发布版本依赖的字段不得直接删除或改义。
3. App 升级契约版本并运行 client generation。
4. Adapter 将 DTO 映射为 feature model。
5. 契约测试覆盖成功和规范化错误。

服务端至少兼容仍在支持窗口内的 App 版本；废弃接口必须先观测活跃版本占比，再经过公告、迁移、最低版本提升和清理窗口。

## 12. 完成定义

一个 feature 只有同时满足以下条件才算完成：

- UI 全状态、可访问性、暗色模式和字体放大已验证。
- 请求可取消，重复提交受控，错误对用户可理解且对工程可追踪。
- 单元/组件测试覆盖业务分支；关键收入、安全或登录路径有 E2E。
- 日志与事件无敏感数据，traceId 可与服务端关联。
- API、持久化、权限、深链、推送、热更新/全量更新影响已说明。
- staging 验收通过，有灰度指标、停止条件和回滚方法。
