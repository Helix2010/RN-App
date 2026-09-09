# 全量升级（APK）体验：提示节奏、后台下载与断点续传

日期：2026-09-09 · 状态：已确认（§9 四项）并实现，变更记录 `docs/changes/2026-09-09-fix-apk-update-flow.md` · 范围：RN-App（升级弹层、下载管理器、关于 / 设置页）、RN-Server（下载接口支持 Range）

## 1. 真机反馈与根因

| 反馈 | 根因（代码核对） |
| --- | --- |
| 下载中网络抖动 / 锁屏后中断，无法继续 | `apk-update-service.ts` 每次都从头 `createDownloadResumable(...).downloadAsync()`：不保存 `resumeData`、不重试、没有停滞判定（OkHttp 无超时，卡住就一直"下载中"）；服务端 `publicReleaseDownload` 整体流式转发，不支持 `Range`，客户端就算续传也拿不到 206 |
| 中断后再点"查看更新"没反应 | 下载状态是 `UpdateModal` 组件内部 state（`progress` / `busy`），弹层被返回键 / 遮罩关掉后状态还在但看不见；再点"查看更新"只是把同一个 `manualUpdatePromptVersion` 再设一次，React 无变化不重渲染，弹层也因 `dismissedVersion === latestVersion` 不再出现 |
| 杀进程重开、点检查出弹层，点别处关掉后再点检查没反应 | 同上：`dismissedVersion` 是弹层的组件 state，App 根部常驻，不随"新的一次手动检查"重置 |

另：反馈里的"点击没翻译"若指按钮文字显示成键名，`update.viewNow` 在内置字典与服务端字典都有；请截图确认。本文按"点击没反应"处理。

## 2. 目标体验

1. **提示节奏**：有新版本（推荐或强制）时，每次冷启动提示一次；后台切回前台不提示；手动检查随时可再弹。
   "稍后再说"只对本次进程有效。去掉现在的"同版本 24 小时只提醒一次"节流——它是为了防打扰，但用户明确要求每次启动都提示，且一次冷启动只弹一次已经足够克制。
2. **下载是页面之外的事**：下载由全局管理器负责，弹层只是它的一个视图。关掉弹层、切页、锁屏、切后台都不影响下载；杀进程后能从断点继续。
3. **状态永远可见、可操作**：弹层与关于页的"新版本"卡都反映同一份状态——立即更新 / 下载中 x% / 已暂停·继续 / 下载失败·重试 / 安装。不会出现"点了没反应"。
4. **强制更新**：弹层不可关闭（现状保留），下载状态同上。

## 3. 交互设计

### 3.1 弹层（UpdateModal）

```
状态         主按钮                副按钮 / 提示
idle         立即更新              稍后再说（强制无）
downloading  ━━━━━━━━ 63% · 1.9 MB/s  "可关闭此窗口，下载会在后台继续"；稍后再说
paused       继续下载              原因一行：网络中断 / 已暂停；稍后再说
failed       重试                  失败原因；稍后再说
ready        安装                  "安装包已就绪"；稍后再说
installing   安装                  "已打开系统安装页"；稍后再说
```

- 关闭弹层（遮罩 / 返回键 / 稍后再说）不取消下载；下载完成时给一条顶部 toast"安装包已就绪，去关于页安装"（点 toast 打开弹层）。
- 强制更新：没有关闭入口；下载失败时"重试"；服务状态页入口保留。
- 弹层出现条件改为：`config.update.decision !== "none"` 且（本次进程未"稍后"过 或 这是一次新的手动检查）。手动检查每次产生新的 token（`{ version, requestedAt }`），"稍后"记的是 token，不再是版本号。

### 3.2 关于页 / 设置页

- "新版本"卡的按钮随下载状态变：立即更新 / 下载中 x%（可点，打开弹层看详情）/ 继续下载 / 重试 / 安装。
- 无新版本时"检查更新"行值：检查中… / 已是最新 / 发现新版本 x（沿用）。
- 手动检查 = 刷新 bootstrap + 打开弹层；若已在下载，直接打开弹层显示进度，不重新开始。

### 3.3 提示节奏（运行时）

- 冷启动：bootstrap 到手后若 `decision !== "none"` → 弹一次（每个进程一次），不看 24 小时记录。
- 前台切回：仍会刷新 bootstrap（现状，为了策略变化），但不弹；只有"从无到有"出现强制更新时例外——强制更新必须立刻拦。
- 手动检查：随时弹。

## 4. 下载管理器（`core/updates/apk-download-manager.ts`）

单例 + zustand store（`useApkDownload`），状态：

