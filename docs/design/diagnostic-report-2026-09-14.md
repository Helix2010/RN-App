# 一键上报与异常日志采集

状态：实施中（分期见 §10）
日期：2026-09-14
修订：**3**
涉及：RN-App、RN-Server、RN-Admin 三个仓库
起因：关于 > 版本信息里那串 OTA update id「不知道是干啥的，管理端也找不到对应关系」。
原计划是把版本信息分组 + 加复制快捷方式，改为**去掉复制、做一键上报**。

## 修订记录

| 修订  | 评审意见                                                                                       | 改动                                                                                                                |
| ----- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 2     | 日志放对象存储，访问地址入库，管理端加查看；助记词要隔离不只是扫描                             | 日志载体改 NDJSON 文件 + 对象存储（§5.3）；元数据参数化单独入库（§5.1）；助记词从「出口扫描」改成**五层隔离**（§3） |
| **3** | **管理端就在现有管理端实现，不另起服务实例**；**不做保留期，无限期存**；**崩溃自动上报一起做** | 见下                                                                                                                |

### 修订 3 改了什么

| 项             | 修订 2                                   | 修订 3                                                                                                                                                    |
| -------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 部署形态       | 清理 worker 是一个新的后台循环           | **零新增进程、零新增服务实例**：清理没了，其余全是请求驱动，管理端页面挂在现有 RN-Admin 的 `release-management` 插件里，接口挂在现有 `/v1/admin` 路由组下 |
| 保留期         | 30 天过期 + 清理 worker + 桶生命周期规则 | **无限期保留**，不自动清理。改为管理端提供**手动删除**（§5.7）                                                                                            |
| 崩溃自动上报   | 二期                                     | **本期做**，五个前提条件同时落地（§4.6）                                                                                                                  |
| 上报类型       | `user` / `crash`                         | `user` / `crash`（用户确认）/ `crash_auto`（自动），三者配额分开计                                                                                        |
| bootstrap 契约 | 不变                                     | 新增 `features.crashAutoReport`（§4.6.1），缺键即 false，天然 fail-closed                                                                                 |

**修订 1 §10 曾写「不上传独立日志文件到对象存储，理由是要多一套签名 URL 与清理逻辑」——这条是错的。**
实际翻代码的结果：`internal/api/simplified_releases.go:148` 的 `receiveAndStoreArtifact(c, objectKey, contentType, expectedSize)`
是现成的代理上传助手（`MaxBytesReader` + 临时文件 + `Put` + `Head` 校验），branding 和 OTA 都在用；
`storageClientForTenant` 按租户取客户端；`objectstore.Client` 有 `Put/Get/Delete/List`。**那套东西早就建好了，我上一版没查就否掉了。**

---

## 0. 一页纸

| 编号    | 决策                                                                 | 一句话理由                                                       |
| ------- | -------------------------------------------------------------------- | ---------------------------------------------------------------- |
| D1      | 用户拿到一个 8 位**参考号**，不是一串可复制的文本                    | 复制出来的一大段没人看得懂也没人愿意粘；客服只需要一个能查的号   |
| D2      | 身份一律由服务端解析，请求体里**不接受**任何身份字段                 | 客户端声明的 user/tenant 等于让任何人冒名上报                    |
| D3      | 复用已有的**安装实例凭证**做认证，不新造一套                         | 凭证已有 90 天轮换、已有撤销、管理端已有撤销按钮                 |
| D4      | 手动上报的日志留在设备**环形缓冲**里，按下才离开设备                 | 默默上传日志是另一回事                                           |
| D5      | 手动上报前把**将要发送的全文摊开给用户看**                           | 这是知情同意，也保住了「复制」原本唯一的好处                     |
| D6      | **日志以 NDJSON 文件传到对象存储，DB 只存 object key**               | 元数据表保持苗条；日志按需读                                     |
| D7      | **服务端不存客户端原始字节——逐行解析、校验、脱敏后重新序列化再落盘** | 落进桶里的是**我们自己生成**的文件，一次性关掉一整类问题（§5.3） |
| D8      | **入库的是 object key，不是访问 URL**；访问一律经管理端接口代理      | 预签名 URL 是字符串形态的持有型凭证，入库即长期泄漏面            |
| D9      | **不接受任何客户端压缩**，明文 NDJSON 上传，服务端自己 gzip 后落盘   | 收压缩流就等于开一个解压炸弹口子（T11）                          |
| D10     | 助记词/私钥做**五层隔离**，出口扫描只是最后一道网                    | 扫描是兜底不是防线（§3）                                         |
| **D11** | **崩溃自动上报本期就做**，且五个前提条件缺一不可                     | 见 §4.6；少任何一条都会变成自伤                                  |
| **D12** | **崩溃不在崩溃现场上传，在下次启动、确认健康之后才传**               | 崩溃现场发网络请求本来就不可靠，而且那正是崩溃循环放大的地方     |
| D13     | 复用已有但**零调用**的 `features.diagnosticsEnabled` 作总闸          | 这个字段在 schema 和 fallback 里躺着没人用，正好是它该干的事     |
| **D14** | **不设保留期，无限期保留**；管理端提供手动删除                       | 评审决定。后果与补偿见 §5.7                                      |
| D15     | 对象存储没配时**照样写元数据行**，只是没有日志                       | 版本/设备/账号/描述才是客服最常用的部分，不该被存储故障连坐      |
| **D16** | **零新增进程、零新增服务实例**                                       | 评审要求；清理 worker 去掉后，全部逻辑都是请求驱动的             |

---

## 1. 现在有什么（不用重造的部分）

