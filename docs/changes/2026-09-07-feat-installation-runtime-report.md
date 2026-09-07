# 心跳上报启动来源、运行中的 OTA 与客户端登录态

日期：2026-09-07。设计：`docs/design/device-account-aggregation-2026-09-07.md` 第一期（App 侧）。

## 改动

- 心跳报文新增 `launchSource`（`embedded` / `ota`）与 `runningUpdateId`：来自 expo-updates 的
  `isEmbeddedLaunch` / `updateId`；expo-updates 关闭的开发构建按内置算。服务端据此解析运行中的
  OTA 修订号，管理端能看到"这版 OTA 生效了多少设备"。
- 心跳报文新增 `sessionState`（`signed_in` / `signed_out`），只用于服务端与会话表对账，不参与判定。
  登录态属于会话功能，core 不反向依赖：会话网关在创建时向 `core/device/session-state-probe`
  注册探针；登录成功、登出、服务端撤销（401）时调用 `notifySessionStateChanged`，运行时立即补一次心跳。
  没有注册探针（Mock 网关、测试壳）时不带该字段，服务端记"未上报"。
- 三个字段都进心跳指纹：OTA 生效后的第一次启动、登录态翻转都会立刻上报，不等 30 分钟节流。

## 验证

- `installation-service.spec.ts`：内置 / OTA / 关闭 expo-updates 三种来源，登录态探针与指纹变化。
- `session-state-probe.spec.ts`。
- 模拟器：装上本次 OTA 后管理端设备列表"运行中"显示对应修订号，登录态显示"已登录"。
