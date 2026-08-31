# SaaS 租户 App 打包规范

本规范适用于 RN-App 的所有租户。目标是让不同开发者或 AI 在切换租户、升级版本和生成 APK 时使用同一套可重复流程。

## 1. 唯一配置源

每个租户只允许有一个构建配置文件：

```text
tenants/<tenant-slug>/tenant.json
```

必须集中维护：

- `slug`、`appName`、`scheme`
- `apiBaseUrl`、`applicationId`
- `androidPackage`、`iosBundleId`
- `distributionChannel`、`otaChannel`
- `version`、`androidVersionCode`、`iosBuildNumber`
- `iconBackgroundColor`

`app.config.ts`、`eas.json`、CI workflow 和命令行不得复制租户域名、包名、applicationId、版本或 Build。构建环境只选择租户 slug；签名证书、`google-services.json`、OTA 私钥和推送凭证只能使用 Secret。

## 2. 新增租户

1. 创建 `tenants/<slug>/tenant.json`。
2. 为该租户准备独立品牌资源：`assets/tenants/<slug>/`。
3. 确认 API 域名指向对应租户，生产环境必须使用 HTTPS。
4. 运行配置检查：

```bash
pnpm config:check
EXPO_PUBLIC_TENANT=<slug> pnpm exec expo config --json
```

租户之间不得复用 Android applicationId、iOS Bundle ID、签名证书或缓存命名空间。

## 3. Android Release APK

统一使用：

```bash
pnpm android:release <tenant-slug>
```

例如：

```bash
pnpm android:release anyfun
```

禁止直接分开执行：

```bash
expo prebuild
./android/gradlew assembleRelease
```

因为 Expo 配置和 Gradle 可能读取不同环境，导致生产 APK 嵌入 `localhost` 或其他租户配置。

统一脚本会：

```text
读取 tenant.json
→ 生成 Expo 配置
→ 清理并生成 Android 原生工程
→ Gradle assembleRelease
→ 读取 APK 内嵌 app.config
→ 校验域名 / 渠道 / applicationId / 版本 / Build / OTA / runtimeVersion
→ 校验通过后输出租户命名的 APK
```

输出示例：

```text
artifacts/anyfun-1.2.1-build15-release.apk
```

构建失败时不得上传或发布旧产物。APK 必须另外执行 SHA-256、zipalign、签名和安装验证。

## 4. EAS 构建

EAS 只选择租户，不重复维护租户字段：

```bash
EXPO_PUBLIC_TENANT=<slug> eas build --profile android-direct
EXPO_PUBLIC_TENANT=<slug> eas build --profile production-store
```

若使用 CI，租户 slug 作为 workflow 输入或环境变量，敏感信息使用 GitHub Secrets。任何版本变更都必须同时更新 `version` 和对应平台递增的 Build。

## 5. 版本和升级边界

- 修改 TS/JS、样式、文案且不改变原生 ABI：可发布 OTA。
- 修改原生模块、权限、Manifest、Bundle ID、图标、启动页或原生 SDK：必须发布全量 APK/IPA。
- `runtimeVersion` 必须与基线 App Version 一致。
- APK 的 `versionCode` / iOS buildNumber 必须递增。
- 发布前必须确认新 APK 实际可安装，再提升服务端最低支持版本。

## 6. 发布前检查

```bash
pnpm check
pnpm android:release <tenant-slug>
```

至少确认：

- APK 内 API 地址不是 localhost；
- applicationId、包名、渠道和租户一致；
- App Version、Build、Runtime Version 一致；
- OTA URL 和 channel 指向当前租户；
- 清装后能完成远程 Bootstrap；
- 覆盖安装满足签名和版本递增要求；
- 生产签名不是 Debug Keystore。

## 7. 回滚

代码回滚到上一稳定提交；发布回滚通过管理端撤回当前版本并恢复上一条可安装的全量版本。原生配置错误不能依赖 OTA 修复。
