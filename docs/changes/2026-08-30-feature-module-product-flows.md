# Feature: module-product-flows

状态：In Progress

## 用户场景与现状证据

- 用户/角色：不同租户使用不同业务模块组合的 DEX / Predict App 用户。
- 当前行为或复现：服务端与管理端已有 `modules.predict` / `modules.dex` 字段，但 App 只对 `buildAppTabs` 做了纯函数测试；首页快捷入口、模块内容可达性和 Android 边缘返回缺少完整验证。
- 代码调用链：`RN-Admin app-config.modules -> RN-Server mobile-bootstrap.modules -> FoundationRuntimeProvider -> AppShellScreen -> buildAppTabs / module pages`。
- 非目标：本轮不接入真实预测撮合、链上 RPC、钱包签名或行情 WebSocket。

## Given / When / Then

1. Given Predict + DEX，When Bootstrap 成功，Then 底栏显示“首页 / 预测 / DEX / 资产”，首页显示两类模块入口。
2. Given 仅 Predict，When Bootstrap 成功，Then 底栏显示“首页 / 预测 / 持仓 / 资产”，DEX 快捷入口、DEX 资产账户和 DEX 区块隐藏。
3. Given 仅 DEX，When Bootstrap 成功，Then 底栏显示“首页 / 行情 / 兑换 / 资产”，Predict 快捷入口、预测资产账户和预测区块隐藏。
4. Given 用户在任意二级页或模块 Tab，When 从屏幕左/右边缘向内滑动，Then 返回上一级；在非首页 Tab 时回到首页；首页边缘返回不退出到后台。
5. Given 用户点击首页模块快捷入口或区块标题，When 模块启用，Then 进入对应模块 Tab；禁用模块的入口不可达。

## UI 与交互状态

- loading / empty / content：Bootstrap skeleton 后按模块组合渲染；切换配置后失效 Tab 自动回首页。
- error / timeout / offline：沿用 Bootstrap 失效门禁和安全缓存；不在客户端自行猜测模块状态。
- 重复提交 / 取消 / 返回：模块入口不重复请求；边缘返回和系统返回共用 `resolveAppShellBack` / navigation stack。
- light / dark / 字体放大 / 无障碍：Tab、快捷入口和列表行暴露 label/selected；模块隐藏时不留下空占位。

## 技术影响

- API/OpenAPI：无字段变更，继续使用 Bootstrap `modules`。
- 状态与本地数据：Tab 为页面本地状态；`isAppContentAvailable` 和 `resolveBottomTab` 统一模块可达性，不新增状态源。
- 钱包/签名/链/金额精度：无影响，内容仍为 Mock vertical slice。
- 权限、隐私与遥测：无新增权限；边缘手势不采集触点数据。
- OTA 或全量更新：模块菜单、页面编排和边缘手势为 JS，可 OTA；关闭 Android predictive-back 是原生配置变化，必须全量 APK。

## 验证与发布

- 修复前失败测试或需求测试：已补齐模块可达性、组合 Tab 映射和双向边缘滑动单元测试。
- iOS / Android：`pnpm check` 通过（58 tests）；Android 模拟器已验证双模块首页和个人中心主路径。边缘手势逻辑单测通过；完整原生 APK 构建受本机离线 Maven 依赖阻塞，三种远程模块组合与真机手势仍待验证。
- 灰度指标与停止条件：监控 Bootstrap 模块组合与首屏 Tab 分布；若出现禁用模块仍可达或 Tab 为空，停止发布。
- 回滚：回退本变更；服务端关闭模块开关即可先隐藏对应入口，原生 predictive-back 配置回滚需全量包。
