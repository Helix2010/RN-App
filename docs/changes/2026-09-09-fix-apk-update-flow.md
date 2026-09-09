# 全量升级：下载断点续传、后台继续、弹层与检查入口不再"没反应"

日期：2026-09-09 · 设计：`docs/design/apk-update-flow-2026-09-09.md`

## 需求（真机反馈）

下载中断网 / 锁屏后中断不能续；中断后再点"查看更新"没反应；杀进程重开、点检查出弹层、点别处关掉后再点检查没反应。

## 根因

- 下载每次从头开始，不保存断点、不重试、无停滞判定；服务端下载接口不支持 Range。
- 下载进度与"已关闭"都是弹层组件内部状态：弹层被关掉后状态还在但看不见；再点检查只是把同一版本号再设一次，没有新变化。

## 预期行为

- 有新版本时每次冷启动提示一次；前台切回不提示；手动检查随时可弹；"稍后再说"只对本次进程有效。
- 下载由全局管理器负责：关弹层、切页、锁屏、切后台都不影响；断网 / 停滞自动暂停并按 1 / 3 / 8 秒退避续传，回前台立即续传；退避用完等用户点"继续下载"。
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
| 文案 | `update.resume / retryDownload / pausedNetwork / pausedStalled / pausedRetrying / backgroundHint / readyToInstall / installerOpened / downloadingRow / speed`（seed 已同步 RN-Server） |

## 开关

不涉及模块开关；直装下载仍受 `features.directUpdateEnabled` 与 `app.distribution === "direct"` 约束。

## 风险

- 续传依赖服务端 206：服务端已先上线；万一回 200 整包，客户端按大小不符删掉重来一次。
- 停滞判定 20 秒：极慢网络下可能被判停滞后立即续传，行为正确只是多一次请求。

## 验证

- 单测：见设计文档 §11。
- 模拟器 / 真机：见下方记录。
