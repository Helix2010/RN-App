# 预测市场精选 / 榜单 / 周期市场操作与首页布局优化

日期：2026-09-09 · 设计：`docs/design/predict-discovery-polish-2026-09-09.md` · 提交：35b330f、6388ec1 · OTA：1.2.11 基线 rev 3 `ota_n78byKF9IgAp8PaEEJGwlQ`、rev 4 `ota_1RXbSEd0k_qYfoj4kchdLQ`（均 immediate）

## 需求

用户反馈：预测页精选横滑交互没做好、推荐位 UI 与交互差、周期市场"查看详情 / 加载更早"按钮丑、首页顶部搜索框与卡片间距乱。

## 改动

见设计文档 §3–§5、§9、§10。要点：精选改吸附轮播海报卡；四个榜单合并为单区块 tab 并去重；期卡按钮层级重整（主 / 次 / 文字链）；历史窗口自动翻页、按日分组、结算变动额；首页间距与快捷入口整理，悬浮模式补状态栏底色，折叠过渡不再重叠。

## 开关

不涉及模块开关；预测相关界面仍在 `modules.predict` 下。

## 验证

- jest 109 套 758 例、lint、typecheck、format、i18n:check 通过。
- 模拟器 rn_smoke 1.2.11 + rev 4：首页 / 预测列表 / Crypto 标签 / 系列页逐页截图核对。
- rev 3 上线后发现并在 rev 4 修正：区块间距按 dp 过大且锚点多占一格；轮播 peek 被非当前卡缩放吃掉；精选无报价出现空按钮；历史日期英文。

## 追加：OTA rev 5 `ota_kYHvLobGW0qlFZz07z6iNQ`（RN-App e27d975）

- 事件列表分页：`usePredictEventPages`（useInfiniteQuery + 平台 cursor）+ `CollapsingHeader.onEndReached`；原来只请求第一页 20 条。脚注四态；模拟器 Politics 标签显示"已显示全部 3 个市场"。
- 启动页：背景图与 logo 二选一（已缓存 / 已加载 → 只画背景图；否则 logo + 标题）。模拟器冷启动：原生 splash → 我们的启动页只有背景图与副标题，不再叠 logo。
- 文案：删 `predict.series.viewDetail / earlier / more`、`home.quick.help`；加 `predict.list.*` 四键。
- 首页分类 / 二级筛选 / 全部 / 搜索的重构分析见 `docs/design/predict-home-filters-2026-09-09.md`（待确认 §6）。
