# 滚动折叠导航 + 首页热门预测横滑可感知

日期：2026-09-09 · 设计：`docs/design/collapsing-header-2026-09-09.md`

## 需求

事件详情滚动后标题没了、导航只剩分类；其它页面同样没有"滚下去之后最需要看到的那一条"常驻。首页热门预测一张卡占满整行，看不出能横滑。

## 预期行为

- **事件详情**：滚过标题块后导航中间交叉淡入"图标 + 标题"（单行省略），分类小字淡出，导航底部出现 1px 细线；滑回顶部恢复。点紧凑标题回到顶部。
- **周期市场系列页**：滚过所选期卡后导航显示"标题 + 窗口 · 倒计时 · 当前价"（颜色 = 当前价相对参考价的方向），倒计时继续走。
- **DEX 代币详情**：滚过价格块后导航副标题从"名称 · 链"换成"价格 + 24h 涨跌"。
- **预测列表 / DEX 行情**：分类 / 链 chip 行滚过后作为悬浮条钉在顶部；预测列表悬浮条右侧放大镜回到搜索框。
- **首页 / 资产页**：总资产滚走后悬浮条显示"资产 · 总额"（隐藏余额时 ••••••）；首页未登录不显示悬浮条。
- **首页热门预测**：下一张卡露出 44px，下方有页点（当前页加长），"查看全部 ›"保留。
- 过渡全部由滚动位置插值驱动（UI 线程），无状态切换；紧凑内容对读屏隐藏。

## 改动

| 层 | 内容 |
| --- | --- |
| 设计系统 | 新 `CollapsingHeader`（nav / floating 两种模式、`CollapseAnchor` 阈值标记、`footer` 槽、兼容 refresh / scrollRef / scrollEnabled）；`SnapCarousel` 增 `peek` / `showDots` |
| 页面 | 事件详情、系列页、代币详情（nav 模式）；预测列表、DEX 行情、首页、资产页（floating 模式） |
| 测试桩 | reanimated 替身补 `useAnimatedReaction`（惰性）与带 `scrollTo` 的 `ScrollView` |

`ScreenHeader` / `PageScroll` 保留给标题固定的页面。

## 开关

不涉及模块开关：预测页面本就在 `ModuleGate` / 预测页签内，首页热门预测分区原本就按 `modules.predict` 渲染。

## 风险

- 阈值靠 `CollapseAnchor` 的 onLayout，必须是内容容器的直接子元素；放深了 y 就不对。七个页面都核对过位置。
- 悬浮条在折叠前 `pointerEvents: none`，不拦手势；折叠后覆盖内容顶部 48px + 状态栏，内容顶部本就是滚走的身份区。

## 事故：rev 16 启动白屏 / 崩溃（已修，rev 17）

- **现象**：rev 16（immediate）装上后首页白屏；之后每次启动崩溃退出。
- **根因**：`headerProgress` 是 worklet，默认参数引用了模块常量 `COLLAPSE_DISTANCE`；Reanimated 不会把默认参数里的外层常量捕获到 UI 线程，
  运行时 `ReferenceError: Property 'COLLAPSE_DISTANCE' doesn't exist`。jest 的 reanimated 替身在 JS 线程执行，测不出来。
- **为什么没有自动回退**：`app.config.ts` 里 `checkAutomatically: "NEVER"`（OTA 由 JS 侧自己检查）。首次白屏时 JS 没有崩溃，10 秒后 expo-updates 把 rev 16
  记为"成功启动"，之后的崩溃就不再回退；崩溃时 ErrorRecovery 想拉新包但立刻放弃（异常来自 worklet 运行时的原生线程）。
  JS 侧的 OTA 检查在崩溃前 0.4 秒才开始，来不及下载 rev 17。
- **恢复**：rev 17 修复并 immediate 发布；已装 rev 16 的设备只能清应用数据（回到内置包后自动拉 rev 17）或重装。
- **规则（写进本文档与记忆）**：worklet 内只用字面量与传入参数，不引用模块常量；带 reanimated 改动的 OTA 先在模拟器跑一遍再发。
- **建议（需要出全量包，待你定）**：`checkAutomatically` 改为 `ON_ERROR_RECOVERY`——只在崩溃恢复时由原生侧拉新包并重启，与 JS 侧检查不冲突，
  是这类事故的标准兜底。

## 验证

- `collapsing-header.spec.tsx`：插值区间、展开 / 紧凑态可见性与读屏隐藏、floating 无内容不渲染。
- 现有页面用例不变（紧凑复本对默认查询不可见，不会出现"多个元素"）。全量 jest 107 套 738 例、lint、typecheck、format 通过。
- 模拟器（anyfun → prax1s dev，rev 17）：首页热门预测下一张露边 44px、页点随翻页切换；预测列表滚过后分类 chip 行钉住 + 放大镜，从钉住行切分类正常；
  事件详情滚过标题块后导航交叉淡入"图标 + 单行标题"，收藏 / 状态徽章位置不变，细线出现，滑回顶部恢复；系列页折叠后导航显示
  "标题 + 窗口 · 倒计时 · 当前价"并按涨跌着色。首页 / 资产页的"资产 · 总额"悬浮条与 DEX 代币详情的价格折叠未在真机核对（模拟器清数据后是访客态；DEX 页见 rev 18 记录）。
- rev 18（next_launch）：悬浮条里的 chip 被横向滚动容器纵向拉伸——`HorizontalScroll` 子项改为纵向居中。

## 发布

- OTA rev 16 `ota_Uu9opkduHjForx_PUyqp5g`（immediate，f8b7610）：**坏包**，见上文事故。
- OTA rev 17 `ota_HlTsFQi9QdkT3fHoOwF3Xw`（immediate，4bfbb17）：修复。
- OTA rev 18 `ota_x6_acJGmcv0ad0sf2kcoAg`（next_launch，467ccf7）：chip 拉伸修正；模拟器核对 DEX 行情页钉住链筛选（chip 高度正常）、代币详情折叠后导航显示"UNI / $10.62 −0.60%"。