| 已有的东西                                                                 | 在哪                                         | 这次怎么用                                            |
| -------------------------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------- |
| 代理上传助手 `receiveAndStoreArtifact`                                     | RN-Server `simplified_releases.go:148`       | 照它的形状写诊断日志版（要改写内容，见 D7）           |
| 按租户取对象存储客户端 `storageClientForTenant`                            | `release_storage.go:221`                     | 直接用                                                |
| `objectstore.Client`：`Put/Get/Delete/List/Head`                           | `internal/objectstore/s3.go:44`              | 上传、查看、手动删除                                  |
| 服务端代理读对象并回流的写法                                               | `branding.go:515` `brandingAsset`            | 管理端查看日志照抄                                    |
| 对象键的租户前缀校验 `hasTenantObjectPrefix`                               | `branding.go:532`                            | 防跨租户读（T12）                                     |
| 安装实例凭证 `Authorization: Installation <cred>`                          | `installations.go:339`                       | 上报接口的认证                                        |
| 凭证撤销 / 过期 / 轮换 + 管理端撤销按钮                                    | 同上，90 天 TTL                              | 撤销安装实例即刻停掉它的上报能力                      |
| 设备归并 `device_clients` + `app_installations`                            | migrations v14 起                            | 报告挂到安装实例，设备信息不重传                      |
| 账号↔设备关联 `wallet_session.installation_id`、`wallet_user_installation` | migrations v33 / v36                         | 服务端反查当前登录账号                                |
| 秘密扫描 `redactSecrets()`                                                 | RN-App `core/security/secret-scan.ts`        | 最后一道网（§3.5）                                    |
| 密钥材料的 eslint 禁令                                                     | RN-App `eslint.config.mjs:36`                | 扩到 `logEvent`（§3.3）                               |
| 根错误边界（已在拼诊断文本并脱敏）                                         | RN-App `app/root-error-boundary.tsx`         | 「复制诊断信息」改「上报」，并落崩溃快照              |
| `features` 开关的服务端取值 `truth(features[...])`                         | `server.go:1754`                             | 新增 `crashAutoReport` **缺键即 false**，不破坏旧数据 |
| 管理端「功能开关」区（遍历 `Object.keys(config.features)` 自动渲染）       | RN-Admin `app-config/pages.tsx:144`          | 加一个标签 + 一段说明即可                             |
| 安装实例详情面板                                                           | RN-Admin `installation-detail-panel.tsx`     | 加「该设备的上报」                                    |
| 审计事件 `audit_events`                                                    | RN-Server                                    | 管理端改状态 / 删除时落审计                           |
| `features.diagnosticsEnabled`                                              | RN-App `bootstrap.schema.ts:237`，**零调用** | 本功能的远程总闸                                      |

真正新增的：客户端日志缓冲与崩溃快照、一张元数据表、一组接口、一个管理端页面。**没有新的进程。**

---

## 2. 威胁模型

| 编号    | 威胁                                       | 后果                                                 | 对策                                                                                            |
| ------- | ------------------------------------------ | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| T1      | **助记词 / 私钥 / 配对 URI 进入日志**      | 我们亲手把用户资产密钥收进自己的库。比被刷爆严重得多 | §3 五层隔离                                                                                     |
| T2      | 匿名灌垃圾撑爆存储                         | 磁盘与成本                                           | D3 凭证 + §5.5 硬上限（含按租户字节预算）                                                       |
| T3      | 自助注册刷凭证绕过按设备限流               | 同 T2                                                | 叠加按 IP 限流；只接受**心跳成功过至少一次**的活跃实例                                          |
| T4      | 冒名上报（把脏内容挂到别人账号上）         | 误伤封号、污染排查                                   | D2 身份全部服务端解析                                                                           |
| T5      | 日志正文在管理端被当 HTML 渲染             | 存储型 XSS，打到管理员会话                           | §6.3：纯文本渲染 + `nosniff` + `Content-Disposition: attachment`                                |
| T6      | 单条超大 / 超多条目                        | 内存与解析放大                                       | `MaxBytesReader` + 行数/行长上限，超限截断                                                      |
| T7      | 重放同一份报告刷量                         | 同 T2                                                | `reportId` 幂等键，`UNIQUE(tenant, installation, report_id)`                                    |
| T8      | 接口成为探测预言机                         | 枚举安装实例                                         | 沿用现有做法：两种失败同一个 401 文案                                                           |
| T9      | **无限期保留放大一切泄漏**                 | 库/桶被拖走时暴露的是全部历史，不是 30 天            | D14 是评审决定；补偿见 §5.7（脱敏是硬要求而非缓解措施、管理端手动删除、字节预算成为唯一存储闸） |
| T10     | **崩溃自动上报在崩溃循环里变成上传风暴**   | 自伤 DDoS                                            | D12 不在现场传 + §4.6 五条前提（指纹去重 / 每日上限 / 崩溃循环熔断 / 远程开关 / 用户开关）      |
| T11     | 解压炸弹（10 KB gzip → 10 GB）             | 服务端内存/磁盘打满                                  | D9 根本不收压缩流；服务端自己压缩，输入有界                                                     |
| T12     | 跨租户读别人的日志对象                     | 数据越权                                             | 对象键带租户前缀 + `hasTenantObjectPrefix` 校验 + 接口按 `tenant_id` 过滤行                     |
| T13     | 预签名 URL 泄漏（入库、贴进工单、进日志）  | 无需认证即可读日志                                   | D8 不入库 URL；管理端代理读取，不下发预签名                                                     |
| T14     | 客户端上传伪装成日志的任意二进制/HTML      | 内容类型混淆、后续渲染被利用                         | D7 服务端重新序列化，非法行丢弃并计数                                                           |
| T15     | 元数据行写成功但日志上传失败，报告变半成品 | 客服看到空报告                                       | §5.4 两阶段状态机，状态显式                                                                     |
| **T16** | **崩溃快照在设备上长期驻留**               | 设备被取走时磁盘上有一份未脱敏内容                   | 快照写入前过脱敏；上传成功即删；只留一条；≤64 KB                                                |

---

## 3. 助记词隔离（本方案的前置条件）

> 「app 助记词 需要隔离脱敏 不应该打到日志中吧」

对。修订 1 靠的是「出口扫描 + 约定不要写」，这不够——**约定挡不住意外，扫描是事后**。
做成五层，前四层都是**结构性**的，扫描降为最后一道网。

**无限期保留（D14）让这一节更重要，不是更不重要**：泄漏一旦发生，没有"过 30 天自己消失"这个兜底了。

### 3.1 第一层：模块边界（lint 强制）

