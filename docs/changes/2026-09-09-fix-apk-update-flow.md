# 全量升级：下载断点续传、后台继续、弹层与检查入口不再"没反应"

日期：2026-09-09 · 设计：`docs/design/apk-update-flow-2026-09-09.md`

## 需求（真机反馈）

下载中断网 / 锁屏后中断不能续；中断后再点"查看更新"没反应；杀进程重开、点检查出弹层、点别处关掉后再点检查没反应。

## 根因

- 下载每次从头开始，不保存断点、不重试、无停滞判定；服务端下载接口不支持 Range。
- 下载进度与"已关闭"都是弹层组件内部状态：弹层被关掉后状态还在但看不见；再点检查只是把同一版本号再设一次，没有新变化。

## 预期行为

- 有新版本时每次冷启动提示一次；前台切回不提示；手动检查随时可弹；"稍后再说"只对本次进程有效。
- 下载由全局管理器负责：关弹层、切页、锁屏、切后台都不影响；断网 / 停滞自动暂停并按 1 / 3 / 8 秒退避续传，之后前台每 30 秒慢速重试，回前台立即续传；用户随时可点"继续下载"。只有校验类错误（两次大小不符、文件丢失）才是"下载失败 / 重试下载"。
- 立即生效的 OTA 正在重启时，全量升级弹层不再叠在 OTA 重启弹层上。
- 杀进程重开：冷启动从磁盘上的部分文件自动续传；已下完的包直接"安装"。
- 弹层与关于页按钮 / 设置页检查行反映同一份状态：立即更新 / 下载中 x% / 继续下载 / 重试 / 安装。下载完成自动重新弹出"安装"。
- 服务端下载接口支持 Range（206 / 416 / ETag / If-Range）。

## 改动

| 层 | 内容 |
| --- | --- |
| RN-Server | 069e89b：`GetRange` + 下载接口 Range 支持 + 单测 |
| RN-App 核心 | `apk-download-manager.ts`（依赖注入的状态机）、`apk-download.ts`（expo 接线）；删除 `apk-update-service.ts`、`update-prompt-store.ts` |
| RN-App 运行时 | `manualUpdatePrompt` 令牌（每次检查都是新对象）、`promptUpdate()`、bootstrap 变化时配置下载管理器 |
| RN-App 界面 | 弹层按状态渲染；关于页 `ApkUpdateButton`；设置页检查行带下载状态并可打开弹层 |
| 文案 | `update.resume / retryDownload / pausedNetwork / pausedStalled / pausedRetrying / backgroundHint / readyToInstall / installerOpened / downloadingRow / speed`（seed 已同步 RN-Server；`pausedNetwork / pausedStalled` 二轮改为"会自动续传"措辞） |
| 二轮（模拟器实测后） | `ApkIntegrityError` 区分校验类错误；传输错误退避用完转慢速轮询而不是 failed；运行时 `otaRestartPending`，弹层让位 |

## 开关

不涉及模块开关；直装下载仍受 `features.directUpdateEnabled` 与 `app.distribution === "direct"` 约束。

## 风险

- 续传依赖服务端 206：服务端已先上线；万一回 200 整包，客户端按大小不符删掉重来一次。
- 停滞判定 20 秒：极慢网络下可能被判停滞后立即续传，行为正确只是多一次请求。

## 验证

- 单测：见设计文档 §11（管理器 8 例、弹层 9 例、检查行）；lint / typecheck / format / i18n:check 通过。
- 服务端：`curl -H "Range: bytes=0-99"` 对线上下载接口返回 206。

### 模拟器（rn_smoke，1.2.10 + OTA rev 1 → 下载 1.2.11，宿主机限速约 0.5 MB/s）

| 场景 | 结果 |
| --- | --- |
| 冷启动弹层、点"立即更新" | 进度条 + 百分比 + 速度 + "可关闭此窗口"提示 |
| 关闭弹层后下载 | 继续；关于页按钮显示"下载中 x%"，再点打开弹层 |
| 断网（wifi + 数据同时关） | 文件停止增长，恢复网络后从已下字节继续（没有从 0 开始） |
| 锁屏 12 秒再解锁 | 一轮实现下：停滞→退避用完→"下载失败"，解锁后不自动续传（`failed` 不续传的缺陷）→ 二轮改为慢速轮询 + 回前台立刻续 |
| 强杀进程再启动 | 冷启动自动从 27,200,828 字节续到完成 |
| 下载完成 | 弹层自动重新弹出"安装包已就绪 / 安装"，文件大小与 release 一致（38,666,870） |
| OTA 立即生效 + 全量更新同时存在 | 一轮观察到两个弹层叠着 → 二轮全量弹层让位 |

### 发布

- OTA（1.2.10 基线 `rel_JHrSsfq0LQtaWX1o1NpZjg`）：rev 1 `ota_fhy0iTvB80TouObj7nXvrQ`（一轮）。
  二轮 rev 2 被服务端拒绝：全量 1.2.11 发布后 1.2.10 变成"已取代"，`OTA_BASE_RELEASE_INVALID`。1.2.10 用户停留在一轮实现（有"下载失败"死角），要拿到二轮修复只能整包升到 1.2.11。
- 全量 1.2.11 / build 25：`rel_xGci1cDn1HXUsVUyv7Yguw`；其上 OTA rev 1 `ota_C5etKQQGvZEJNgVbZs8kgw`（二轮，immediate，源码 480549e）。
  模拟器：1.2.10 → 弹层"安装" → 系统安装器"更新" → 1.2.11 首次启动即收到该 OTA，重启后 `updates.db` 里运行的是 `506c6fa0-…`。
- 1.2.9 基线同样已被取代，无法再发 OTA：1.2.9 用户只能走旧的整包升级流程。
- 服务端策略（2026-09-09 用户确认维持现状）："发布新全量版本 = 旧基线不再接收 OTA"。理由：已经要求用户升级到新全量版本，旧版本无需再收热修复。运营上的含义：修复要覆盖旧版本用户时，用"强制升级"或提高最低支持版本把他们推到新全量包。

## 追加（2026-09-09）：管理端可事后改升级类型 / OTA 生效策略

- RN-Server c65531b：`POST /v1/admin/releases/{id}/set-mandatory`（body `mandatory` + reason + confirm）、`POST /v1/admin/ota/releases/{id}/set-apply-strategy`（body `applyStrategy`）。只允许 `verified / active / paused`，其它状态 409 `RELEASE_FLAG_LOCKED / OTA_FLAG_LOCKED`。审计动作 `release_set_mandatory / ota_set_apply_strategy`（含 previous）。manifest 下发时用数据库里的策略覆盖文件里登记时写死的 `metadata.applyStrategy`，ETag 带策略后缀。
- RN-Admin f4b09da：全量列表新增"升级类型"列（强制 / 非强制开关），OTA 列表"生效策略"列改为开关；切换不直接生效，走原来的原因面板 + 二次确认；不可改的行置灰并给出原因。
- 线上验证：OTA `ota_C5etKQQGvZEJNgVbZs8kgw` 切到 next_launch 后 manifest 与 ETag 随之变化，再切回；`completed` 的 1.2.10 全量拒绝修改（409）；审计正常。
- 顺带确认：OTA 的"取代"按 (platform, channel, runtimeVersion) 算，1.2.10 基线上的 rev 1 仍是 1.2.10 runtime 的活跃 OTA、仍在下发（验证时误切过一次，已恢复为 immediate）；被取代的只是"不能再新建"。
- App 不改：强制判定与 OTA 策略都以 bootstrap 为准，客户端下一次拉配置（冷启动 / 前台刷新）生效。
