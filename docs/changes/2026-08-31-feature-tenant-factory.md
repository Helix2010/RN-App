# 租户工厂：逐租户域名、包名与桌面图标

- 状态：In Progress
- 日期：2026-08-31
- 依据：`UI/docs/rn-implementation-plan.md` §7（SaaS 多租户：各自域名、各自打包，Logo / 启动页来自租户服务端）

## Given / When / Then

- Given `tenants/<slug>/tenant.json`（slug / appName / scheme / androidPackage / iosBundleId / apiBaseUrl / applicationId / iconBackgroundColor）When 运行 `pnpm tenant <slug> --pull-branding --env-file` Then：
  - `GET <apiBaseUrl>/v1/mobile/bootstrap` 读取租户 branding，把 launch logo 下载为 `assets/tenants/<slug>/icon.png` 与 Android 自适应前景；按 `iconBackgroundColor` 生成纯色背景 PNG；缺 logo 时复制仓库默认图标，保证文件齐全；
  - 写 `.env.tenant`：`EXPO_PUBLIC_TENANT*`、`EXPO_PUBLIC_API_BASE_URL`、`EXPO_PUBLIC_APPLICATION_ID`、渠道变量。
- Given `EXPO_PUBLIC_TENANT=<slug>` 及配套变量 When `expo prebuild` / `eas build` Then `app.config.ts` 输出该租户的 name / slug / scheme / 包名 / Bundle ID / 图标路径（只读 env，不读文件系统）。
- 运行期：App 内 Logo（关于页、启动页）继续由 RN-Server branding 动态下发；桌面图标是同一 logo 在打包期的导出。

## 验证

- `pnpm tenant anyfun --pull-branding --env-file`（2026-08-31）：从 `https://api.anyfun.win` 拉到 `brand_ix3hLDAVuQznF0mA9lLpcw`（2.7 MB PNG）→ `assets/tenants/anyfun/`；`expo config --type public` 显示 `bundleIdentifier: com.anyfun.foundation`、`foregroundImage: ./assets/tenants/anyfun/android-icon-foreground.png`。✅
- 未做：本轮未用租户资产重新出包（图标变更需要 `expo prebuild --clean`）；logo 非正方形时需在服务端裁切或在脚本中处理（当前原样使用）；iOS 侧 Bundle ID 变更需对应证书。
- 生成物 `assets/tenants/` 与 `.env.tenant` 已加入 `.gitignore`，只提交 `tenants/<slug>/tenant.json`。
