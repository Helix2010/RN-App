# RN-App Claude 规则

开始或接手 RN-App 任务前，必须阅读根目录 `AGENTS.md` 以及：

- `docs/SAAS_TENANT_BUILD_RUNBOOK.md`：SaaS 租户集中配置、Android/EAS 打包和版本边界；
- `docs/workflows/APP_CHANGE_WORKFLOW.md`：需求、缺陷、测试、原生变更和交付门禁；
- `docs/RELIABILITY_AND_RELEASE.md`：网络、遥测、OTA 与全量升级约束。

Claude 执行生产构建时必须使用 `pnpm android:release <tenant-slug>`，不得拆分执行 Expo prebuild 和 Gradle，也不得在命令、`eas.json` 或代码中复制租户 API、包名、applicationId、版本或 Build。配置唯一来源为 `tenants/<slug>/tenant.json`；构建完成后必须检查 APK 内嵌配置。
