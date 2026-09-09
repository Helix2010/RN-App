# 预测市场首页：分类 · 二级筛选 · 全部 · 搜索 · 分页 —— 可行性验证与设计方案

日期：2026-09-09 · 状态：可行性已在线验证（§2），设计待确认 §8 · 范围：RN-App `market-list-screen.tsx`、预测网关、design-system；不涉及服务端与模块开关（仍在 `modules.predict` 下）

## 1. 现状问题（App）

| 现状 | 问题 |
| --- | --- |
| 分类 chip = 平台 `is_carousel` 标签（13 个），默认选第一个（Politics） | 没有"全部"视图；默认不是全站热门；未被 13 个标签覆盖的事件无法到达 |
| 一级标签下没有二级筛选 | 网页版有（`/tags/{id}/related-tags/tags`）：Crypto → 5M / 15M / 1h / 4h / Daily；Weather → Temperature / Precipitation / Weather & Science |
| 状态行"交易中 / 已结束 / 全部 / ★ 收藏"，排序行 5 个 chip 常驻 | "全部"在这里是状态维度，易被误读为"全部分类"；收藏是视图不是状态；排序低频却占一整行；筛选共 3 行 12 个 chip |
| 搜索 = 本地过滤已加载页 | 不是全站搜索（网页版 markets 页其实也是本地过滤，但平台有 `/public-search`） |
| 列表只请求第一页 20 条 | **已修（rev 5）**：滚到底自动翻页 |

## 2. 可行性验证（2026-09-09 对 dev 平台 `gamma-api.predict.prax1s.xyz` 实测）

| 能力 | 接口 | 结果 |
| --- | --- | --- |
| 一级标签（轮播） | `GET /tags?is_carousel=true&order=carousel_sort&ascending=true` | 13 个：politics / crypto / football / iran / finance / weather / tech / cybersecurity / cloud-computing / frontend-development / machine-learning / artificial-intelligence / basketball |
| 标签全集 | `GET /tags?limit=500&order=label&ascending=true` | 188 个，全部带 `labelTranslation`；无父子字段，层级只能靠 related-tags |
| 二级标签 | `GET /tags/{id}/related-tags/tags` | crypto(430) → 5m / 15m / 1h / 4h / daily；weather(154) → temperature / precipitation / weather-science；iran(159) → oil；politics / finance / tech / football / basketball → **空** |
| 全部视图 | `GET /events?active=true&closed=false&exclude_tag_slug=recurring&limit=50&offset=0` | 可用；dev 上活跃非周期事件共 **14 个**（offset 50 起为空） |
| 按标签 | `GET /events?tag_id=209&active=true&closed=false` | politics 3 个；`tag_id=430&exclude_tag_slug=recurring` 为 0（crypto 只有周期事件）；`tag_id=490`（5m）返回周期事件；`related_tags=true` 可把子标签事件并入父标签 |
| 服务端搜索 | `GET /public-search?q=trump&limit_per_type=20&events_status=active&page=N` | 返回 `events / tags / profiles / pagination{hasMore,totalResults}`；`page` 分页可用 |
| 分页 | `/events` `limit/offset`；`/public-search` `page` | 可用 |

**结论**：方案里所有能力平台都已具备；二级标签在 dev 上数据稀疏（只有 3 个一级有子标签），设计必须把"没有二级"当常态处理，而不是留一行空白。

## 3. 设计原则

1. **一个问题一个控件**：分类（去哪儿看）、视图（交易中 / 已结束 / 收藏）、排序（怎么排）、搜索（找什么）四件事分开，不在同一行混放。
2. **默认就是全站**：进页看到全站热门 + 运营位；分类是"收窄"，不是"换频道"。
3. **层级只在有内容时出现**：二级行只在当前一级有子标签时渲染；"更多分类"只在标签全集多于轮播时出现。
4. **状态可回溯**：筛选状态是一组参数（§6），首页"查看全部"、榜单、系列卡、通知深链都用它进入；返回保留。
5. **不做廉价替代**：不用原生 `Picker` / `Alert` 当筛选器；不用彩色胶囊堆砌；所有控件沿用 design-system 的 token（`$surfaceVariant` 底、`$color` 选中反白、13/14 号字、44 高触控区），风格与首页 / 资产页一致。