`core/diagnostics/**` **禁止导入** `core/wallet/vault/**`、`core/wallet/keygen/**`。
在 `eslint.config.mjs` 加一条 `no-restricted-imports`（该文件已有两组同类规则，`:52` 和 `:78`）。

日志模块在结构上就够不到密钥材料——这一层不依赖任何人记得住什么。

### 3.2 第二层：抛出点就干净

密钥材料泄漏最现实的路径不是有人写 `log(phrase)`，是这个：

```ts
// 导入失败时把输入拼进 message —— 助记词就这样进了 error.message，
// 再被错误边界拼进崩溃快照
throw new Error("invalid mnemonic: " + input);
```

**实施时核查的结果**：`core/wallet/keygen` 与 `core/wallet/vault` 里所有抛出点
**都没有**把运行时值拼进消息。唯一一处模板字符串是 `passphrase.ts:63` 的
`${MIN_PASSPHRASE_LENGTH}`——插的是下限常量，不是口令。

所以修订 3 原计划的「引入只收错误码的 `WalletError`」**不做**：vault 里已经有
`WalletVaultError` / `WalletPassphraseError` / `WrapKeyEnvelopeError` 三个错误类，
再叠一个而现状并无缺陷，是纯粹的改动面。

真正落地的是**防回退的 lint 闸**（`eslint.config.mjs`）：这两个目录里，
`throw new X(...)` 的消息里出现小写标识符、成员访问或函数调用即报错；
全大写标识符放行（这个代码库里编译期常量一律这样命名）。

> 实施时踩到的一个坑，记下来免得再犯：flat config 里同名规则是**整体覆盖不是合并**。
> 给这两个目录单独设 `no-restricted-syntax` 的第一版，把全局的 `console` 密钥禁令从
> vault / keygen 里顶掉了——`console.log(phrase)` 在 `vault/` 能过，在 `src/core/` 反而报错。
> 修法是把全局选择器提成 `restrictedSyntax` 常量，每个另设该规则的块都展开进去。

### 3.3 第三层：日志入口的签名不接受任意值

```ts
export function logEvent(
  level: LogLevel,
  tag: LogTag, // 联合类型，不是 string
  message: string, // 只能是字面量或已知安全拼接
  fields?: Record<string, string | number | boolean>,
): void;
```

不收 `unknown`、不收对象、不收 `Error`。想记错误就 `logEvent("error", "wallet", e.code)`。
配套 lint 挡住把 `JSON.stringify(...)` / `String(err)` 传进 `message`，
并把现有 `eslint.config.mjs:36` 那条密钥标识符禁令的作用域从 `console.*` 扩到 `logEvent`。

### 3.4 第四层（独立一轮）：不可字符串化的 `Secret` 封装

```ts
class Secret {
  readonly #value: string;
  toString() {
    return "[secret]";
  }
  toJSON() {
    return "[secret]";
  }
  expose(): string {
    return this.#value;
  } // 唯一取值口，调用点可审计
}
```

`generateMnemonic()`、vault 解密都返回 `Secret` 而不是 `string`。
这样模板字符串插值、`JSON.stringify`、`String()`、`console.log` 拿到的全是 `[secret]`——
**意外泄漏在语言层面就不成立**，只剩下显式的 `.expose()`。

**这一层放到独立的一轮做，不塞进本功能。** 它要改 vault / keygen / 备份页 / 导入页 / 口令页
约 8 个文件，是钱包安全关键路径的重构，混进诊断功能里评审不清楚。
它的收益也超出日志范围（同时防住剪贴板、崩溃快照、未来任何分析接入）。

前三层已经足以保证「日志里没有助记词」；第四层是把保证从「日志」扩大到「所有出口」。

### 3.5 第五层：出口扫描，且**命中即缺陷**

客户端 `redactSecrets()`（现有）+ 服务端同规则的 Go 版（新增），两遍。

关键是**态度**：命中不是「成功挡住」，是**前四层漏了的证据**。

- 开发/预发构建：`redactSecrets` 命中 → 直接抛出并让端到端测试失败，不是静默遮蔽；
- 生产：遮蔽并把命中数写进 `redaction_hits`，管理端标红；
- 端到端验证：预发构建用现有 canary 机制种一个测试助记词，跑完整上报，
  断言服务端落盘的是 `[redacted:secret]`。

两端规则对齐用共享 JSON 向量 `contracts/secret-redaction.v1.json`（沿用 `module-tabs.v1.json` 那套），两边各跑契约测试。

---

## 4. 客户端（RN-App）

### 4.1 环形缓冲 `src/core/diagnostics/log-buffer.ts`

```ts
export type LogLevel = "info" | "warn" | "error";
export type LogTag = "net" | "config" | "ota" | "wallet" | "nav" | "crash";
export type LogEntry = {
  at: number;
  level: LogLevel;
  tag: LogTag;
  message: string;
  fields?: Record<string, string | number | boolean>;
};

export function logEvent(level, tag, message, fields?): void; // 唯一写入口
export function snapshotLogs(): LogEntry[];
export function clearLogs(): void;
```

- 容量 **500 条**，满了丢最旧；单条 message 截 **512 字符**，`fields` 最多 8 键、每值截 128 字符；
- `logEvent` 内部无条件跑 `redactSecrets`（§3.5）；
- 纯内存，不落盘（唯一例外是 §4.5 的崩溃快照）；
- 任何异常一律吞掉——诊断设施不能成为崩溃来源（照 `update-telemetry.ts`）。

### 4.2 谁来写

| 来源                                  | tag      | 记什么                                                      |
| ------------------------------------- | -------- | ----------------------------------------------------------- |
| `api-client` 请求失败                 | `net`    | method、**路径模板**（不含 query）、状态码、requestId、耗时 |
| bootstrap 拉取/验签失败               | `config` | 失败阶段、configVersion、是否回落快照                       |
| OTA 各阶段（已有 `update-telemetry`） | `ota`    | stage、updateId、runtimeVersion、channel                    |
| 钱包操作失败                          | `wallet` | 操作名、**错误码**、链 ID。不记地址/金额/交易内容           |
| 页面切换                              | `nav`    | 路由名（给复现路径用）                                      |
| 根错误边界 / 全局未捕获异常           | `crash`  | `error.name`、`error.message`、componentStack               |

