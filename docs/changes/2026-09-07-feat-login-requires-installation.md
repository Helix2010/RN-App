# 登录必须关联安装实例，封禁 / 未注册给明确原因

日期：2026-09-07。设计：`docs/design/device-account-aggregation-2026-09-07.md` 第二期（App 侧），用户已决。

## 改动

- 登录（`HttpSessionGateway.verify`）必须携带安装身份：凭证缺失时当场重新注册
  （`ensureInstallationAuthorization`，复用最近一次心跳的输入）；服务端回
  `INSTALLATION_CREDENTIAL_INVALID` 时丢掉凭证、重新注册、用同一挑战重试一次；仍失败就让错误浮上去。
  不再退化成"不关联设备"的登录（线上此前 8 条会话 0 条关联，就是这条退路造成的）。
- 登录失败原因新增 `installation` / `blocked` / `blockedPlatform`，确认层按原因显示文案；
  以前所有非超时失败都显示"已取消登录"，服务端拒绝也被说成取消。
- 新增文案：`login.installationRequired`、`login.blocked`、`login.blockedPlatform`、`login.failed`。

## 验证

- `installation-service.spec.ts`：按需注册、首个心跳前明确失败。
- `http-session-gateway.spec.ts`：凭证失效重新注册后重试、拿不到凭证登录失败、其他 401 不吞。
