# 网络、异常采集与应用升级规范

## 1. 网络请求架构

```text
feature query/mutation
  -> feature api adapter
  -> generated OpenAPI client
  -> ApiClient pipeline
     config -> auth -> request id/trace -> timeout/cancel
     -> transport -> response validation -> error normalization
  -> TanStack Query policy
```

### 1.1 请求元数据

每个请求最少携带：

- `Authorization`（仅需要认证的 endpoint）；
- W3C `traceparent` 或平台统一 trace header；
- `X-Request-Id`；
- `X-App-Version`、`X-Build-Number`、`X-Platform`；
- 可选 `Idempotency-Key`，仅用于服务端声明支持幂等的 mutation；
- locale 与时区，只有接口确实需要时发送。

不要发送稳定硬件标识符。诊断 installationId 使用随机、可重置、受隐私策略约束的 ID。

### 1.2 超时、取消与重试

- connect/read/overall 采用统一策略并允许 endpoint 覆盖；禁止无限等待。
- 页面卸载、搜索条件变化、用户取消时传播 `AbortSignal`。
- 自动重试只适用于网络瞬断、明确可重试状态和幂等请求。
- `POST/PATCH/DELETE` 未提供幂等键时禁止透明重试。
- 使用指数退避 + jitter，并尊重 `Retry-After`；认证刷新不计入普通业务重试。
- 401 refresh 使用 single-flight：同一时刻只允许一次刷新，其余请求等待；刷新失败统一失效会话，不能刷新风暴。

### 1.3 错误归一化

业务层只处理统一 `AppError`：

```ts
type AppError = {
  kind:
    | 'network'
    | 'timeout'
    | 'cancelled'
    | 'unauthorized'
    | 'forbidden'
    | 'validation'
    | 'conflict'
    | 'rate_limited'
    | 'server'
    | 'incompatible_response'
    | 'unknown';
  code?: string;
  userMessageKey: string;
  retryable: boolean;
  requestId?: string;
  fieldErrors?: Record<string, string>;
  cause?: unknown;
};
```

服务端错误采用 `application/problem+json`（RFC 9457 语义），至少有 `type/title/status/code/requestId`，校验错误另含字段列表。客户端必须保留原始 cause 供脱敏诊断，但禁止直接展示服务端堆栈或任意 message。

### 1.4 响应校验

TypeScript 类型不等于运行时安全。启动配置、认证、升级策略、支付/资金、安全敏感响应必须做运行时 schema 校验；失败归为 `incompatible_response` 并上报契约版本，不能继续以半有效数据运行。

## 2. 异常与崩溃采集

### 2.1 四类信号

| 信号 | 示例 | 处理 |
| --- | --- | --- |
| native crash | iOS signal、Android fatal | 自动采集、符号化、按 release 聚合 |
| JS fatal | 未捕获异常、渲染错误 | 根 ErrorBoundary + feature boundary，保留恢复路径 |
| handled error | 请求、解析、业务不变量失败 | 按严重度采样，关联 requestId/traceId |
| performance | 冷启动、慢页面、慢请求、ANR | transaction/span + 版本和设备维度 |

根 ErrorBoundary 不能只显示白屏或自动重启循环。它提供安全重试、回到首页、复制诊断 ID；连续启动崩溃时进入 safe mode，跳过疑似热更新并回退到嵌入 bundle。

### 2.2 事件上下文

允许：release、distribution、runtimeVersion、build、OS、device class、locale、network class、route template、feature flags、匿名 session/install ID、requestId/traceId、有限 breadcrumb。

禁止：access/refresh token、密码、验证码、完整请求/响应体、输入框内容、精确定位、联系人、证件/银行卡、未脱敏 URL query。用户 ID 使用内部不可逆映射或明确授权的业务 ID。

所有遥测在发送前经过一个 scrubber；开发环境加入测试，证明敏感键会被删除。采样率、保留期和用户数据删除路径属于上线门禁。

### 2.3 符号与版本

- JS source map 与发布 artifact 一一对应并在上传后从公开产物隔离。
- iOS dSYM、Android mapping/native symbols 在构建流水线上自动上传。
- `release = appId@semver+build`，`dist = build`，`runtimeVersion` 单独记录。
- CI 未完成符号上传不得晋级生产；否则“采集到了”仍不可定位。

### 2.4 告警与处理

最低 SLO/告警：crash-free users/sessions、ANR、启动失败、登录成功率、API 错误率、热更新采用后回归。按 release 对比基线，灰度异常触发自动暂停而非等待人工看到评论。

## 3. 应用升级模型

升级有两条完全不同的通道：

### 3.1 热更新（JS/静态资源）

推荐以 `expo-updates` 协议实现，可使用托管服务或合规的自托管实现。必须具备：

- update manifest 签名与 HTTPS；
- channel（development/staging/production）严格隔离；
- `runtimeVersion` 与原生 ABI/资源兼容性绑定，优先采用 fingerprint 类策略；
- 分批比例、暂停、回滚到上一稳定更新；
- 下载校验、失败回退到 embedded bundle；
- 更新采用、启动成功和崩溃指标闭环。

允许热更：纯 TS/JS 业务、样式、文案、随包静态资源，以及不改变原生契约的修复。

禁止热更：新增/升级原生模块、权限/entitlement、Info.plist/Manifest、原生 SDK 配置、原生数据库不可逆迁移、应用图标/启动能力，以及应用商店规则不允许绕过审核的重大功能变化。

