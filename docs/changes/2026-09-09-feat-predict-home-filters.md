# 预测市场首页筛选重构（2026-09-09）

- 类型：feat · 模块：predict（仍受 `modules.predict` 开关约束）· 发布：1.2.11 OTA rev 6 → 7 → 8（均 immediate；见设计文档 §9 末尾）
- 设计：`docs/design/predict-home-filters-2026-09-09.md`（§9 为实施记录）

## 变更

1. 一级分类默认"全部"，后接平台轮播标签与"更多 ▾"（全部 188 个标签的分组面板，可搜索）；非轮播标签选中后插到"更多"左边。
2. 一级标签有 related-tags 时显示二级行（"全部 {tag}" + 子标签）；crypto 的二级（5M/15M/1H/4H/Daily）同时过滤周期系列卡。
3. "交易中 / 已结束 / 全部"与排序从两行 chip 改为两个下拉；非默认值时下拉高亮、列表上方出现"已筛选：… · 清除"横幅。
4. 收藏改为开关（显示数量），开启时分类行置灰。
5. 搜索改为服务端全站搜索（≥2 字符）：筛选行与策展收起，先列命中标签再列市场，支持分页；取消回到原筛选。
6. 分类下为空时显示空分类卡（去全部市场 / 看已结束），不再是一句"暂无数据"。
7. 事件列表页大小 20 → 40（与网页版一致）。

## 验证

- `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm i18n:check` 全绿（111 套件 / 775 用例）。
- 模拟器 emulator-5570（anyfun 1.2.11 + OTA rev 6）人工核对：见设计文档 §9 与本文末尾。

## 主题色

新增组件不含色值字面量，全部走 `$primary` / `$color` / `$surfaceVariant` / `$borderColor` 等 token，租户主色配置变化时自动生效。

## 发布记录

| rev | OTA id | 源码 | 内容 |
|---|---|---|---|
| 6 | `ota_e5QtT0J09lSJsJf565LKEw` | 3261388 | 筛选重构主体 |
| 7 | `ota_5Lw0eOiBl3W-5qQ4i5r4HA` | 52cacae | 搜索计数 / 防抖 / 空态图标 / 周期市场空标题 |
| 8 | `ota_L1CHA9UBaMeuqdIX9aztKQ` | 6fd6121 | 弹层顶部安全区 / 0–9 分组 / 取消收键盘 |
