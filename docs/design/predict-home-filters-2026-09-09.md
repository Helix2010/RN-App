# 预测市场首页：分类 / 二级筛选 / 全部与分页 —— 分析与重构方案

日期：2026-09-09 · 状态：分析稿，待确认 §6 · 范围：RN-App `market-list-screen.tsx`、网关 `listTags / listEvents`、平台 gamma `/tags`

## 1. 现状（App）与问题

| 现状 | 问题 |
| --- | --- |
| 分类 chip = 平台 `is_carousel` 标签（Politics / Crypto / 足球 / 伊朗 / Finance…），默认选第一个 | **没有"全部"**：不选任何标签的视图不存在，用户看不到未被这些标签覆盖的事件；默认落在 Politics 而不是全站热门 |
| 事件列表只请求一页（`limit 20`），没有翻页 | **只能看到前 20 个事件**（已在本轮修复：滚到底自动翻页） |
| 一级标签下没有二级筛选 | 网页版每个一级分类有动态二级标签（`/tags/{id}/related-tags/tags`，如 Crypto → Bitcoin / Ethereum / Solana…；天气 → 城市 / 温度…），App 无法收窄到子类 |
| 状态：交易中 / 已结束 / 全部 / ★ 收藏 混在一行 | "全部"在这里是状态维度（不过滤状态），容易被误读成"全部分类"；收藏是视图不是状态 |
| 排序一行 5 个 chip 常驻 | 排序是低频操作，占了首屏一整行 |
| 搜索是本地过滤当前页 | 搜索只能搜到已加载的一页，不是全站搜索（网页版 `q` 参数走服务端 + 加倍分页） |

## 2. 网页版参考（pm-cup2026 `apps/user-dapp/src/app/markets/_content.tsx`）

- URL 即筛选状态：`type`（all / recommended / favorites / sports / crypto / ai）、`tag`、`parentTag`、`status`（active / all / closed）、`sort`、`q`。
- 一级分类 = `type`（固定几个）+ `tag`（平台标签）；选中一级标签后加载二级标签 `getRelatedTags(parentTag)`，桌面端左侧栏、移动端一行横滑 chip，首项"全部市场"（= 只按父标签过滤）。
- 标签全集 `getTags({limit: 100, order: 'label'})`，不是只取轮播标签。
- 分页：`PAGE_SIZE 40`，offset 累加，`hasMore = 返回数 ≥ limit`；周期系列独立分页并与事件去重。
- 搜索走服务端 `q`，分页放大一倍。

## 3. 用户要完成的事

| 路径 | 要求 |
| --- | --- |
| A 逛：看今天大家在押什么 | 进页就是全站热门，不被某个分类截断；运营位（精选 / 榜单）在这里 |
| B 找：我关心加密 / 某场比赛 | 一级分类一步可达，二级（Bitcoin / 某联赛）一步可达，结果不被 20 条截断 |
| C 搜：知道名字 | 全站搜索，结果可翻页 |
| D 回：看已结束或我收藏的 | 状态与收藏是"视图切换"，不该和分类混在一起 |

## 4. 方案

### 4.1 信息架构

```
[搜索框]                                    ← 全站搜索（服务端 q），聚焦后收起其它筛选
[全部] [Politics] [Crypto] [足球] [伊朗] [Finance] … [更多 ▾]   ← 一级：固定"全部"在最前 + 轮播标签；"更多"打开全部标签面板（按字母分组，可搜）
[全部 Crypto] [Bitcoin] [Ethereum] [Solana] …      ← 二级：仅选中一级标签时出现，来自 related-tags，首项"全部 <一级>"
                                    [交易中 ▾] [成交量 ▾] [★]   ← 状态 / 排序收成两个下拉 + 收藏开关，一行放完
精选 / 榜单 / 周期市场（仅"全部" + 交易中 + 无搜索时）
事件列表（滚到底翻页，脚注四态）
```