```ts
type ApkDownloadState =
  | { phase: "idle" }
  | { phase: "downloading"; releaseId; written; total; bytesPerSecond }
  | { phase: "paused"; releaseId; written; total; reason: "network" | "stalled" | "user" | "background" }
  | { phase: "failed"; releaseId; written; total; error: string; attempts }
  | { phase: "ready"; releaseId; fileUri; size }
  | { phase: "installing"; releaseId; fileUri };
```

- **断点续传**：`createDownloadResumable(url, fileUri, {}, onProgress, resumeData)`；每次暂停 / 失败把 `savable()` 连同 `releaseId / size / sha256` 持久化到 AsyncStorage（`foundation.apk-download.v1`）。冷启动时若持久化记录的 `releaseId` 仍是当前 `update.full.releaseId` 且本地部分文件存在 → 自动 `resumeAsync()` 续传（状态从 paused 变 downloading，弹层与关于页同步显示）；版本换了就删旧文件与记录。
- **停滞判定**：20 秒无进度回调 → `pauseAsync()`，状态 paused(stalled)；回到前台或网络恢复（AppState active）自动续传。
- **重试**：网络错误自动重试 3 次（1 / 3 / 8 秒退避），仍失败进 failed，等用户点"重试"。
- **后台 / 锁屏**：OkHttp 在后台通常会继续；被系统限流或断连时靠停滞判定 + 回前台自动续传。真正的系统级后台下载（Android DownloadManager / WorkManager）需要原生模块，本轮不做（§7）。
- **完成校验**：大小必须等于 `update.full.size`；再校验 SHA-256（用 expo-file-system 读文件分块哈希开销大，改为让系统安装器校验签名 + 大小核对，与现状一致；若后续要严格校验，加原生 hash）。
- **就绪后**：文件保留，`ready` 状态下"安装"直接拉起系统安装器；安装完成 App 会被替换，无需清理；用户取消安装则仍是 ready。
- **清理**：`apk-updates/` 目录里非当前 releaseId 的文件在冷启动时删除。

## 5. 服务端：下载接口支持 Range（RN-Server）

- `objectstore.Client` 增 `GetRange(ctx, key, start, end) (io.ReadCloser, error)`（S3 `GetObject` 带 `Range: bytes=start-end`）。
- `GET /v1/public/releases/:id/download`：
  - 总是返回 `Accept-Ranges: bytes`、`ETag: "<sha256>"`、`Content-Length`。
  - 带 `Range: bytes=start-[end]`（单区间）且 `If-Range` 缺省或等于 ETag → `206 Partial Content` + `Content-Range: bytes start-end/total`；区间非法 → `416`；`If-Range` 不匹配 → 忽略 Range 返回 200 全量。
- 单测：区间解析（纯函数）+ handler 的 206 / 416 / 200 三种响应头。

## 6. 文案（fallback-config → seed → RN-Server）

`update.resume`（继续下载）、`update.pausedNetwork`（网络中断，已暂停）、`update.pausedStalled`（下载停滞，已暂停）、`update.backgroundHint`（可关闭此窗口，下载会在后台继续）、
`update.readyToInstall`（安装包已就绪）、`update.readyToast`（安装包已就绪，点此安装）、`update.retryDownload`（重试下载）、`update.speed`（{speed}/s）。

## 7. 不做与边界

- 系统级后台下载（进程被杀也继续）需要原生模块，先靠续传 + 回前台自动续传覆盖绝大多数场景；若真机反馈仍频繁中断再立项。
- iOS 不涉及（直装 APK 只在 Android）。
- 网络类型（蜂窝 / Wi‑Fi）不区分：续传只在用户已发起下载的前提下进行，不会主动用流量。

## 8. 改动清单与工作量

| 层 | 内容 | 估时 |
| --- | --- | --- |
| RN-Server | `GetRange` + 下载接口 Range / ETag / If-Range + 单测 | 0.5 天 |
| RN-App 核心 | `apk-download-manager.ts`（状态机、续传、停滞、重试、持久化、冷启动恢复、清理）+ 单测 | 1 天 |
| RN-App 界面 | 弹层按状态渲染、手动检查 token、冷启动一次 / 前台不弹、关于 / 设置页状态按钮、toast | 0.5 天 |
| 验证 | 单测；真机：下载中断网 → 恢复续传；锁屏 → 回来续传；杀进程 → 冷启动续传；关弹层再手动检查 | 0.5 天 |

App 侧走 OTA（1.2.10 基线 `rel_JHrSsfq0LQtaWX1o1NpZjg`）；服务端随 push 自动部署。

## 9. 已确认（2026-09-09）

