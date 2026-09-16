# RN-App Claude 规则

开始或接手 RN-App 任务前，必须阅读根目录 `AGENTS.md` 以及：

- `docs/SAAS_TENANT_BUILD_RUNBOOK.md`：SaaS 租户集中配置、Android/EAS 打包和版本边界；
- `docs/workflows/APP_CHANGE_WORKFLOW.md`：需求、缺陷、测试、原生变更和交付门禁；
- `docs/RELIABILITY_AND_RELEASE.md`：网络、遥测、OTA 与全量升级约束。

Android 正式包只由签名闸产出（在控制台排构建任务），Claude 不在本地出正式包、不给租户包签名，也不得重新引入 release signingConfig 或签名环境变量。

需要在本地复现构建机那一步时必须使用 `pnpm android:release <tenant-slug>`：它只产出未签名包（装不上设备），不得拆分执行 Expo prebuild 和 Gradle，也不得在命令、`eas.json` 或代码中复制租户 API、包名、applicationId、版本或 Build。配置唯一来源为 `tenants/<slug>/tenant.json`；脚本在复制产物前检查没有签名与 APK 内嵌配置。

开发自测要一个装得上设备的包时使用 `pnpm android:dev-signed`（只签开发包名 `com.anyfun.foundation.dev`，用本机测试密钥，见 `docs/SAAS_TENANT_BUILD_RUNBOOK.md` §3.4）。需要验证正式包行为（例如对正式基线的热更新）时，在控制台排构建任务，从签名闸产出的包下载安装。