### 4.3 日志文件格式

NDJSON，一行一个 `LogEntry`，UTF-8，无 BOM：

```
{"at":1757836800000,"level":"error","tag":"net","message":"request failed","fields":{"method":"GET","path":"/v1/mobile/bootstrap","status":503,"requestId":"abc123","ms":4210}}
{"at":1757836801100,"level":"warn","tag":"ota","message":"check failed","fields":{"stage":"checking"}}
```

选 NDJSON 不选纯文本：管理端能按级别/模块筛选、能分页，而且服务端逐行校验时一行坏掉只丢一行（T14）。

**不压缩**（D9）：500 条约 80–150 KB，可接受；收压缩流等于开解压炸弹口子。
服务端落盘前自己 gzip——那时输入已经有界。

### 4.4 手动上报 `src/core/diagnostics/report-service.ts`

```
submitReport({ kind, note }) →
  0. features.diagnosticsEnabled === false → 返回 disabled（按钮也不显示）
  1. 本地生成 reportId（uuid）
  2. ensureInstallationAuthorization()（已有）
  3. POST /v1/mobile/diagnostics/reports          ← 元数据，拿到 reference
  4. PUT  /v1/mobile/diagnostics/reports/{id}/log ← NDJSON 正文
  5. 返回 reference；第 4 步失败也返回 reference（报告已成立，只是没日志）
```

本地节流：同一进程内两次手动上报间隔 ≥ 60 秒。

### 4.5 崩溃快照（跨重启）

根错误边界不杀进程，但原生崩溃和 JS fatal 会。
AsyncStorage 保留**一个**槽位 `foundation.diagnostics.pending-crash.v1`：

```ts
type CrashSnapshot = {
  at: number;
  fingerprint: string;        // sha256(error.name + 顶层栈帧)，前 16 hex
  errorName: string;
  errorMessage: string;       // 已脱敏
  componentStack: string;     // 已脱敏、截断
  tail: LogEntry[];           // 崩溃时环形缓冲的最后 100 条，已脱敏
  app: {...};                 // 版本三元组等元数据
};
```

**必须带 `tail`**：环形缓冲是内存里的，进程一死就没了；崩溃前那 100 条恰恰是最有价值的部分。
整个快照上限 64 KB，超了先裁 `tail`。只留一条，新的覆盖旧的。

写入时机与可靠性：

- 根错误边界的 `componentDidCatch`：App 还活着，写入可靠；
- `ErrorUtils.setGlobalHandler` 的致命错误：**尽力而为**，AsyncStorage 是异步的，
  进程可能在写完前就没了。这是已知限制，不假装能解决。

安全（T16）：写入前过脱敏；**上传成功立即删除**；只留一条；≤64 KB。

### 4.6 崩溃自动上报（D11 / D12）

**上报发生在下次启动，不在崩溃现场。** 崩溃现场发网络请求本来就不可靠（进程正在死），
而且那正是崩溃循环把一次崩溃放大成一串上传的地方。

启动时序：

```
启动
 ├─ 写一条启动记录到 foundation.diagnostics.launches.v1（保留最近 3 条，healthy=false）
 ├─ …正常启动流程…
 ├─ bootstrap 成功 + 启动满 10 秒
 │    └─ 尝试处理 pending-crash（见下面五道闸）
 └─ 启动满 60 秒 → 把本次启动记录标成 healthy=true
```

五道闸，**全过才自动上传**（缺任何一条都会变成自伤）：

| #   | 闸               | 实现                                                                                         | 失败时             |
| --- | ---------------- | -------------------------------------------------------------------------------------------- | ------------------ |
| 1   | 远程开关         | `features.crashAutoReport === true`                                                          | 转人工提示         |
| 2   | 用户开关         | 设置页「自动上报崩溃」，本地偏好，默认跟随远程                                               | 转人工提示         |
| 3   | 指纹去重         | `foundation.diagnostics.sent-fingerprints.v1`（最多 20 条），同指纹 24 小时内只发一次        | 直接丢弃快照       |
| 4   | 每日上限         | `{day, count}`，每台设备每天最多 **3** 条 `crash_auto`，与手动配额分开计                     | 丢弃快照           |
| 5   | **崩溃循环熔断** | 最近 3 条启动记录**全部** `healthy=false` → 判定崩溃循环，停止自动上报，直到用户手动上报一次 | 丢弃快照并记录状态 |

任一闸没过而快照仍在时，走**人工路径**：设置页显示一条「上次异常退出，是否上报」——不自动发。

自动上报走的是与手动完全相同的两步接口，只是 `kind="crash_auto"`、没有 `note`、
日志正文取自快照的 `tail` 而不是当前环形缓冲。

#### 4.6.1 bootstrap 契约变化

`features` 新增 `crashAutoReport: boolean`：

- **RN-App** `bootstrap.schema.ts` 的 `features` 加这一项（必填）；
- **RN-Server** `server.go:1754` 的 `features` gin.H 加 `"crashAutoReport": truth(features["crashAutoReport"])`。
  `truth()` 对缺键返回 `false`，所以**旧数据不会让整份配置失效，而且默认是关的**——
  fail-closed，正好是自动外发功能该有的默认；
- `initialConfig`（`server.go:2025`）加 `"crashAutoReport":false`；
- **迁移 v46 顺带**把 `"crashAutoReport": false` 补进所有已存在的 `mobile-bootstrap` 行
  （照 `consistentDefaultConfigMigration` v44 的形状）。这一步不是为了契约正确
  （契约已经靠 `truth()` 正确了），是为了**管理端能看见这个开关**——那一区是遍历
  `Object.keys(config.features)` 渲染的，键不在就不显示；
- **RN-Admin** `app-config/pages.tsx:144` 的 `featureLabels` 加「崩溃自动上报」，
  以及 `:613` 那个说明表加一段文案（写清楚它会在用户不操作的情况下上传日志）。

部署顺序：**服务端先上**，App 后上。反过来会让新 App 因为缺字段判整份配置无效。