## 4. 信息架构与布局

```
┌ 预测市场                          [启用] [🏆] [📊] ┐   ← 保留
│ 🔍 搜索市场                                       │   ← 搜索框（点击进入搜索态，见 §5.4）
│ [全部] [Politics] [Crypto] [Football] [Iran] … [更多 ▾] │ ← 一级：横滑 chip，选中反白；"全部"固定首位
│ [全部 Crypto] [5M] [15M] [1h] [4h] [Daily]         │   ← 二级：仅当前一级有子标签时出现（Crypto / Weather / Iran）
│ [交易中 ▾]  [成交量 ▾]                      [★ 收藏] │   ← 视图 + 排序两个下拉，收藏开关右对齐
├───────────────────────────────────────────────────┤
│ 精选 / 榜单 / 周期市场   （仅"全部" + 交易中 + 未搜索）  │
│ 事件列表（40 条/页，滚到底翻页，脚注四态）              │
└───────────────────────────────────────────────────┘
```

滚动后钉住的悬浮条：一级 chip 行 + 搜索图标（沿用现有 `CollapsingHeader floating`）；二级行与下拉不钉住（进入列表后极少改）。

### 4.1 一级分类行

- 内容：`全部` + 13 个轮播标签 + `更多 ▾`。chip 高 34、圆角 999、字 13/700；选中 `$color` 底 `$background` 字；未选 `$surfaceVariant` 底。
- 选中"更多"面板里的标签后，该标签以选中态插到 `更多 ▾` 左侧（与轮播标签并存），保证"我选的"始终可见；切回其它一级时移除。
- 标签名用 `labelTranslation`（188 个全有），中文环境显示中文。

### 4.2 二级分类行

- 数据：`/tags/{一级 id}/related-tags/tags`，空则整行不渲染。
- 首项固定"全部 <一级名>"（= 只按一级过滤，`related_tags=true` 并入子标签事件）；其余为子标签。
- 样式比一级弱一档：高 30、字 12/600、描边 1px `$borderColor` 无底色；选中时 `$color` 描边 + 字 `$color` 加粗（不用反白，避免与一级抢层级）。
- Crypto 的二级（5M / 15M / 1h / 4h / Daily）同时过滤周期市场系列卡（按 recurrence 匹配），事件列表用 `tag_id = 子标签 id`。

### 4.3 视图 / 排序下拉 + 收藏开关

- 两个 `FilterSelect`：chip 形态显示当前值加 `▾`（"交易中 ▾""成交量 ▾"），点击打开底部单选面板（`Sheet`，标题 + 单选行 + 选中勾），选后关闭。
- 视图选项：交易中（默认）/ 已结束 / 全部（含已结束）。排序：成交量（默认）/ 24h 成交 / 流动性 / 即将截止 / 最新。
- 收藏：右侧 `★ 收藏` 开关 chip；开启时列表只显示收藏，忽略分类与排序，一级 / 二级行置灰不可点，chip 上显示数量（★ 收藏 · 3）。
- 非默认值的下拉 chip 用 `$primary` 描边提示"有筛选生效"，并在列表顶部出现一行"已筛选：已结束 · 24h 成交 [清除]"。

### 4.4 搜索态

- 点击搜索框进入搜索态：一级 / 二级 / 下拉行收起，只剩输入框 + 取消；运营位隐藏。
- 输入 ≥ 2 个字符、停顿 300ms 后请求 `/public-search?q=&events_status=<视图>&limit_per_type=20&page=N`；结果分两段：**标签**（最多 5 个，点击 = 选中该标签并退出搜索态）与 **事件**（列表卡，翻页用 `page`）。
- 空结果：一行"没有匹配的市场"，下面给"清除搜索"文字链。
- 收藏视图下的搜索仍是本地过滤（收藏是逐个查询的集合）。

### 4.5 "更多分类"面板

