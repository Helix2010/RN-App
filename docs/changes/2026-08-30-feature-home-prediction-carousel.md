# Feature: home-prediction-carousel

状态：Completed

## 用户场景与现状证据

- 用户/角色：在首页快速浏览热门预测市场的 App 用户。
- 当前行为或复现：设计稿使用首卡完整、下一卡露出的横向轮播，并在滑动结束后按卡宽吸附；当前实现只是普通横向 ScrollView，可停在任意位置，缺少继续浏览提示。
- 代码调用链：`FoundationHomeScreen -> SnapCarousel -> PredictionHomeCard`。
- 非目标：不改预测市场数据、详情路由或真实下单接口。

## Given / When / Then

1. Given 首页存在多个热门预测，When 首次展示，Then 首卡完整显示且下一卡露出一部分。
2. Given 用户左右拖动，When 手指释放，Then 列表按卡宽和固定间距吸附到最近卡片。
3. Given 用户快速滑动，When 动量结束，Then 每次只按稳定分页距离移动，不停留在半卡位置。

## UI 与交互状态

- loading / empty / content：沿用首页内容状态；少于两张卡时保持普通首卡布局。
- error / timeout / offline：无新增网络行为。
- 重复提交 / 取消 / 返回：滑动不触发重复请求，不改变返回状态机。
- light / dark / 字体放大 / 无障碍：卡片继续使用主题令牌；容器暴露 adjustable role 和滑动提示。

## 技术影响

- API/OpenAPI：无影响。
- 状态与本地数据：无新增状态源。
- 钱包/签名/链/金额精度：无影响。
- 权限、隐私与遥测：无影响。
- OTA 或全量更新：纯 JS 布局交互，可 OTA。

## 验证与发布

- 修复前失败测试或需求测试：以用户提供的原设计截图和普通 ScrollView 实现作为差异证据。
- iOS / Android：`pnpm check` 通过；Android Bundle 导出和测试 APK 安装通过。手工重封装包不用于验证矢量图标资源，只验证轮播布局与交互逻辑。
- 灰度指标与停止条件：若卡片遮挡、无法纵向滚动或吸附距离错误则停止 OTA。
- 回滚：恢复 `HorizontalScroll` 调用；无数据迁移。