1. 提示节奏：每次冷启动提示一次、前台切回不提示、去掉 24 小时节流（§3.3）。
2. 关闭弹层不取消下载，完成后引导安装（§3.1）。
3. 续传不区分网络类型（§7 末条）。
4. 系统级后台下载（原生模块）本轮不做（§7）。

## 10. 实施前评审：对 §2–§8 的补正

| # | 发现 | 处理 |
| --- | --- | --- |
| 1 | "完成后 toast 引导安装"：设计系统的 toast 没有点击动作，而且用户在别的页面看到一条会消失的提示等于没提示 | 下载完成直接**重新弹出升级弹层**（主按钮"安装"），每个 releaseId 只自动弹一次；后台完成的话回前台就看到。toast 不再承担引导职责 |
| 2 | 冷启动自动续传是否算"App 主动用流量" | 不算：文件只在用户点过"立即更新"后才会存在，续传是完成用户自己发起的下载 |
| 3 | Android 的 `resumeData` 语义 | 核对 expo-file-system 源码：Android 的 resumeData 就是已写字节数，原生按 `Range: bytes=N-` 追加写。所以不需要持久化续传句柄，磁盘上的部分文件就是断点；冷启动只看文件大小 |
| 4 | 服务端老版本不认 Range 会回 200 整包，追加后文件比预期大 | 完成时核对大小；不符删掉重来一次，再不符进 failed。服务端已先于 App 上线 Range 支持（RN-Server 069e89b） |
| 5 | 版本在下载途中换了 | `configure` 比较 releaseId：不同就中止、删旧文件、回 idle；目录里其它版本的文件冷启动时清掉 |
| 6 | 用户在系统安装页取消 | 状态留在 installing，"安装"可再点；App 被替换后自然结束 |
| 7 | 手动检查时已在下载 | 关于 / 设置页直接打开弹层显示进度（`promptUpdate`，不刷新配置、不重新开始） |
| 8 | 停滞判定与后台 | 停滞 / 断网 → 暂停 + 退避重试（1 / 3 / 8 秒）；后台时不重试，回前台立即续传；退避用完进 failed 等用户 |
| 9 | 弹层是应用根部常驻组件，`useState` 记"已弹过"会跨版本残留 | 三个来源各记一份键：冷启动按 latestVersion、手动检查按 requestedAt、下载完成按 releaseId |
| 10 | 弹层要在启动门禁之后 | 运行时只有 `entered` 后才渲染子树，弹层天然在启动页之后 |
| 11 | 可测性：jest 没有 expo-file-system 桩 | 管理器全部依赖注入（文件系统 / 下载任务 / 安装器 / 前后台 / 时钟），单测用假实现覆盖续传、停滞、退避、恢复、错包重来、换版本清理 |
| 12 | 24 小时节流 store 成为死代码 | 删除 `update-prompt-store` 与其单测 |
| 13 | 安全：releaseId 拼进文件名 | 只保留 `[A-Za-z0-9_-]`，其余替换成 `_`，不让服务端字符串变成路径 |
| 14 | 安全：安装包地址 | 只接受 `https://`，否则视为没有可装版本并留痕；完整性靠大小核对 + 系统安装器签名校验（升级包必须与已装应用同签名） |
| 15 | 冷启动规则精确化 | "冷启动一次"= 进程内首次渲染时已有更新才自动弹；会话中途前台刷新冒出的推荐更新不弹（关于 / 设置页有红点），强制更新随时弹 |
| 16 | 中止标记跨次残留 | `reset` / 停滞留下的 `pausing` 在每次新传输开始时清零，否则新传输报错会被当成"主动中止"吞掉 |

## 11. 实现（2026-09-09）

- RN-Server 069e89b：`objectstore.Client.GetRange`；下载接口 `Accept-Ranges / ETag / If-Range / 206 / 416`；区间解析单测。
- RN-App：`core/updates/apk-download-manager.ts`（状态机 + 依赖注入）、`apk-download.ts`（expo 接线与单例）、运行时 `manualUpdatePrompt` 令牌与 `promptUpdate`、
  `update-modal.tsx` 按状态渲染、关于页 `ApkUpdateButton`、设置页检查行带下载状态；新增文案 11 键；删除旧的 `apk-update-service` 与节流 store。
- 单测：`apk-download-manager.spec.ts`（6 例：从头下载 / 断网续传与退避 / 停滞与回前台 / 冷启动恢复与清理 / 错包重来 / 换版本清空）、
  `update-modal.spec.tsx`（冷启动一次、稍后本进程有效、手动检查每次重开、强制、无地址、下载各状态与完成重弹）、检查行单测。
  全量 jest 107 套 740 例、lint、typecheck、format 通过。
- 模拟器核对见变更记录。
