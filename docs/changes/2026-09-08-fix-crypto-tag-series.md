# 预测市场 crypto 标签为空

日期：2026-09-08

## 现象

网页版 Crypto 分类有内容，App 的 Crypto 标签显示"暂无数据"。

## 原因

dev 平台 crypto 标签（id 430）下的活跃事件全部是周期市场的单期事件（btc-updown 5m / 15m / 1h）。App 与网页版一样在
列表请求里 `exclude_tag_slug=recurring`，排除后为空；网页版在 Crypto 分类下另外渲染周期系列卡（`app/markets/_content.tsx`
`loadRecurringSeries`：type 为 all / crypto 且没有搜索词），App 之前只在默认标签下渲染系列卡。

## 修复

- `market-list-screen.tsx`：系列卡的显示条件改为"交易中 + 非收藏 + 无搜索词 + （默认标签 或 所选标签 slug 为 crypto）"，
  与网页版一致；系列卡已是内容时不再显示"暂无数据"；`useSeriesList` 的 `enabled` 随之调整，其它标签仍不请求。
- 精选轮播与榜单仍只在默认标签下显示。

## 验证

- `market-list-screen.spec.tsx` 新增：crypto 标签下列表为空时仍显示周期系列卡，不显示"暂无数据"；体育标签不显示系列卡。
- 模拟器：见下方记录。