---

## 5. 服务端（RN-Server）

### 5.1 第一步：元数据（参数形式入库）

```
POST /v1/mobile/diagnostics/reports
Headers: Authorization: Installation <cred>
         X-Installation-ID / X-Application-Id / X-Platform
Body（全部是元数据，没有日志正文）:
{
  "reportId": "<uuid，客户端生成，幂等键>",
  "kind": "user" | "crash" | "crash_auto",
  "note": "用户描述，可空，≤200 字（crash_auto 恒为空）",
  "occurredAt": "2026-09-14T08:00:00.000Z",
  "crash": { "fingerprint": "…", "errorName": "TypeError" },   // 仅 crash / crash_auto
  "app": { version, buildNumber, runtimeVersion, otaChannel, distributionChannel,
           launchSource, runningUpdateId, otaRevision, locale, theme,
           osVersion, deviceClass },
  "context": { screen, lastRequestId, networkType },
  "log": { "entryCount": 412, "byteSize": 98304 }
}
```

```
201 {
  "reportId": "...",
  "reference": "R7KQ3M2X",
  "logUpload": { "required": true, "maxBytes": 524288, "expiresAt": "..." }
}
```

- 身份全部服务端解析（§5.2），请求体里**没有**任何身份字段；
- 幂等：同一 `(tenant, installation, reportId)` 重复 POST 返回同一个 `reference`，不新建行；
- 对象存储没配时照样 201，但 `logUpload.required=false`，行的 `log_status='storage_unavailable'`（D15）。

### 5.2 服务端解析的身份

```
tenant        ← domainTenantScope（按 Host）
installation  ← 凭证校验通过的那条 app_installations
device_client ← 该安装实例的 device_client_id
wallet_user   ← SELECT user_id FROM wallet_session
                WHERE tenant_id=? AND installation_id=? AND revoked_at IS NULL
                  AND expires_at > NOW() ORDER BY last_seen_at DESC LIMIT 1
                再 join wallet_user 取 address / status
running_ota_revision ← 由 runningUpdateId 关联本租户 ota_releases.update_id
                       （照抄 installations.go:305）
```

没有有效会话就是 `NULL`——未登录也允许上报，这恰恰是常见场景（登录不上才要上报）。

`running_ota_revision` 在**写入时**就关联好，所以管理端列表直接显示 `rev 12` 而不是 UUID。
**这正是最初那个问题的解。**

### 5.3 第二步：日志正文（D7 的落点）

```
PUT /v1/mobile/diagnostics/reports/{reportId}/log
Headers: Authorization: Installation <cred>
         Content-Type: application/x-ndjson
Body: 明文 NDJSON
```

服务端处理链路，**每一步都不信任输入**：

1. 按 `reportId` + 凭证解析出的 installation 查行；行不存在 / 已有日志 / 已过期 → 409；
2. `http.MaxBytesReader(w, body, 512*1024)`——超了 413；
3. **逐行**读（`bufio.Scanner`，单行上限 8 KB，超长行丢弃并计数）；
4. 每行 `json.Unmarshal` 到一个**严格的 Go 结构体**：多余字段丢弃，`level`/`tag` 不在枚举内则整行丢弃；
5. `message` 与每个 `fields` 值过服务端 `redactSecrets`，命中计入 `redaction_hits`；
6. `message` 截 512、`fields` 限 8 键 / 128 字符、总行数限 2000；
7. **重新序列化**成规范 NDJSON，gzip 写进临时文件；
8. `client.Put(ctx, key, tmp, size, "application/x-ndjson")`，`Head` 校验；
9. 更新行：`object_key`、`entry_count`、`byte_size`、`dropped_lines`、`redaction_hits`、`log_status='stored'`。

> 第 4 和第 7 步是 D7 的全部意义：**落进桶里的字节是服务端生成的**，不是客户端给的。
> 由此直接消掉：内容类型混淆、polyglot 文件、超长行、未知字段夹带、以及「管理端拿到一个
> 其实是 HTML 的 .ndjson」（T14）。代价只是一次解析+重排，输入本来就 ≤ 512 KB。

**对象键**（带租户前缀防越权 T12；带日期分区便于按前缀批量操作）：

```
<storagePrefix>/tenants/<tenantId>/diagnostics/<YYYY>/<MM>/<DD>/<reference>.ndjson.gz
```

### 5.4 两阶段状态机（T15）

```
log_status: awaiting → stored              正常
                    → missing              超过 30 分钟没等到 PUT（下次读列表时惰性判定）
                    → storage_unavailable  租户没配对象存储（D15）
                    → failed               PUT 来了但落盘失败
```

`missing` 没有清理 worker 去标记了（D16 零新增进程），改为**读时惰性判定**：
管理端列表把 `log_status='awaiting' AND created_at < NOW() - INTERVAL 30 MINUTE` 显示成「未上传」。
这不需要写库，纯展示层判断。

**报告在第一步就已经成立**——参考号、版本、设备、账号、用户描述都在，
已经覆盖了客服最常用的部分；日志是增强项，不是前提。

### 5.5 上限

| 维度                           | 限制                                                   | 超限行为                                |
| ------------------------------ | ------------------------------------------------------ | --------------------------------------- |
| 元数据请求体                   | 8 KB                                                   | 413                                     |
| 日志请求体                     | **512 KB**（`MaxBytesReader`）                         | 413                                     |
| 单行                           | 8 KB                                                   | 丢该行，计入 `dropped_lines`            |
| 行数                           | 2000                                                   | 截断                                    |
| note                           | 200 字符                                               | 截断                                    |
| 压缩流                         | **不接受** `Content-Encoding`                          | 415                                     |
| 每安装实例（`user` + `crash`） | 5 次/小时、20 次/天                                    | 429 `DIAGNOSTIC_QUOTA_EXCEEDED`         |
| 每安装实例（`crash_auto`）     | **3 次/天，单独计**                                    | 429（客户端本来也有闸，这是服务端兜底） |
| 每 IP                          | 20 次/小时                                             | 429                                     |
| 每租户                         | 2000 次/天 **且 200 MB/天**                            | 429，管理端顶部提示「上报量异常」       |
| 实例状态                       | `status='active'` 且 `credential_revoked_at IS NULL`   | 401                                     |
| 实例活跃度                     | 至少心跳成功过一次（`last_active_at > first_seen_at`） | 403 `DIAGNOSTIC_NOT_ELIGIBLE`           |
| 总闸                           | 租户 `features.diagnosticsEnabled=false`               | 404，当作接口不存在                     |

