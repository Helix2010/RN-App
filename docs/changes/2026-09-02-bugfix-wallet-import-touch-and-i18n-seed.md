# Bugfix: wallet-import-touch-and-i18n-seed

状态：Completed

## 用户场景与现状证据

- 用户/角色：通过助记词或私钥导入自托管钱包的用户。
- 当前行为或复现：导入按钮在键盘打开时首次点击可能只收起键盘，且异步导入期间缺少明确 loading 反馈；RN-App 当前 seed 有 748 个 UI key，而 RN-Server 历史迁移仅覆盖约 119 个。
- 代码调用链：WalletImportScreen → PageScroll/TextField → ActionButton → wallet.importMnemonic/importPrivateKey；RN-App i18n seed → RN-Server language_document 全局 seed。
- 非目标：不改变助记词派生算法、私钥存储格式、钱包会话协议或租户自定义文案。

## Given / When / Then

1. Given 助记词有效且键盘打开，When 用户点击导入按钮任意位置，Then 一次点击提交导入并显示处理中状态。
2. Given 导入正在进行，When 用户重复点击，Then 只执行一次导入。
3. Given 当前 RN-App UI seed，When RN-Server 执行迁移，Then 全局 language_document 至少具备两种语言的完整 key 集合，且不覆盖租户覆盖项。

## UI 与交互状态

- loading / empty / content：按钮正常、处理中、成功返回；无效助记词继续就地提示。
- error / timeout / offline：导入失败保留输入并显示可修复原因；多语言迁移失败不得半提交。
- 重复提交 / 取消 / 返回：in-flight ref 锁定同一导入意图；键盘点击交给按钮；返回行为不变。
- light / dark / 字体放大 / 无障碍：按钮整块命中、Spinner、busy/disabled 状态和触控目标符合设计系统。

## 技术影响

- API/OpenAPI：无变更；语言 seed 由服务端 migration 写入全局 language_document。
- 状态与本地数据：不新增钱包事实源；新增 RN-Server embedded seed 文件和只向前迁移。
- 钱包/签名/链/金额精度：
- 权限、隐私与遥测：继续使用屏幕保护；不记录助记词/私钥；不新增权限。
- OTA 或全量更新：按钮和文案可 OTA；`expo-screen-capture` 已属原生依赖，当前只修 JS 交互，发布包仍建议沿用 APK 基线。

## 验证与发布

- 修复前失败测试或需求测试：补充导入 loading、重复点击和完整 locale seed 测试。
- iOS / Android：执行 RN-App `pnpm check`；钱包导入关键路径需 Development Build 回归。
- 灰度指标与停止条件：导入重复执行、输入丢失、seed 缺 key、迁移覆盖租户文案时停止发布。
- 回滚：回退 App UI 变更；服务端 migration 只补全局缺失 key，可回滚代码但不删除已补齐文案。

## 实际交付验证

- RN-App：`pnpm check` 通过（65 个测试套件、440 个测试；i18n seed 748 keys × 2 locales）。
- RN-Server：`gofmt`、`go test -race ./...`、`go vet ./...`、`go build ./cmd/server` 通过。
- 未运行：iOS/Android Development Build 真机触控回归；未在真实生产数据库执行 migration 28。
