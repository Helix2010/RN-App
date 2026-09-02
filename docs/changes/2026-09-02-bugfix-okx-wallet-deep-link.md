# Bugfix: okx-wallet-deep-link

状态：Implemented（待真实 WalletConnect 批准回归）

## 用户场景与现状证据

- 用户/角色：Android 上使用欧易大陆版连接 AnyFun 的用户。
- 当前行为或复现：点击 OKX Wallet 后 AnyFun 持续显示“正在打开”，欧易只进入 Web3 钱包首页，没有出现 WalletConnect 确认页，也没有建立会话。
- 设备证据：Pixel7 Android 15 arm64 模拟器安装欧易官方 `com.okinc.okex.gp` 6.187.1；`okex://main/wc?uri=<wc-uri>` 能启动欧易，但前台最终是 `DefiWalletMainActivity` 普通首页。APK 内部 WalletConnect 链接常量为 `okex://main/wc?requestId=` 与 `okx://main/wc?requestId=`。
- 代码调用链：`ConnectWalletSheet -> useWalletLogin.connect -> EmbeddedWalletGateway.connect -> WalletConnectConnector.connect -> openWalletOrFallback -> Linking.openURL -> approval()`。
- 非目标：不改变 WalletConnect projectId、服务端 bootstrap、SIWE、MetaMask/Trust 的现有链接格式，不重构整个连接状态机。

## Given / When / Then

1. Given 已安装欧易大陆版 When 点击 OKX Wallet Then 使用欧易当前识别的 `requestId` 深链进入 WalletConnect 配对，而不是只打开钱包首页。
2. Given 欧易支持 `okex` 或 `okx` scheme When 第一个入口无法被系统打开 Then 继续尝试另一个欧易入口。
3. Given 安装的是独立 OKX Wallet When 大陆版入口都不可用 Then 保留 `okxwallet://main/wc?uri=` 兼容入口。
4. Given 三个 OKX 入口都不可用 When 用户点击连接 Then 继续使用既有二维码兜底。

## UI 与交互状态

- loading / empty / content：沿用连接列表和“正在打开 OKX Wallet”状态；成功后进入既有签名确认页。
- error / timeout / offline：入口无法打开时进入二维码；钱包未批准时沿用 120 秒超时反馈。
- 重复提交 / 取消 / 返回：busy 状态继续阻止重复点击，二维码关闭继续取消 pending approval。
- light / dark / 字体放大 / 无障碍：没有视觉结构或文案布局变化。

## 技术影响

- API/OpenAPI：无变化。
- 状态与本地数据：无变化，不迁移已有 WalletConnect 会话。
- 钱包/签名/链/金额精度：只修正 OKX 配对入口；namespace、账户解析、签名请求不变。
- 权限、隐私与遥测：Android package visibility 增加 `okx` scheme；不增加权限，不记录 wc URI。
- OTA 或全量更新：JS 深链修正可 OTA；Android `<queries>` 增加 `okx` scheme 需要新的全量 APK 才能让 `canOpenURL(okx://...)` 的安装探测可靠。唤起本身不依赖探测。

## 验证与发布

- 修复前失败测试或需求测试：更新 `walletconnect-client.spec.ts`，要求欧易入口使用 `requestId` 且包含 `okx` fallback；旧实现失败。
- iOS / Android：Android 15 arm64 模拟器安装欧易 6.187.1、MetaMask 8.9.0、Trust Wallet 26.33.14。欧易注册 `okex/okx/wc`，MetaMask 注册 `metamask/wc`，Trust 注册 `trust/wc`；三者的候选 URI 都能被 Android 路由到各自前台 Activity。无推送 Release 验证包构建成功，APK Manifest 与 JS bundle 均包含新的 OKX 入口。三个钱包均未在模拟器创建账户，因此未执行批准连接与签名；iOS 未改变且当前环境没有完整 Xcode/simctl。
- 灰度指标与停止条件：观察 OKX connect timeout/failed 提示与成功进入签名确认页；若连接超时增加则回滚。
- 回滚：恢复旧的 OKX pairing/launch 列表并移除 Manifest `okx` query；不会影响服务端或本地数据。
