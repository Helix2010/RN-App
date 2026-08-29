# ADR-0003：设备标识与原生推送适配

状态：Accepted（2026-08-29）

## 决策

- 每个租户 App 安装实例使用随机 `installationId`，保存在系统安全存储中；它是租户版本、语言、OTA 和推送数据的主键。
- 平台归并使用 Android `ANDROID_ID` 或 iOS `IDFV` 的 HMAC 结果 `deviceClientId`，仅作为平台内部去重信号，不作为登录、授权或跨租户查询凭证。
- 推送使用 `expo-notifications` 获取原生 Token，RN-Server 通过 Provider Adapter 调用 FCM HTTP v1 / APNs；不使用 Expo Push Service。
- 推送仅触发 Bootstrap/Manifest 检查，不能携带或决定最终版本；推送失败不影响冷启动、回前台和定时同步。

## 原生影响

新增 `expo-secure-store`、`expo-notifications`，需要 Android `POST_NOTIFICATIONS`、iOS Push Notifications 能力和 Development Build/Release Build 验证；不能通过 OTA 交付。

## 隐私边界

- 不上传原始 ANDROID_ID、IDFV、IMEI、广告 ID、MAC 或硬件序列号。
- 服务端仅保存 HMAC 后的设备分组值和租户安装实例；普通租户接口只返回本租户数据。
- 用户拒绝通知权限后仍执行版本和配置同步；Token 失效只标记，不把原始凭证写入日志。

## 退出策略

Provider Adapter 以接口形式隔离，未来可增加 HMS、第三方推送或消息队列；App 端保留无推送降级路径。
