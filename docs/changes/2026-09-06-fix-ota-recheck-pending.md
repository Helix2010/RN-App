# OTA：已下载未重启的更新，再次检查时按"待应用"显示

- 日期：2026-09-06
- 来源：模拟器实测 OTA `ota_rVA2YmwCOe3YGGrsB8nngA`（骨架改动，`next_launch`）时发现

## 现状与问题

1. 第一次"检查更新"下载完成后，设置页显示"更新已下载，将在下次启动时自动应用"，正确。
2. 用户不重启、再次点"检查更新"：`Updates.checkForUpdateAsync` 仍返回 `isAvailable=true`（服务端仍在下发该更新），但 `fetchUpdateAsync` 返回 `isNew=false`（本机已存在），`checkAndDownloadOta` 把这一分支当作"当前已是最新"，设置页显示"已是最新"，与原生状态机的 `isUpdatePending=true` 矛盾。

## Given / When / Then

- Given 服务端仍下发某更新，且该更新已在上一次检查中下载到本机
- When 用户再次手动检查
- Then 结果为 `ready`（清单取自 check 结果，`applyStrategy` 仍以 Bootstrap 为准），设置页显示"更新已下载，将在下次启动时自动应用"

## 验证

- `src/core/updates/update-service.spec.ts` 新增用例：check 可用 + fetch 非新 → `ready` / `update.otaReadyNextLaunch`，状态序列 checking→available→downloading→ready。
- 该改动本身未包含在上述 OTA 包里，随下一次 OTA 发布。

## 追加：设置行长文案挤坏布局（同日）

- 模拟器实测 OTA 第 2 版下载完成后，设置页"检查更新"行的值"Update downloaded and will be applied on the next launch"不可收缩，把标题挤没、整组卡片撑空。
- `SRow` 的值改为可收缩（`flexShrink`、最宽 55%、右对齐换行），标题容器允许 `minWidth 0`。
