# 修复推送注册链路：心跳契约放宽、S-05 按需申请通知权限

- 日期：2026-09-01
- 关联：RN-Server `273304e`（注册接口 500 修复 + 心跳补回 `deviceGrouping`）；诊断报告 `UI/docs/push-device-sync-diagnosis-2026-09-01.md`

## 现状与问题

- 服务端 `d8ff86d` 删除了心跳响应的 `deviceGrouping`，App 的 `heartbeatResponseSchema` 仍设为必填 → 心跳一定解析失败并抛错 → `registerPushTokenIfAuthorized` 后半段（权限、取 token、上报 `/v1/mobile/push-tokens`）永远走不到。
- `registerPushTokenIfAuthorized` 的 `catch {}` 直接返回 `"unavailable"`，任何失败都看不见。
- App 内没有任何入口调用 `enableUpdateNotifications()`，Android 13+ 不会弹 `POST_NOTIFICATIONS`，`notificationStatus` 恒为 `"denied"`；S-05 的 warn 横条只会把用户丢到系统设置。

## Given / When / Then

- Given 服务端心跳响应不含 `deviceGrouping` When App 心跳 Then 正常通过校验并继续注册推送 token。
- Given 系统通知权限未授予 When 进入 S-05 Then warn 横条动作为「开启通知」，点击弹系统权限框；授予后横条消失。
- Given 权限框被拒绝（含永久拒绝）When 再次点击 Then 动作变为「去开启」并打开系统设置。
- Given 推送注册失败 When 处于 dev 构建 Then `console.warn` 输出原因（生产不输出）。

## 技术影响

- `src/core/device/installation-service.ts`：`deviceGrouping` 改为 `.optional()`；catch 分支 dev 下打 warn。
- `src/features/settings/notification-settings-screen.tsx`：横条动作两段式（申请 → 设置），`testID="notif-permission-action"`。
- i18n 新键 `notif.enable`（zh：开启通知 / en：Enable notifications），`pnpm i18n:seed` 已同步 seed。
- 未改动权限声明；`POST_NOTIFICATIONS` 早已在 `app.config.ts` 中，按 AGENTS 规则采用按需申请。

## 验证

- 单测：`notification-settings-screen.spec.tsx` 2 例（denied → 先申请再引导设置；registered → 无横条）。
- `pnpm check`：format / lint / typecheck / api / config / i18n 全部通过；jest 164 例中 163 通过，唯一失败的 `predict/ui/market-list-screen.spec.tsx`（找不到 `event-ev-btc-120k`）在干净 main `fb4bcb1` 上同样失败，为既有问题，本次未处理。
- Android 模拟器 `rn_smoke` 打线上 `api.anyfun.win`：冷启动后 `app_installations` 出现该设备记录（服务端修复部署后）。
- 未验证：真实 FCM token 上报与投递（构建缺 `google-services.json`、服务端缺 FCM 凭证）；iOS。