热更默认策略：后台静默下载，下一次冷启动应用；只有紧急且已验证的安全修复才提示立即重启。更新失败不得阻止进入嵌入版本。

### 3.2 全量更新（商店、直接分发、MDM）

全量版本不强绑定公开应用商店，统一支持 `store`、`direct`、`mdm` 三种分发通道。当前开发阶段发布管理只做已校验版本的全量激活，不实现 phased rollout。远端 bootstrap 返回结构化策略：

```json
{
  "policyVersion": 1,
  "minSupportedVersion": { "ios": "1.4.0", "android": "1.4.0" },
  "latestVersion": { "ios": "1.6.0", "android": "1.6.0" },
  "recommendation": "optional",
  "distribution": {
    "channel": "store",
    "actionUrl": "platform-specific-url",
    "releaseId": null,
    "sha256": null
  },
  "messageKey": "update.1_6_available",
  "graceEndsAt": null
}
```

客户端以 semver + platform + build + distribution channel 综合判断；服务端不能仅靠自由文本 `forceUpdate=true`。策略缓存必须签名且有有效期。

强制更新只用于：已确认的严重安全漏洞、服务端无法安全兼容的协议、法律合规阻断。强更页面必须提供对应渠道入口、重试检查、客服/诊断信息；目标渠道的新包尚不可安装前禁止提前提升最低版本。

#### Android 非商店直接更新

- 服务端发布不可变的签名 APK artifact，返回 HTTPS 下载地址、文件大小、SHA-256、签名证书指纹、最低系统版本和 release notes。
- App 可在用户确认后下载，支持断点恢复与网络类型提示；下载完成先校验 SHA-256，再交给系统 Package Installer。
- 新 APK 的 applicationId 与签名证书必须和已安装版本一致，versionCode 必须递增。签名密钥需要离线备份与轮换预案，丢失意味着无法覆盖升级。
- “允许安装未知来源应用”由系统按来源授权。App 只能解释并跳转系统设置，不得绕过系统确认、静默安装或反复诱导授权。
- 安装包通过短时签名 URL 或受控企业门户提供；CDN/对象存储不允许列目录。服务端记录发布事件，不采集无必要的设备硬件标识。
- 首期只交付完整 APK。差分包会增加 native patch、安全校验和回滚复杂度，待包体与流量数据证明必要后再立 ADR。

#### iOS 非公开商店更新

iOS 的安装边界由 Apple 签名与设备管理机制决定，不能把 Android 的直接 APK 模式照搬为公开 IPA 下载：

- 组织自有/受管设备：优先使用 MDM 分发，可由 MDM 执行版本指派；监督模式下是否静默安装取决于设备与策略能力。
- 企业内部分发：仅限符合 Apple 企业计划条款的本组织员工/内部用途，通过受控 HTTPS 门户与 manifest 安装；不得用于面向公众分发。
- Ad Hoc：只适合少量已登记 UDID 的测试设备，受设备数量和 provisioning profile 有效期限制，不作为正式用户更新方案。
- TestFlight、特定地区获准的替代市场等渠道按 Apple 当期规则单独建模，不能承诺全球通用。

App 在 `mdm/direct-enterprise` 策略下打开受控安装入口并展示版本指导，不能自行下载并静默替换 IPA。服务端必须按 tenant/group/platform 返回合法渠道，严禁把企业 IPA 链接下发给无资格的公共用户。

#### 多渠道一致性

- 同一业务版本可以有不同 platform 的 release；每条 `app_releases` 记录均有独立 build、签名、哈希和状态。
- 客户端上报自身 `distributionChannel`；服务端只返回该通道可达的升级路径，禁止让 direct 安装跳到商店中签名/标识不同的 App。
- direct/MDM 不是规避平台审核、隐私或代码执行规则的手段。组织应在上线前由法务/合规确认目标国家、用户身份和 Apple/Google 条款。

### 3.3 数据迁移与回滚

- 本地 schema migration 必须向前兼容上一稳定 bundle；热更新不能引入使 embedded bundle 无法读取的数据格式。
- 采用 expand -> migrate/read-both -> contract 的阶段式迁移。
- 发布记录绑定 API contract、native build、runtimeVersion、migration version、feature flags。
- 回滚演练至少覆盖：撤回 OTA、远程关闭 feature、恢复 embedded bundle、服务端兼容旧客户端。

## 4. 发布流水线

```text
PR gates
 -> staging native build / OTA
 -> automated smoke + contract + E2E
 -> human product/security sign-off where needed
-> production release once
-> full activation after verification
 -> observe SLO
 -> continue / pause / rollback
```

禁止为不同环境重新编译“同一个生产版本”导致 artifact 不同。构建产物、SBOM、签名、source maps、OpenAPI contract 和 release notes 需要可追溯。

## 5. 发布前检查表

- 版本与 runtime compatibility 是否正确；
- API 是否保持支持窗口内向后兼容；
- source maps/dSYM/mapping 是否上传并做过测试事件；
- 权限说明、隐私清单、SDK 数据收集声明是否更新；
- 热更/全量更新的停止指标与回滚责任人是否明确；
- staging 是否覆盖冷启动、升级安装、覆盖安装、登出、离线和深链；
- 目标分发渠道的新版本是否已实际可安装后再修改 min supported；
- Android direct artifact 的 hash、签名连续性、下载失败与未知来源授权路径是否验证；
- iOS MDM/企业渠道的设备资格、证书/profile 有效期和安装入口是否验证；
- 客服是否能通过诊断 ID 定位 release/request/trace。