`crash_auto` **必须单独计配额**：它不需要用户操作，一旦客户端的五道闸有 bug，
它会是唯一一个能持续产生流量的类型。服务端这一道是兜底。

**按租户的字节预算（200 MB/天）在 D14 之后成了唯一的存储闸**——没有过期清理了，
存量只增不减。按这个上限，一个租户被打满是 73 GB/年；正常量级（日均几十条 × 30 KB）
是 0.5 GB/年。预算是滥用天花板，不是预期值。

按实例/租户计数走索引 `COUNT(*)` / `SUM(byte_size) WHERE created_at > ?`；
按 IP 沿用 `server.go:564` 那个内存计数器的形状，另起一个 map。

### 5.6 存储：迁移 v46

```sql
CREATE TABLE IF NOT EXISTS app_diagnostic_reports (
  id            BIGINT UNSIGNED AUTO_INCREMENT,
  tenant_id     BIGINT UNSIGNED NOT NULL,
  reference     CHAR(8)      NOT NULL COMMENT '给用户念的参考号，Crockford base32，去掉易混字符',
  report_id     VARCHAR(80)  NOT NULL COMMENT '客户端幂等键',
  installation_id VARCHAR(80) NOT NULL,
  device_client_id BIGINT UNSIGNED NULL,
  wallet_user_id   BIGINT UNSIGNED NULL COMMENT '服务端由会话解析，非客户端声明',
  wallet_address   VARCHAR(42) NULL COMMENT '解析时的快照，列表直接展示',
  kind          ENUM('user','crash','crash_auto') NOT NULL,
  note          VARCHAR(200) NULL,
  crash_fingerprint VARCHAR(32) NULL COMMENT 'error.name + 顶层栈帧的哈希，用于按崩溃聚合',
  crash_error_name  VARCHAR(80) NULL,
  platform      ENUM('android','ios') NOT NULL,
  app_version   VARCHAR(40)  NOT NULL,
  build_number  VARCHAR(40)  NOT NULL,
  runtime_version VARCHAR(160) NOT NULL,
  distribution_channel VARCHAR(40) NOT NULL,
  ota_channel   VARCHAR(40)  NOT NULL,
  launch_source ENUM('embedded','ota') NULL,
  running_update_id CHAR(36) NULL,
  running_ota_revision INT UNSIGNED NULL COMMENT '写入时由 running_update_id 关联 ota_releases 得到',
  locale        VARCHAR(40)  NULL,
  os_version    VARCHAR(40)  NULL,
  device_class  VARCHAR(80)  NULL,
  context       JSON         NULL COMMENT '屏幕、最后一个 requestId、网络类型',
  -- 日志正文在对象存储里，这里只留指针与统计
  object_key    VARCHAR(512) NULL COMMENT '对象存储键；不存访问 URL（D8）',
  log_status    ENUM('awaiting','stored','storage_unavailable','failed')
                NOT NULL DEFAULT 'awaiting',
  entry_count   SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  byte_size     INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'gzip 后的落盘大小，计入租户字节预算',
  dropped_lines SMALLINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '解析失败或超长被丢弃的行数',
  redaction_hits SMALLINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '服务端二次脱敏命中数；>0 即客户端那遍没拦住',
  status        ENUM('new','triaged','closed') NOT NULL DEFAULT 'new',
  occurred_at   DATETIME(3) NOT NULL,
  created_at    DATETIME(3) NOT NULL,
  PRIMARY KEY(id),
  UNIQUE KEY uq_diag_reference(tenant_id, reference),
  UNIQUE KEY uq_diag_idempotent(tenant_id, installation_id, report_id),
  KEY ix_diag_list(tenant_id, created_at),
  KEY ix_diag_installation(tenant_id, installation_id, created_at),
  KEY ix_diag_user(tenant_id, wallet_user_id, created_at),
  KEY ix_diag_fingerprint(tenant_id, crash_fingerprint, created_at),
  KEY ix_diag_budget(tenant_id, created_at, byte_size)
) ENGINE=InnoDB COMMENT='App 诊断上报元数据；日志正文在对象存储';
```

没有 `expires_at`（D14）。以后想加保留期是一次 `ADD COLUMN` + 一个 worker，表结构不用重做；
`ix_diag_list(tenant_id, created_at)` 已经能支撑按时间批量清理。

同一个迁移里顺带做 §4.6.1 的 `features.crashAutoReport` 回填。

### 5.7 不做自动清理（D14）的后果与补偿

**后果要说清楚**：

1. 存量只增不减，`byte_size` 预算成为唯一的存储闸（§5.5）；
2. 库或桶一旦泄漏，暴露的是**全部历史**而不是最近 30 天（T9）。
   这直接抬高了 §3 的重要性——脱敏从「缓解措施」变成「硬要求」；
3. 用户"删除我的数据"这类请求没有自动路径，只能人工删。

**补偿**：管理端提供手动删除，这是无限期保留下的必要配套，不是可选项——

```
DELETE /v1/admin/diagnostics/reports/:id          单条：先 client.Delete(object_key) 再删行
POST   /v1/admin/diagnostics/reports/bulk-delete  按筛选条件批量（需二次确认 + 落审计）
```

两者都写 `audit_events`。特别是 `redaction_hits > 0` 的报告——那意味着服务端二次脱敏命中过，
管理员看到红角标后应该有一个立刻删掉它的按钮。

### 5.8 管理端接口（挂在现有 `/v1/admin` 路由组下，无新服务）

