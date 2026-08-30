# Feature: tenant-module-driven-app-shell

状态：Implemented

## 决策

`app_configs.mobile-bootstrap` 继续作为租户级 App 配置唯一事实源，不新增模块表，也不在 RN-App 内复制语言、主题或版本事实。Bootstrap 根据请求域名解析租户后返回：

```json
{ "modules": { "predict": true, "dex": true } }
```

旧配置缺少 `modules` 时按双模块处理；服务端迁移 23 会将历史配置补齐。两个模块不能同时关闭。

## 配置来源

- 模块开关：RN-Admin 应用配置 → `mobile-bootstrap.modules`。
- 语言：现有 `app_configs.languages`、`language_document` 与已发布语言资源。
- 主题/颜色：现有 `mobile-bootstrap.theme`，管理端主题工作台编辑 Light/Dark 语义色。
- 版本/升级：现有 `mobile-bootstrap.updatePolicy` + `app_releases`/`ota_releases`，不新增版本配置。
- 品牌/启动页：现有 `branding` 配置和对象存储资源。

## 客户端行为

| modules       | 底栏                      |
| ------------- | ------------------------- |
| predict + dex | 首页 / 预测 / DEX / 资产  |
| predict only  | 首页 / 预测 / 持仓 / 资产 |
| dex only      | 首页 / 行情 / 兑换 / 资产 |

个人中心从首页品牌入口进入 Stack，不占用底栏。模块参考页先提供真实配置驱动的页面骨架，业务接口接入后替换内容区，不改变导航合同。启动阶段增加与首页结构一致的 `BootstrapSkeleton`，等待远程配置时不展示虚假业务数据，最终失败仍进入配置不可用状态。

## 安全和发布影响

- 配置保存仍使用现有 expectedVersion、reason、审计和 Bootstrap 推送。
- 模块、文案、主题和页面 JS 变更可走 OTA；原生模块/权限变化仍必须全量 APK。
- 禁止出现两个模块同时关闭的配置；App Schema 和 Admin 校验均拒绝该状态。

## 验证

- RN-App：`pnpm check` 通过，37 项测试；新增模块组合测试和 Schema 校验。
- RN-App：`BootstrapSkeleton` 使用设计系统主题令牌，作为后续业务 Query 页的基础 loading 模式。
- RN-App：S-02 设置页按设计稿拆分通用、通知、交易偏好、安全、关于分组；S-03 语言与 S-04 外观作为独立二级页面。
- RN-Admin：`pnpm check` 通过，34 项测试。
- RN-Server：`gofmt`、`go vet`、`go test -race ./...`、`go build ./cmd/server` 通过。
- Android Debug 原生构建未完成：在线构建在依赖解析阶段长时间无输出；离线构建明确缺少 Install Referrer、Firebase Messaging、AndroidX Lifecycle、Biometric 等 Maven 依赖。未将旧 APK 作为本次构建证据；模拟器视觉验收需依赖下载恢复后执行。
