# Feature: tenant-release-bootstrap

状态：Implemented

## 用户场景与现状证据

- 用户/角色：使用不同 DEX/Web3 租户构建包的移动端用户与发布管理员。
- 当前行为或复现：bootstrap 请求没有租户和应用身份，缓存 key 只有 locale；多租户服务上线后无法选择正确配置，且可能复用另一个租户的本地缓存。
- 代码调用链：`app.config.ts extra` -> `core/network/api-client.ts appRuntime` -> `core/config/bootstrap-repository.ts` -> RN-Server bootstrap。
- 非目标：不在本变更中增加新的页面、权限、原生模块或改变 APK 安装交互。

## Given / When / Then

1. Given 构建配置包含 tenant slug 与 application id，When App 请求 bootstrap，Then query/header 明确携带两者并由服务端返回该租户的发布策略。
2. Given 同一设备先后运行不同租户构建，When 远端请求失败读取缓存，Then 缓存 key 按 tenant + locale 隔离，不读取其他租户配置。
3. Given staging/production 构建缺少 tenant/application，When 生成 Expo 配置，Then 构建提前失败，不产生身份不明确的包。

## UI 与交互状态

- loading / empty / content：沿用现有 bootstrap 状态机，不新增 UI 状态。
- error / timeout / offline：远端失败只读取当前 tenant + locale 的有效缓存，否则进入安全 fallback。
- 重复提交 / 取消 / 返回：请求仍传播 AbortSignal，行为不变。
- light / dark / 字体放大 / 无障碍：无 UI 改动。

## 技术影响

- API/OpenAPI：`GET /v1/mobile/bootstrap` additive 增加可选 `tenant` query；请求新增公开构建 header `X-Application-ID`。
- 状态与本地数据：AsyncStorage cache key 从 `locale` 扩展为 `tenant + locale`，旧 key 不再读取，无需破坏性迁移。
- 钱包/签名/链/金额精度：无影响。
- 权限、隐私与遥测：tenant/application 是公开构建身份，不包含用户或凭证；日志仍禁止敏感数据。
- OTA 或全量更新：TS 与公开 extra 变化可 OTA，但要让不同租户拥有固定原生 applicationId/签名仍必须全量构建；本次不改变 ABI。

## 验证与发布

- 修复前失败测试或需求测试：契约检查与 build profile 校验；bootstrap repository 的现有测试覆盖网络/缓存路径。
- iOS / Android：纯 TS/Expo extra 变更，执行通用门禁；不新增原生开发构建要求。
- 灰度指标与停止条件：观察 bootstrap 404/不兼容响应和 direct update decision；租户找不到或错误发布策略即停止。
- 回滚：恢复旧请求参数和 cache key；服务端 tenant query 为 optional，可兼容旧客户端。
