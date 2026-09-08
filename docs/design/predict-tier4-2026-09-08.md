# 预测市场独立需求（覆盖文档 §4 第 4 项）设计

日期：2026-09-08 · 范围：RN-App；对照 pm-cup2026 user-dapp 与 gamma-service 源码核对后定稿

## 1. 结论

| 项 | 本轮 | 理由 |
| --- | --- | --- |
| 事件 / 市场图片 | **做** | 字段已解析、云存储公开可达，只差渲染 |
| 预测市场昵称（个人资料） | **做**（按 C 端实际范围：昵称） | C 端只提供昵称编辑；平台虽支持简介 / X 账号 / 头像 URL / 匿名开关，网页没有界面，App 不超前 |
| 公开主页 | **不做** | C 端没有公开主页：排行榜行不可点，`/public-profile` 只用来取自己的显示名 |
| 体育枢纽 | **不做，留待有需求** | 等于一个新模块（联赛导航 / 赛程 / 比分 / 盘口类型），C 端也仍在演进 |
| 跨链桥转入 | **不做，留待平台** | 依赖桥服务对租户开放；未确认前无法联调 |

全部在 `modules.predict` 之下：图片只出现在预测卡片 / 详情 / 首页热门预测（后者本就按开关隐藏）；昵称入口在排行榜"我"卡与
个人页的预测分组里（分组已按开关渲染）。

## 2. C 端现状（核对结果）

- **图片**：gamma 事件 / 市场带 `image`、`icon`（dev 上 12 个活跃事件全有，域名为华为云 OBS 与 Polymarket S3 公开桶，市场级为空）。
  网页卡片用 `icon`（小方图）、详情与轮播用 `image`。
- **昵称**：`WalletButton.tsx` 里一个输入框（`maxLength=32`，占位"输入用户名"），经 `POST /api/gamma-auth/update-profile`
  → gamma `POST /profiles`（`Authorization: Bearer <gamma jwt>`，body 只带要改的字段）。显示名规则 `name || pseudonym || 地址缩写`；
  `pseudonym` 是平台登录时自动生成的化名。
- **自己的资料**：登录后 `GET /public-profile?address=`（服务端 `Cache-Control: max-age=3600`）。另有 `GET /profiles/user_address/{address}`
  返回完整 `Profile`（无缓存头），App 取自己的资料用它，避免改完昵称后读到一小时前的缓存。
- **排行榜**：`/predict/top-traders` 只是列表，行不可点。

## 3. 方案

### 3.1 图片

- 模型：`PredictEvent` 增 `imageUrl: string | null`、`iconUrl: string | null`（gamma `image` / `icon`，空串视为 null）；`Market` 增 `iconUrl`。
  Mock 夹具全部为 null（不编图片），一条夹具带 URL 供渲染测试。
- 展示：
  - 列表卡 / 首页热门预测卡：标题左侧 40×40 圆角 `iconUrl`；没有就不占位。
  - 精选轮播：卡片顶部 `imageUrl` 横幅（宽 300、高 120、cover）；没有就不占位。
  - 详情头部：标题左侧 48×48 `iconUrl`。
  - 市场级 `iconUrl` 只进模型，界面暂不渲染（dev 数据全为空，等有数据再决定放在多结果行还是不放）。
- 加载失败：`onError` 后隐藏该图。这是界面层对坏资源的处理，不是数据兜底：不替换成别的图，也不影响其它字段。
- 组件：`shared.tsx` 的 `EventImage({ uri, size | width/height, radius })`，基于 RN `Image`（不新增原生依赖）。

### 3.2 昵称

- 契约（`core/predict-platform/profile.ts`）：
  - `fetchProfile(service, address)` → `GET {gamma}/profiles/user_address/{address}`，zod：`name / pseudonym / displayUsernamePublic / bio / profileImage / xUsername` 皆可空。
  - `updateProfile(service, jwt, { name })` → `POST {gamma}/profiles`，`Authorization: Bearer`，返回完整 Profile。
  - 昵称规则与 C 端一致：去首尾空白，1–32 字符；空串表示清除（平台按空串写入）。
- 网关：`PredictAccountGateway.profile(address)`、`updateProfile(address, { name })`；后者用 `ensureJwt`，没登录（启用第 1 步）就抛
  `PredictNotEnabledError`，界面引导去启用。InMemory 网关同样实现供测试。
- 模型：`PredictProfile = { name: string | null; pseudonym: string | null; imageUrl: string | null; displayName: string }`，
  `displayName = name ?? pseudonym ?? 地址缩写`（与 C 端 `WalletButton` 一致）。
- 界面：
  - 排行榜"我"卡：头像位显示 `imageUrl`（没有就沿用地址前两位），标题旁显示 `displayName`，右侧铅笔进入昵称面板。
  - 个人页"我的"分组：新增"预测市场昵称"行（值 = displayName），点开同一面板；未启用时行值为"先启用预测账户"，点击进入启用引导。
  - 面板 `NicknameSheet`：输入框（32 上限，计数）、保存 / 清除；保存成功 toast，失败 toast 原文；保存期间锁面板。
- 查询：`usePredictProfile(address)`（key `["predict-account","profile",address]`，staleTime 60s）；更新后 `setQueryData`。
- 开关：入口都在预测模块内或按 `modules.predict` 渲染的分组里；hook 只由这些入口调用。

### 3.3 不做项的边界记录

- 体育枢纽：现有对阵卡保留；`/sports-events`、`/config/sport-types` 未接。
- 跨链桥：资产划转页保持链内转入 / 转出；桥服务地址与可用性由平台答复后再立需求。
- 公开主页：排行榜行保持不可点；持有人榜显示名字不带链接。

## 4. 与 C 端差异

- 自己的资料用 `/profiles/user_address/{address}`（无缓存）而不是 `/public-profile`（缓存 1 小时）：改完昵称立即可见。
- 图片加载失败隐藏该图（C 端浏览器显示裂图）。

## 5. 验证

- 单测：图片字段映射（http 网关）、`EventImage` 失败隐藏、昵称契约（Bearer、body 只带 name、400 / 401 抛错）、InMemory 与 Http 网关、
  排行榜"我"卡与个人页行、面板保存与错误。
- 模拟器：列表 / 轮播 / 详情图片显示（prax1s dev 全部事件带图）；昵称需要已登录的预测账户，模拟器里没有可签名的启用账户，
  只能用单测覆盖，真机留待有测试账户时核对。

### 5.1 结果（2026-09-08）

- 单测：`profile.spec.ts`（读资料不带鉴权、404 = 还没有资料、其它错误抛出、改昵称带 Bearer 且 body 只含 name、超长本地拒绝）、
  `http-predict-gateway.spec.ts`（image / icon 映射）、`market-list-screen.spec.tsx`（只有带图标的事件渲染图标）、
  `leaderboard-screen.spec.tsx`（显示化名、登录后改昵称、未登录无编辑入口）；全量 jest 104 套 716 例、lint、typecheck、format 通过。
- 模拟器（`pnpm android:release anyfun` 直装包，连线上租户 → prax1s dev）：首页热门预测卡图标、精选轮播横幅（Powell 图）、
  列表卡图标、详情头部图标均按平台 `image` / `icon` 显示；排行榜"我"卡对未登录平台的钱包显示地址缩写且无编辑入口
  （平台对该地址回 404 = 还没有资料）。昵称修改需要已登录平台的账户，模拟器没有可签名的启用账户，留待有测试账户时核对。