```
GET    /v1/admin/diagnostics/reports              列表：kind/status/log_status/版本/日期/关键字/指纹
GET    /v1/admin/diagnostics/reports/:id          详情（元数据）
GET    /v1/admin/diagnostics/reports/:id/log      日志条目，分页 offset/limit，可按 level/tag 筛
GET    /v1/admin/diagnostics/reports/:id/log/raw  下载原文件（见 §6.3 的响应头要求）
POST   /v1/admin/diagnostics/reports/:id/status   { status, note } → 落 audit_events
DELETE /v1/admin/diagnostics/reports/:id          删除（§5.7）
POST   /v1/admin/diagnostics/reports/bulk-delete  批量删除（§5.7）
GET    /v1/admin/installations/:id/diagnostics    某设备的上报（给详情面板）
```

`/log` 与 `/log/raw` 都走**管理端会话鉴权 + 按 `tenant_id` 查行 + `hasTenantObjectPrefix` 校验**
再 `client.Get` 回流（照 `branding.go:515`）。**不下发预签名 URL**（D8 / T13）。

---

## 6. 管理端（RN-Admin，在现有应用内）

### 6.1 落点

现有 `release-management` 插件 navigation 加第三项
`{ id: "diagnostics", label: "诊断上报", icon: "life-buoy" }`
（现有两项：「发布中心」「运营数据」）。**不新建插件、不新建应用、不新建服务。**

另外在 `app-config` 模块的「功能开关」区加上 `crashAutoReport` 的标签与说明（§4.6.1）。

### 6.2 列表

| 列     | 说明                                                                          |
| ------ | ----------------------------------------------------------------------------- |
| 参考号 | `R7KQ3M2X`，**可直接搜索**——客服拿到用户念的号，粘进来即命中                  |
| 时间   | 上报时间                                                                      |
| 类型   | 用户主动 / 崩溃（用户确认）/ **崩溃（自动）**                                 |
| 崩溃   | `TypeError · a1b2c3d4`，点指纹可筛出同一崩溃的全部报告                        |
| 账号   | 地址缩写，点进钱包用户详情；未登录显示「未登录」                              |
| 设备   | 安装实例缩写，点进已有的安装实例详情面板                                      |
| 版本   | `1.2.3 (45)` + `rev 12` / `内置`                                              |
| 日志   | `412 条` / `等待中` / `未上传` / `存储未配置` / `上传失败`                    |
| 状态   | 新 / 已处理 / 已关闭                                                          |
| 标记   | `redaction_hits > 0` 红角标「服务端二次脱敏命中」；`dropped_lines > 0` 灰角标 |

筛选：类型、状态、日志状态、版本、日期区间、**崩溃指纹**、关键字（参考号 / 地址 / installationId）。

按指纹聚合是崩溃自动上报带来的主要价值：同一个崩溃会有很多台设备报上来，
需要看的是「这个崩溃影响了多少设备、集中在哪个版本」，不是一条条翻。

### 6.3 日志查看器（T5 的落点）

右侧抽屉，上半元数据表，下半日志查看器：

- 服务端分页返回**已解析的条目数组**，前端按 `at / level / tag / message / fields` 分列渲染；
- **一律纯文本**：禁止 `dangerouslySetInnerHTML`；关键字高亮用文本节点切分实现，不拼 HTML；
- 不做链接自动识别（一条日志里的 `http://…` 不该是可点的）；
- 按级别、模块筛选，按关键字过滤，默认每页 200 条；
- 单条 message 前端再截一次 512（服务端已截，这是第二道）。

**下载原文件的响应头**（三个都不能少）：

```
Content-Type: text/plain; charset=utf-8      ← 不用 application/x-ndjson，避免浏览器猜
Content-Disposition: attachment; filename="R7KQ3M2X.ndjson"
X-Content-Type-Options: nosniff              ← 否则旧内核可能当 HTML 渲染 → XSS
```

操作：标记已处理 / 关闭、**删除**（§5.7）、跳转安装实例详情、跳转钱包用户详情。全部落 `audit_events`。

### 6.4 反向入口

已有的 `installation-detail-panel.tsx` 加一段「该设备的上报」，列最近 5 条，点击跳详情。

---

## 7. App 界面（RN-App）

### 7.1 版本信息面板重排

分组保留，**复制全部去掉**，底部换成「上报问题」。不显示租户信息。

```
应用
  版本            1.2.3 (Build 45)
  分发渠道        直接分发
  平台            Android 14

热更新
  OTA 修订        rev 12            ← 这一行解决了最初的问题
  运行时           1.2.0
  OTA 通道        production
  灰度            已加入            ← 仅 canary.enrolled 时出现

更新与诊断
  最新版本        1.2.4
  最低支持        1.0.0
  请求 ID         abc123

              [ 上报问题 ]
```

`rev N` 的取法：`Updates.updateId === config.update.ota.updateId` → `rev N`；
不等说明服务端已发新包但本机还没应用 → `未知修订（有 rev N 待生效）`；
内置启动 → `内置版本`。`config.update.ota.revision` 已在下发里，这一行不需要改契约。

### 7.2 手动上报流程（D5 知情同意）

点「上报问题」→ 面板：

1. 可选单行输入「简单说说遇到了什么」（≤200 字）
2. **将要发送的内容全文**，可滚动（元数据 + 日志条目）
3. 「确认上报」/「取消」

成功：

```
        已上报
    参考号  R7KQ3M2X
  把这个号告诉客服即可
        [ 好的 ]
```

日志上传失败但元数据成功时，仍然给参考号，附一行「日志未能上传，但问题已记录」。
失败分类文案：配额满→「稍后再试」，凭证→「请重启应用」，网络→「检查网络」。

### 7.3 设置页

两处新增：

- **「自动上报崩溃」开关**（§4.6 第 2 道闸）。默认跟随远程 `features.crashAutoReport`，
  用户改过之后以用户的为准。开关旁一行说明：会在应用异常退出后的下次启动自动上传崩溃日志。
  远程关着时这一项不显示。
- **「上次异常退出，是否上报」提示**：pending-crash 快照存在但五道闸没全过时出现，点了才发。

### 7.4 根错误边界

