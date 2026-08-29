# Feature: product-grade-web3-app-shell

状态：Completed

## 用户场景与目标

- 用户：使用 AnyFun DEX/Web3 App 查看资产、行情、账户设置和应用升级。
- 目标：从测试页式布局升级为正式钱包/交易产品的信息架构，参考主流交易 App 的层级、留白、资产隐私和高效操作习惯，不复制第三方品牌。
- 约束：所有颜色、间距、圆角、阴影和文字继续使用设计系统/远程主题令牌；不增加没有服务端支持的交易动作。

## Given / When / Then

1. Given 用户进入首页，When 页面加载完成，Then 资产总览是唯一视觉主焦点，余额可隐藏，设置入口可从顶部访问。
2. Given 用户进入资产页，When 查看持仓，Then 总资产、摘要指标和持仓行按稳定层级展示，行内容不依赖嵌套默认按钮样式。
3. Given 用户进入个人中心，When 查看偏好和身份，Then 身份卡、偏好入口、升级入口和安全信息分组清晰，并保持可点击区域一致。
4. Given 用户切换 light/dark 或远程主题，When 页面重绘，Then 新增组件只使用语义主题令牌，不出现固定品牌色或主题错配。
5. Given 用户使用 Android 系统返回或左右边缘返回，When 页面处于二级页面/Tab，Then 返回行为沿用统一导航栈，不被页面视觉层抢占。

## 实现范围

- 设计系统增加 `HairlineCard`、`IconButton`、`ListRow`，统一卡片和列表交互。
- 默认 Card 去除厚重边框，使用轻量层级阴影；需要边界的行情/安全区使用 HairlineCard。
- 首页增加余额显隐、顶部设置入口和更清晰的资产/行情/安全层级。
- 资产页持仓改为统一 ListRow；个人中心改为身份主卡和统一列表行。
- 保留既有多语言、远程主题、刷新、升级、无障碍和返回行为。
- 首页发现全量升级后通过 typed navigation 参数进入统一确认层；仅 Android direct 且开启 `directUpdateEnabled` 时展示 APK 下载入口，避免 iOS/store/关闭能力时出现不可执行的操作。

## 验证

- `pnpm check`：通过。
- Android 原生完整 assemble：本机缺少离线依赖，未完成本次 APK 验证；需在线依赖可用后进行 Development/Release Build。
- light/dark、字体放大和真机手势仍需设备矩阵复测。

## 回滚

- 回退本次提交即可恢复原组件和页面布局；无服务端迁移。
