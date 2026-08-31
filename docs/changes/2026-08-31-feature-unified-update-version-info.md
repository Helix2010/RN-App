# Feature: unified-update-version-info

状态：Completed

## 用户场景与现状证据

- 用户/角色：需要检查并执行 App 更新的终端用户。
- 当前行为或复现：设置/关于页点击检查更新会进入 UpdateCenter；升级中心同时平铺版本策略、OTA、全量和诊断信息。启动页偶尔显示内置 Logo 而非租户品牌资源；热门预测轮播首尾边界留白不稳定；二级页面返回按钮带常驻圆形外框。
- 代码调用链：设置/关于 → Runtime refresh → `/v1/mobile/bootstrap`；全量更新 → APK download/install；OTA → expo-updates；启动品牌 → Bootstrap branding → cache/remote asset → LaunchScreen；热门预测 → SnapCarousel。
- 非目标：不新增版本检查 API，不改变 APK 签名/安装器、Expo OTA Manifest 协议、钱包业务或服务端发布状态机。

## Given / When / Then

1. Given 用户在设置或关于页，When 点击检查更新，Then 当前页直接请求 Bootstrap，不发生 UpdateCenter 导航。
2. Given 检查发现 APK 或 OTA 候选，When 用户确认，Then 统一升级执行层按候选类型执行对应流程；强制更新不可跳过。
3. Given 用户点击版本信息，When 信息层打开，Then 只显示去重后的版本字段，不展示升级中心页面。
4. Given 后端返回有效租户品牌资源，When 启动页加载，Then 优先显示经过完整性校验的租户资源；失败时安全回退并可诊断。
5. Given 热门预测有多张卡片，When 首张或末张吸附，Then 卡片与实际容器边缘对齐；单卡片时占满内容宽度。

## UI 与交互状态

- loading / empty / content：检查中、最新、发现 APK、发现 OTA、无更新和版本信息展示均有明确状态。
- error / timeout / offline：保留上次有效配置，就地显示可重试错误；更新执行失败不得阻塞 embedded App。
- 重复提交 / 取消 / 返回：协调器 single-flight；软更新可稍后，强制更新不可关闭；下载与应用状态可重试。
- light / dark / 字体放大 / 无障碍：全局弹层、版本信息、ScreenHeader、SnapCarousel 使用设计令牌并保留可访问标签和触控区域。

## 技术影响

- API/OpenAPI：复用 `/v1/mobile/bootstrap`，不增加接口；APK 与 OTA 仍使用各自底层协议。
- 状态与本地数据：新增统一升级协调状态；保留既有更新提示节流和品牌资源缓存，不建立第二版本事实源。
- 钱包/签名/链/金额精度：
- 权限、隐私与遥测：不新增权限；诊断仅记录脱敏 request/asset/update identity。
- OTA 或全量更新：JS/UI 可 OTA；若触及原生安装或手势配置，需全量构建验证。

## 验证与发布

- 修复前失败测试或需求测试：覆盖手动检查不导航、APK/OTA 优先级、强更阻断、版本信息去重、品牌资源回退、轮播首尾对齐和返回按钮。
- iOS / Android：RN-App `pnpm check`、Android Debug APK 构建/安装和 Metro 启动验证已完成；iOS Development Build、真实 APK 下载/安装和真实 OTA 应用尚未运行。
- 灰度指标与停止条件：观察检查成功率、升级执行失败率、强更绕过、品牌资源加载失败和导航/轮播崩溃；出现强更可绕过或错误安装立即停止。
- 回滚：回退 App JS/UI；服务端语言迁移只新增兼容 key，不删除旧 key；APK/OTA 发布状态不回滚代码外的事实数据。

## 本次实现与验证记录

- RN-App：`pnpm check` 通过（36 suites / 162 tests）；新增关于页版本检查测试和 APK/OTA 计划解析测试。
- RN-Server：`gofmt`、`go test ./...` 通过（新增 migration 24：`update.versioninfo`）。
- RN-Admin：`pnpm check` 通过（7 files / 36 tests / production build）。
- Android：`./gradlew app:assembleDebug` 通过，Debug APK 安装成功；Metro bundle 成功加载，当前模拟器未连接 RN-Server，因此展示配置失败保底页。
- 已知非阻塞警告：Jest 中 Expo Notifications 的 Expo Go 提示和部分既有 act 警告；未影响测试结果。
