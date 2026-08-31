# Feature: app-release-1-2-1

状态：Ready for release

## 用户场景与现状证据

- 用户/角色：AnyFun App 测试用户与发布维护者
- 当前行为或复现：基于最新 `main` 构建下一次原生全量版本。
- 代码调用链：`app.config.ts` → Expo prebuild/Gradle Release → Android APK。
- 非目标：不新增业务功能；不通过 OTA 交付原生配置变化。

## Given / When / Then

1. Given 最新 `origin/main`，When 执行生产配置构建，Then 产物版本为 1.2.1、Android versionCode 为 15。
2. Given AnyFun 租户配置，When 安装 APK，Then applicationId 为 `com.anyfun.foundation`，API 地址为 `https://api.anyfun.win`。
3. Given 构建完成，When 执行质量门禁和 APK 校验，Then 所有门禁通过且 APK 可安装。

## UI 与交互状态

- loading / empty / content：沿用现有 App 基座，不改页面状态。
- error / timeout / offline：沿用现有网络与升级错误处理。
- 重复提交 / 取消 / 返回：不涉及新增交互。
- light / dark / 字体放大 / 无障碍：沿用现有设计系统回归验证。

## 技术影响

- API/OpenAPI：不变；构建元数据继续通过请求头传递。
- 状态与本地数据：不变。
- 钱包/签名/链/金额精度：不变。
- 权限、隐私与遥测：不新增权限；沿用现有配置。
- OTA 或全量更新：全量 APK；runtimeVersion 变更为 1.2.1，不能作为 1.2.0 OTA 发布。

## 验证与发布

- 修复前失败测试或需求测试：无；执行完整质量门禁。
- iOS / Android：Android Release 必须完成；iOS 原生构建按环境可用性记录。
- 灰度指标与停止条件：先内部直装验证启动、Bootstrap、升级中心，再扩大分发。
- 回滚：撤回 1.2.1 发布记录，恢复 1.2.0 全量版本；代码回滚到前一提交。
