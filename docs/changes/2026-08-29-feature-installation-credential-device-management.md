# Feature: installation-credential-device-management

状态：Implemented

## 用户场景与现状证据

- 用户/角色：不同租户独立 App 的终端用户、租户管理员和平台运营人员。
- 当前行为或复现：安装实例只能用 installationId 上报，容易被脚本伪造；设备管理、凭证撤销和版本分布缺少闭环。
- 代码调用链：RN-App installation service → domain tenant scope → RN-Server app_installations / push token / outbox → RN-Admin installations page。
- 非目标：本轮不引入 app_device_keys、RSA 全接口签名、tenant_secrets、Play Integrity 或 App Attest。

## Given / When / Then

1. Given 新 App 安装，When 首次请求注册，Then 服务端按域名租户创建安装凭证并仅返回一次明文凭证。
2. Given 已注册安装，When 心跳或 Push Token 注册，Then 服务端校验租户、applicationId、platform、凭证哈希和有效期。
3. Given 凭证接近 14 天内过期，When 心跳成功，Then 服务端生成新凭证并返回，App 保存到 SecureStore。
4. Given 管理员撤销安装，When 设备再次心跳或注册 Token，Then 请求被拒绝且已有推送 Token 失效。
5. Given 发布 APK/OTA/语言/品牌，When 业务事务提交，Then 同事务写入租户隔离 Outbox，Worker 按安装实例发送。

## UI 与交互状态

- loading / empty / content：管理端设备列表和版本统计表达加载、空列表和错误状态。
- error / timeout / offline：App 心跳失败不阻塞使用；下次启动或回前台重试；推送失败不影响 Bootstrap 轮询。
- 重复提交 / 取消 / 返回：心跳按 30 分钟节流；Token 注册幂等；撤销需要 reason 和 confirm。
- light / dark / 字体放大 / 无障碍：设备页复用管理端设计系统，App 设置入口使用现有主题和文案。

## 技术影响

- API/OpenAPI：新增安装注册、心跳（含自动凭证轮换）、Token 注册和租户设备列表/撤销接口。
- 状态与本地数据：installationId 和 credential 使用 SecureStore；心跳时间戳使用 AsyncStorage；服务端版本化迁移 18/19。
- 钱包/签名/链/金额精度：无资金或签名逻辑。
- 权限、隐私与遥测：通知权限按需申请；设备来源只上传哈希，不采集硬件原始标识；租户接口严格过滤 tenant_id。
- OTA 或全量更新：推送和 SecureStore/Notifications 原生模块需要全量包；更新事件只触发 Bootstrap/Manifest 检查。

## 验证与发布

- 修复前失败测试或需求测试：新增安装凭证/轮换/撤销代码路径，三端现有门禁通过。
- iOS / Android：Android prebuild 已确认通知权限；完整 Gradle 构建与 FCM/APNs 真机投递尚未完成。
- 灰度指标与停止条件：注册成功率、凭证失效率、心跳成功率、Outbox 失败率、Token 失效率；异常时关闭 PUSH_DISPATCH_ENABLED。
- 回滚：关闭 Worker、保留轮询；数据库迁移只向前，客户端使用上一全量包可继续读取旧字段。
