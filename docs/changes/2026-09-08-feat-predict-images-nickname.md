# 预测市场：事件图片与平台昵称

日期：2026-09-08 · 设计：`docs/design/predict-tier4-2026-09-08.md`

## 需求

覆盖文档 §4 第 4 项里决定做的两块：事件 / 市场图片渲染，预测平台昵称。公开主页、体育枢纽、跨链桥本轮不做（理由见设计文档 §1）。

## 现有行为

- gamma 的 `image` / `icon` 已解析但没有渲染。
- 平台昵称（网页版 `WalletButton` 的用户名输入）App 没有入口；排行榜"我"卡只显示地址前两位。

## 预期行为

- 列表卡 / 首页热门预测卡标题左侧 40×40 图标，精选轮播顶部横幅，详情头部 48×48 图标；平台没给或加载失败都不占位。
- 排行榜"我"卡显示平台显示名（昵称 → 化名 → 地址缩写）与头像，登录平台后可点铅笔改昵称；个人页"我的"分组多一行"预测市场昵称"，
  没登录平台时显示"先启用预测账户"并进入启用引导。
- 昵称面板：最长 32 字符，留空 = 清除；保存走 `POST /profiles`（Bearer gamma jwt），读自己的资料走
  `GET /profiles/user_address/{address}`（无缓存头）。

## 开关

图片只出现在预测卡片 / 详情与首页热门预测（后者按 `modules.predict` 隐藏）；昵称入口在排行榜（预测模块内）与个人页按开关渲染的分组里；
`usePredictProfile` 只由这两个入口调用。

## 风险

- 图片域名为华为云 OBS 与 Polymarket S3 公开桶；若正式租户换成需要鉴权的存储，图片会加载失败并被隐藏，不影响其它内容。
- 昵称修改需要平台登录态；`ensureJwt` 过期会先刷新再登录（与其它需要 jwt 的操作相同）。

## 验证

- `profile.spec.ts`：按地址读资料不带鉴权、改昵称带 Bearer 且 body 只含 name、超长在本地拒绝。
- `http-predict-gateway.spec.ts`：`image` / `icon` 映射（空串 = null）。
- `market-list-screen.spec.tsx`：只有带图标的事件渲染图标。
- `leaderboard-screen.spec.tsx`：显示化名、登录后改昵称、未登录无编辑入口。
- 全量 jest / lint / typecheck / format 通过。
- 模拟器：见设计文档 §5 的记录。