- **"全部"是默认**：不带 `tagId` 请求（网页 `type=all`），运营位只在这个视图出现；切到任何一级标签后运营位收起，把屏幕留给列表。
- **二级筛选**：`GET /tags/{id}/related-tags/tags`，网关新增 `listRelatedTags(tagId)`；一行横滑 chip，选中二级时请求 `tagId = 二级 id`；返回一级用首项"全部 <一级名>"。无二级标签的一级不显示这一行。
- **"更多"标签面板**：`GET /tags?limit=100&order=label`，底部抽屉，按首字母 / 拼音分组，顶部搜索；选中后该标签临时插入一级 chip 行（选中态），与轮播标签并存，保证"我选的"始终可见。
- **状态 / 排序下拉**：两个 `Select` 样式的 chip（"交易中 ▾""成交量 ▾"），点开底部单选面板；收藏改为独立开关 chip（★），选中时列表只显示收藏且忽略分类。
- **搜索**：走服务端 `q`（gamma `/events?q=`；网关 `EventQuery.search`），有搜索词时隐藏运营位与周期市场，分页 limit 40；本地过滤仅用于收藏视图。
- **分页**：事件 `limit 20` → 40（与网页一致），滚到底自动翻页（已接 `onEndReached`）；脚注四态；下拉刷新回第一页。
- **周期市场**：仍在"全部"和 Crypto 一级下显示；选中 Crypto 的二级（如 Bitcoin）时按 slug 过滤系列（btc-*）。

### 4.2 状态与 URL 语义（便于深链 / 从首页"查看全部"进入）

`{ tag: string | null, parentTag: string | null, status: "trading" | "closed" | "all", sort, q, favorites: boolean }`
首页"查看全部 ›"、榜单"查看全部"、系列卡都用同一组参数进入，后退保留筛选。

### 4.3 页面收益

- 首屏筛选从 3 行 12 个 chip 压到 2 行（一级 + 状态/排序/收藏），二级只在需要时出现。
- 默认视图覆盖全站，不再"默认 Politics"。
- 结果集完整（服务端搜索 + 翻页），与网页版一致。

## 5. 改动清单

| 层 | 改动 |
| --- | --- |
| 网关 `gateway.ts` / `http-predict-gateway.ts` / mock | `listAllTags()`、`listRelatedTags(tagId)`、`EventQuery.search`；`listEvents` 支持 `q` |
| `core/predict-platform/gamma.ts` | `fetchTags({limit,order})`、`fetchRelatedTags(id)`、events `q` 参数 |
| `market-list-screen.tsx` | 一级"全部"默认、二级 chip 行、更多标签抽屉、状态/排序下拉、收藏开关、服务端搜索、limit 40 |
| design-system | `FilterSelect`（下拉 chip + 底部单选面板）、`TagPickerSheet` |
| 文案 | 全部 / 全部 {tag} / 更多分类 / 搜索标签 / 状态 / 排序 等约 10 键 |
| 测试 | 网关映射、二级切换、全部默认、搜索翻页 |

预计一天半；纯 JS，OTA 发布。

## 6. 需要确认

1. 默认视图改为"全部"（推荐），还是维持平台轮播第一个标签？
2. 状态 / 排序改为两个下拉（推荐），还是保留 chip 行但折叠到"筛选"按钮里？
3. 搜索改为服务端全站搜索（推荐）；平台 gamma `/events?q=` 若不可用则退回本地过滤并提示"仅搜索已加载结果"——需要我先探平台接口确认。
4. "更多"标签面板是否需要（轮播标签之外的标签用户能否直接选）；不需要就只做一级 + 二级。

## 7. 本轮已顺手修复（rev 5）

- 事件列表滚到底自动翻页（`usePredictEventPages` + `CollapsingHeader.onEndReached`），脚注：正在加载更多 / 上滑加载更多 / 已显示全部 N 个市场 / 加载失败 · 重试。
- 启动页：背景图与 logo 二选一（背景图已缓存或加载完成 → 只画背景图；否则 logo + 标题）。
- 清理未用文案键：`predict.series.viewDetail / earlier / more`、`home.quick.help`。
