# 预测市场地区限制（geoblock）设计

日期：2026-09-08 · 范围：RN-Server（配置与下发）、RN-Admin（管理端字段）、RN-App（展示与提示）

## 1. 结论

- 地区判定沿用平台原有方式：由平台部署方提供的地理检查服务（C 端环境变量 `GEO_CHECK_URL`）给出"是否受限"，
  我们不自己维护地区名单。管理端只多一个字段：预测市场配置里的服务地址 `endpoints.geo`；不填就是不做地区限制，
  管理端明示这一点。
- App 在预测模块内单独做展示与提示：受限时列表顶部有横幅，详情页 / 卡片 / 系列卡的买卖入口关闭并给出原因，
  启用引导不可继续；转入 / 转出 / 领取不拦，用户始终能把钱取回。
- 与 C 端的两处差异（§4）：检查失败不当作"不受限"；App 直接请求地理服务，让服务看到手机真实出口 IP。
- 全部在 `modules.predict` 之下：地理检查只由预测页面发起，模块关着不请求。

## 2. C 端（pm-cup2026 user-dapp）现状

| 环节 | 实现 | 文件 |
| --- | --- | --- |
| 配置 | 服务端环境变量 `GEO_CHECK_URL`（可选，不带 `NEXT_PUBLIC_`，不进浏览器） | `SERVICES.md` 环境变量表 |
| 代理 | Next 路由 `GET /api/geoblock` → `GET {GEO_CHECK_URL}/geoblock`，5 秒超时；未配置、上游非 2xx、网络错误都返回 `{restricted:false}` | `src/app/api/geoblock/route.ts` |
| 触发 | 钱包连接成功且拿到地址后调一次；结果存 `sessionStorage`（`pm_geoblock_result`），同一浏览器会话不再查 | `hooks/useGeoCheck.ts`、`components/providers/AccountProvider.tsx` `GeoAndProfileSync` |
| 状态 | `useAccountStore.isGeoRestricted`；`selectAuthStep` 在 `disconnected` 之后、`need_setup` 之前返回 `geo_restricted`，`selectIsFullyReady` 直接 false | `stores/useAccountStore.ts` |
| 展示 | 全站底部横幅 `GeoBlockBanner`（"您所在地区不支持交易"）；下单表单按钮禁用并显示"您所在地区因监管要求不支持预测市场。查看条款"（链接到 `app.termsUrl`）；水龙头页同样受限 | `components/auth/GeoBlockBanner.tsx`、`components/markets/TradeForm.tsx:968-990`、`faucet/FaucetPageContent.tsx` |

地理服务本身不在 pm-cup2026 仓库里（`services/` 下没有 geoblock 实现），是部署方另行提供的接口，契约只有
`GET /geoblock` → JSON `{ "restricted": boolean }`，其余字段 C 端不读。

两点需要注意：

1. Next 代理转发时**没有带用户 IP**（没有 `X-Forwarded-For`），地理服务看到的是 Next 服务器的出口 IP。
   这套代理只有在地理服务另有取 IP 的办法（例如同一边缘网络）时才有意义；平台 dev 环境没有配置该变量，无法核实。
2. 检查失败一律当作"不受限"，是 C 端的兜底；本项目不允许（见 [[no-fallback-strategies]]）。

## 3. 方案

### 3.1 管理（RN-Server + RN-Admin，"原有方式"）

- `services.predict.endpoints` 增加第七个键 `geo`：地理检查服务基址，`https://host[:port][/path]`，校验规则与其它六个相同
  （`parsePredictEndpoint`）。**没有按域名派生的默认值**：其它六个不填按 `xxx.{domain}` 派生，`geo` 不填就是"不做地区限制"。
- 管理端"预测市场"页在服务地址列表里多一行，说明文字写清："不填 = 不做地区限制；填了之后 App 在进入预测市场时向
  `{geo}/geoblock` 询问是否受限"。
- 下发：bootstrap 的 `services.predict.endpoints.geo` 原样带给 App（predict 模块关着时整个 `services.predict` 本来就不下发）。
- 不改表：配置仍在 mobile-bootstrap 的 JSON 里，与其它 endpoint 同一处。

### 3.2 App

**契约**：`GET {geo}/geoblock`，带 `X-Tenant-Domain`，5 秒超时，响应 `{ restricted: boolean }`（zod：`restricted` 必须是布尔）。

**模型与网关**

```ts
type RegionAccess = { restricted: boolean };
PredictGateway.checkRegion(): Promise<RegionAccess>;
```