- `Sheet`，标题"全部分类"，顶部搜索框（本地过滤 188 个标签），列表按 `labelTranslation` 首字分组（中文按拼音首字母，英文按字母），每行标签名 + 事件数（若平台给不了数量则不显示，不造数）。
- 已在轮播行的标签标"常用"角标；选中即关闭并应用。

### 4.6 空态与边界

| 场景 | 处理 |
| --- | --- |
| 一级 / 二级下没有事件（dev 常见：Weather 0、Crypto 仅周期） | 列表位一张空态卡："该分类暂无交易中的市场"，两个文字链：切到"全部"、切到"已结束" |
| 二级接口失败 | 二级行不渲染，不阻塞列表；下拉刷新重试 |
| 搜索接口失败 | 列表位显示"搜索暂不可用 · 重试"文字链，不回退到本地过滤（本地只有一页，会给出误导性的"没找到"） |
| 分页失败 | 已有脚注"加载失败 · 重试" |
| 标签全集失败 | "更多 ▾" 不渲染 |

## 5. 交互细节

1. 切一级：二级行重置为"全部 <一级>"，排序 / 视图保留，列表滚回顶部并重新拉第一页；运营位随之收起或展开。
2. 切二级：列表滚回顶部；一级 chip 保持选中；周期系列卡按 recurrence 过滤。
3. 改视图 / 排序：不滚顶（用户通常在看列表中段），列表原地刷新并显示"已筛选"提示行。
4. 收藏开关：一级 / 二级置灰；关闭恢复之前的分类。
5. 下拉刷新：刷新当前筛选下的第一页 + 运营位 + 二级标签。
6. 深链参数 `{ tag, parentTag, view, sort, q, favorites }`：首页"查看全部"→ `{}`（全部）；榜单"查看全部"→ `{ sort }`；系列卡 → `{ tag: crypto, parentTag: crypto }`。

## 6. 数据与网关映射

| App | 平台 |
| --- | --- |
| `listTags()`（一级） | `/tags?is_carousel=true&order=carousel_sort` |
| `listAllTags()` | `/tags?limit=500&order=label&ascending=true` |
| `listRelatedTags(id)` | `/tags/{id}/related-tags/tags` |
| `listEvents({ tagId, includeRelated, status, sort, cursor })` | `/events?tag_id&related_tags&active/closed&order&offset&exclude_tag_slug=recurring` |
| `searchEvents({ q, status, page })` | `/public-search?q&events_status&limit_per_type=20&page` |
| 周期系列 | 现有 `listSeries`，按二级 recurrence 本地过滤 |

## 7. 改动清单与工作量

| 层 | 改动 |
| --- | --- |
| `core/predict-platform/gamma.ts` | `fetchAllTags`、`fetchRelatedTags`、`fetchPublicSearch`；events 增加 `related_tags` |
| 网关（接口 / http / mock） | 上表四个方法 + 类型 |
| `market-list-screen.tsx` | 状态模型 §5.6；一级"全部"默认；二级行；下拉；收藏开关；搜索态；空态卡；"已筛选"提示行；页大小 40 |
| design-system | `FilterSelect`（chip + Sheet 单选）、`TagPickerSheet`、`FilterBanner` |
| 文案 | 全部 / 全部 {tag} / 更多分类 / 全部分类 / 常用 / 已筛选 / 清除 / 该分类暂无交易中的市场 / 切到全部 / 搜索暂不可用 等约 14 键 |
| 测试 | 网关映射；一级二级切换；收藏置灰；搜索态；空态；深链参数 |

预计 2 天；纯 JS，OTA 发布。

## 8. 需要确认

1. 默认视图"全部"（推荐）。
2. 视图 / 排序改两个下拉 + 收藏开关（推荐）。
3. 搜索改服务端 `/public-search`（已验证可用，推荐）；搜索结果里是否要展示"标签"段（点标签直接切分类）。
4. "更多分类"面板做不做（188 个标签中 175 个不在轮播里，推荐做）。
5. Crypto 二级（5M / 15M / 1h / 4h / Daily）同时过滤周期系列卡（推荐）。