「复制诊断信息」改「上报问题」，成功后原地显示参考号；同时**落崩溃快照**（§4.5），
这样即使用户没点、或者点了失败，下次启动仍有机会按 §4.6 处理。
崩溃场景下设计系统和运行时上下文都不可信，所以直接调 `report-service`，
不走 §7.2 那个面板，用该文件现有的 `COPY` 常量（内置中英文案）。

---

## 8. i18n

新增键（zh-CN / en-US 两份写进 `builtin-messages.ts`，然后跑 `node scripts/export-i18n-seed.mjs`）：

`diagnostics.report` / `reportTitle` / `reportHint` / `notePlaceholder` / `preview` /
`submit` / `submitted` / `reference` / `referenceHint` / `logUploadFailed` /
`quotaExceeded` / `credentialFailed` / `networkFailed` / `disabled` /
`pendingCrashPrompt` / `autoCrashReport` / `autoCrashReportHint`，
以及 §7.1 那批版本行标签（`update.otaRevision` / `otaRevisionPending` / `otaChannel` /
`canary` / `platform` / 四个分组标题）。

---

## 9. 测试

| 层          | 用例                                                                                                                                                                                                                                                                                                                                                                                |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RN-App      | 环形缓冲满了丢最旧；`logEvent` 对助记词脱敏；超长截断；60 秒节流；`diagnosticsEnabled=false` 时按钮不出现；NDJSON 序列化格式                                                                                                                                                                                                                                                        |
| RN-App 崩溃 | 快照含 `tail` 且已脱敏；超 64 KB 先裁 `tail`；上传成功后槽位被清空；**五道闸各自单独可阻断**；三次启动都不 healthy 时熔断；同指纹 24 小时内只发一次；每日 3 条上限                                                                                                                                                                                                                  |
| RN-App lint | `core/diagnostics` 导入 `core/wallet/vault` 报错（§3.1）；把 `JSON.stringify(x)` 传进 `logEvent` 报错（§3.3）；wallet 目录里往 `throw new Error()` 传变量报错（§3.2）                                                                                                                                                                                                               |
| 契约        | `secret-redaction.v1.json` 在 TS 与 Go 两侧行为一致；`features.crashAutoReport` 缺键时 App 侧解析出 `false` 且整份配置仍有效                                                                                                                                                                                                                                                        |
| RN-Server   | 无凭证 401；撤销后 401；配额 429；**`crash_auto` 配额与手动配额互不影响**；字节预算 429；元数据 8 KB / 日志 512 KB 超限 413；带 `Content-Encoding` 415；单行超 8 KB 丢弃计数；未知 level/tag 整行丢弃；**落盘内容是重新序列化的规范 NDJSON 而非原字节**；身份从会话解析且忽略体内伪造字段；幂等键重复返回同一 reference；四种 `log_status` 各自可达；跨租户读 404；删除同时清掉对象 |
| RN-Admin    | 列表筛选与指纹聚合；查看器纯文本渲染（断言不出现 `dangerouslySetInnerHTML`）；`/log/raw` 三个响应头齐全；状态变更与删除落审计；功能开关区出现「崩溃自动上报」                                                                                                                                                                                                                       |
| 端到端      | 预发构建种 canary 助记词 → 走完整上报 → 断言对象存储里落的是 `[redacted:secret]` 且测试失败（§3.5 的「命中即缺陷」）                                                                                                                                                                                                                                                                |

---

## 10. 分期

| 阶段 | 内容                                                                                        | 仓库      |
| ---- | ------------------------------------------------------------------------------------------- | --------- |
| A    | §3.1–3.3 助记词隔离（lint + 抛出点 + 签名）                                                 | RN-App    |
| B    | §4.1–4.3 日志缓冲 + 接入六处日志源                                                          | RN-App    |
| C    | §5 迁移 v46（建表 + `crashAutoReport` 回填）+ mobile 两个接口 + admin 接口组 + 共享脱敏向量 | RN-Server |
| D    | §4.4 / §7.1 / §7.2 手动上报 + 版本信息重排                                                  | RN-App    |
| E    | §4.5 / §4.6 / §7.3 / §7.4 崩溃快照与自动上报                                                | RN-App    |
| F    | §6 管理端页面 + 查看器 + 删除 + 功能开关 + 反向入口                                         | RN-Admin  |
| 后续 | §3.4 `Secret` 封装（独立一轮）                                                              | RN-App    |

A → C 是硬前置。D、E 顺序做（E 依赖 D 的接口封装）。F 可以和 D/E 并行。
上线顺序：**C 先部署**，然后 D/E 的 App 版本，F 随时。

---

## 11. 明确不做的

| 不做                                   | 理由                                                                                                  |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 接入第三方崩溃平台（Sentry / Bugsnag） | 钱包 App 的日志出口多一个外部接收方，等于多一个 T1 的持有者；而「关联租户/设备/账号」它们本来也给不了 |
| 在崩溃现场上传                         | D12。进程正在死，请求本来就不可靠；而且那正是崩溃循环被放大的地方                                     |
| 客户端压缩后上传                       | T11 解压炸弹。服务端自己压，输入有界                                                                  |
| 给管理端下发预签名 URL                 | T13。URL 是字符串形态的持有型凭证，会进工单、进日志、进截图                                           |
| 把日志正文存进 DB                      | 会把元数据表拖成 blob 表，列表查询和备份跟着遭殃                                                      |
| 直接把客户端字节原样落盘               | D7/T14。服务端必须解析才能做第二遍脱敏，既然已经解析了就该重新序列化                                  |
| 自动清理 / 保留期                      | D14 评审决定。后果与补偿写在 §5.7，不当作没有代价                                                     |
| 新起后台 worker 或服务实例             | D16 评审要求。`missing` 状态改为读时惰性判定（§5.4）                                                  |
| 上传截图或完整 Redux/Query 状态        | 状态里必然有地址与余额，价值远低于风险                                                                |
| 在日志里存原始请求/响应                | token 就在里面（§4.2 只记路径模板和状态码）                                                           |
| 匿名（无凭证）上报                     | 省不了多少事，但把 T2/T3/T4 全部打开                                                                  |
| `installationId` 之外的设备指纹做限流  | 现有 `device_clients` 已做归并，再加一层只增加误伤                                                    |