- `HttpPredictGateway.checkRegion`：`endpoints.geo` 未配置 → 返回 `{ restricted: false }`（这是管理端可见的声明式默认，不是兜底）；
  配置了 → 请求地理服务；非 2xx / 超时 / 响应不合契约 → 抛错（与其它平台请求同一套 `platformRequest`）。
- `MockPredictGateway.checkRegion`：读 mock 运行时开关 `regionRestricted`（默认 false），测试与演示用。

**查询**：`useRegionAccess({ enabled })`，`queryKey: ["predict-region"]`，`staleTime: Infinity`（一次进程查一次，与 C 端
"一次会话查一次"对应），失败可手动重试。调用方：预测列表、事件详情、系列页、启用引导、持仓页。`enabled` 由调用方按
`modules.predict` 传；这些页面本身只在模块开着时挂载。

**三种状态与展示**

| 状态 | 列表 | 详情 / 卡片 / 系列卡 | 启用引导 | 持仓 |
| --- | --- | --- | --- | --- |
| 允许（未配置或服务说不受限） | 无变化 | 无变化 | 无变化 | 无变化 |
| 受限 | 顶部红色横幅"您所在地区不支持交易" | `canOrder` 为 false：Yes / No 块与底栏收起、盘口不可点价、卡片按钮禁用；详情页提示"您所在地区因监管要求不支持预测市场" | 提示同上，"启用"按钮禁用 | "卖出"禁用；领取 / 划转不拦 |
| 检查失败 | 横幅"无法确认所在地区，暂不能交易"+ 重试 | 同受限，提示文案换成"无法确认所在地区" + 重试 | 同受限 | 同受限 |

"查看条款"：C 端链接到 `app.termsUrl`，App 的 bootstrap 没有条款地址，启用引导里的平台协议来自 public-info 且只有正文；
这一版提示不带链接，等 bootstrap 有条款地址再加。

**门控落点**（都在现有 `canOrder` / `disabled` 之上再与一个条件，不新开入口）

- `event-detail-screen.tsx`：`canOrder = status === "trading" && acceptingOrders && region.allowed`。
- `shared.tsx` `EventCard`、列表精选轮播、`series-card.tsx`：`YesNoButtons disabled` 多一个 `regionBlocked`。
- `positions-screen.tsx`：卖出按钮 `disabled`。
- `predict-enable-screen.tsx`：受限时"启用"禁用并提示。
- 首页"热门预测"卡没有买卖按钮，不改。

**开关**：`useRegionAccess` 只被预测模块内页面调用；列表 / 详情 / 系列 / 启用 / 持仓都在 `ModuleGate` 或预测页签之内。
不在共享入口（首页、资产页）发起地理检查。

### 3.3 文案（fallback-config → `pnpm i18n:seed` → RN-Server 同步）

| 键 | zh | en |
| --- | --- | --- |
| `predict.region.restricted` | 您所在地区不支持交易 | Trading is not available in your region |
| `predict.region.restrictedDetail` | 您所在地区因监管要求不支持预测市场。 | Prediction markets are not available in your region due to regulatory requirements. |
| `predict.region.unknown` | 无法确认所在地区，暂不能交易 | Your region could not be verified, so trading is paused |

## 4. 与 C 端的差异（有意为之）

1. **检查失败不放行**。C 端失败当作不受限；本项目失败就是失败：明确提示 + 重试，交易入口保持关闭。
   代价是地理服务不稳定时用户会被挡；收益是不会因为一次网络抖动放行受限地区。
2. **App 直连地理服务**。C 端经 Next 代理且不转发用户 IP；App 已经直连 gamma / clob / data，地理服务也直连，
   服务看到的是手机真实出口 IP。若平台要求必须经我们服务端，再在 RN-Server 加代理并转发 `X-Forwarded-For`。
3. **未配置即不检查**是管理端可见的声明式默认，与其它六个服务地址"不填按域名派生"并列写在管理端说明里。

## 5. 需平台确认

- 地理检查服务的正式地址与限流；`/geoblock` 是否按来源 IP 判定、是否需要租户头。
- 受限地区名单由谁维护（沿用平台侧）。

## 6. 验证

- RN-Server：`endpoints.geo` 校验（https、无凭据 / 查询串）、未知键仍拒绝、下发带 `geo`。
- RN-Admin：预测市场页多一行并有"不填 = 不做地区限制"说明，保存与测试连接不受影响。
- RN-App：网关三态（未配置 / 允许 / 受限 / 失败）、列表横幅、详情 `canOrder`、卡片禁用、启用引导禁用、持仓卖出禁用；
  模拟器用本机地理服务桩（`adb reverse`）跑受限与失败两种。
