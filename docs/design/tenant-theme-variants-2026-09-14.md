# SaaS 租户主题与 UI 风格方案评估

状态：方案评审稿（基于 2026-09-14 工作区代码与文档）

## 1. 目标与验收条件

目标是让租户管理员在 RN-Admin 中为 Wallet、Predict、DEX 选择不同的品牌主题和 UI 风格，App 在不改变业务数据、权限和签名语义的前提下呈现差异化体验，且配置可审计、可灰度、可回滚。Wallet 是基础能力；Predict 与 DEX 是两个独立开关，允许同时开启、只开其中一个，或同时关闭。

本需求的共同验收条件：

1. 租户主题只有一个事实源：`mobile-bootstrap.theme`；管理端预览使用同一份配置模型，不维护第二套颜色或组件规则。
2. 配置由 RN-Server 校验、版本化、签名并按租户隔离；RN-Admin 保存使用 `expectedVersion`、修改原因和审计记录。
3. App 对颜色、排版、形状、组件变体只消费已实现且经过白名单校验的能力，禁止远程下发代码、JS、任意 URL 样式或任意页面 DSL。
4. Wallet 的金额精度、地址/链信息、授权风险、签名确认字段和交易状态保持原有语义；Predict/DEX 的涨跌颜色同时用符号、箭头或文字表达，不能只依赖颜色。
5. 每个方案都覆盖 Light / Dark / System、动态字体、无障碍、RTL（若产品开启）、loading/empty/error/offline/permission-denied/blocked 等页面状态，并给出双端、OTA、性能和回滚验证证据。
6. `modules.predict` 与 `modules.dex` 的四种组合都有明确定义：`11`、`10`、`01`、`00`。主题选择不能改变模块开关；模块开关也不能借主题选择隐式改变主题。

## 2. 已有行为与可复用基础

当前 App 已经是“语义颜色可配置”的架构；本设计另外把它作为第六种方案（Foundation Classic）：

- [`src/core/config/bootstrap.schema.ts`](../../src/core/config/bootstrap.schema.ts) 的 `theme` 包含 `defaultMode`、`allowUserOverride`、`paletteVersion`，以及 Light / Dark 两套 17 项 `SemanticPalette`。
- [`src/design-system/foundation-theme-provider.tsx`](../../src/design-system/foundation-theme-provider.tsx) 根据 Bootstrap 主题和用户的涨跌色偏好创建 Tamagui 配置；导航主题也从同一 `useTheme` 派生。
- [`src/design-system/tamagui.config.ts`](../../src/design-system/tamagui.config.ts) 将语义令牌映射为 `background`、`surface`、`primary`、`pricePositive`、`risk` 等组件可用令牌。
- Wallet、Predict、DEX 页面大多通过 `design-system` 组件和 `useTheme` 取值；`src/test/harness.tsx` 可显式替换 Bootstrap 配置，适合建立主题组合测试。
- RN-Admin 已有主题工作台、实时预览、受控调色板 preset 和保存审计流程；RN-Server 通过 `app_configs` 的 `mobile-bootstrap` 按租户继承并签名下发。Branding 资源另存于独立配置，不应把任意布局或代码混入 branding。

现有约束也决定了方案边界：主题 JS 和 Bootstrap 配置可按现有 OTA 流程发布；原生字体、原生图标、权限和 ABI 变化必须走全量 Development/Release Build。当前少量页面仍有裸 `fontSize`、`borderRadius`、`rgba` 和白色字面量，方案涉及排版或形态时必须先收敛到 design-system token。

## 2.1 模块开关真值矩阵（实现前必须先修订的基线）

当前代码和历史文档只允许至少开启一个模块，`bootstrap.schema.ts` 还通过 `predict || dex` 拒绝 `00`。本次需求明确采用四态模型，因此实现 agent 必须把它视为前置契约变更，不能沿用旧限制。

| `predict` | `dex`   | 底栏与入口                | 服务端配置                                                 | 请求与深链行为                                                              |
| --------- | ------- | ------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------- |
| `true`    | `true`  | 首页 / 预测 / DEX / 资产  | 必须有 `services.predict`，并校验 domain、scopeId、chain   | 两类业务请求可发起；两类深链可进入                                          |
| `true`    | `false` | 首页 / 预测 / 持仓 / 资产 | 必须有 `services.predict`；不得下发 DEX 专属 scope/config  | 不得发起 DEX Query；DEX 深链由 ModuleGate 阻断                              |
| `false`   | `true`  | 首页 / 行情 / 兑换 / 资产 | 不得下发 `services.predict`；不得保存 Predict scope        | 不得发起 Predict Query；Predict 深链由 ModuleGate 阻断                      |
| `false`   | `false` | 首页 / 资产               | 不得下发 `services.predict`、Predict scope 或 DEX 专属配置 | 不得发起 Predict/DEX Query；业务深链进入可观测的 blocked 状态并回到安全页面 |

四态共同规则：Wallet、登录、设置、安全中心和资产基础能力仍可用；首页/资产中的 Predict/DEX 快捷入口按开关隐藏；关闭模块时清理该模块 Query、活动路由和临时状态。当前 `FoundationHomeScreen` 即使 DEX 关闭仍会调用 `useDexTokens`，这是已确认的实现缺口，必须在模块开关改造中修复并用“关闭时 Query 不出网”测试钉住。

## 2.3 对抗评审结论与需求纠偏

对当前设计做实现前对抗评审后，必须接受以下结论：

1. 原文的五条路径不是五套同时运行的系统，而是同一个 canonical `ThemeProfile` 的五种开放深度；实现 agent 必须先选主路径。
2. 当前代码、README、RN-Admin 和 RN-Server 都把“至少开启一个模块”写死，且 App 的 `bootstrap.schema.ts`、Server `validConfig`、Admin 保存校验和现有测试都拒绝 `00`。本需求有意替换这一旧约束，四层必须同批修改，否则会出现 Admin 能保存、Server 拒绝或 App 无法解析的分裂状态。
3. 当前 `createFallbackConfig` 仍是双模块并且没有 Predict 服务配置，这是测试/启动基线与新跨字段契约之间的已知差异。实现 agent 必须决定关系校验适用于签名远程 Bootstrap、缓存快照和测试 fixture 的边界，并补失败测试；不能把缺失服务静默当成可用状态。
4. 当前 `FoundationHomeScreen` 在 DEX 关闭时仍调用 `useDexTokens`；当前资产页和个人中心的部分入口在 `00` 也需要重新定义。只隐藏按钮不算完成，必须证明 Query、订阅、推送点击和深链都不可达。
5. 方案 3 的 scope 继承、方案 4 的资源 manifest、方案 5 的 variant 组合都不能依赖 optional 字段推断。应使用显式 `inherit-global`、能力矩阵和 strict schema；未知值整份配置拒绝并记录原因。
6. Foundation Classic 必须保留存量租户的当前 palette 和页面结构，不能因为示例名称而强制覆盖为内置金色；Exchange Gold 必须有可截图验证的形态差异，不能只换一组颜色。

以上结论属于实现前置条件。若产品最终不接受 `00`，必须把 2.1、Phase 1、Phase 3 和所有验证矩阵改回“三态并拒绝 00”，不能只改一处开关。

## 2.2 规范化主题契约与六种方案的关系

六种方案不是六套平行系统。实现 agent 应先建立一个受控的 `ThemeProfile`，再按方案只启用所需字段：

```ts
type ThemeProfile = {
  schemaVersion: 1 | 2;
  presetId:
    | "foundation-classic"
    | "exchange-gold"
    | "ocean-glass"
    | "forest-rwa"
    | "editorial-light"
    | "terminal-neon";
  global: { light: SemanticPalette; dark: SemanticPalette };
  typography?: {
    family: "system" | "mono" | "editorial";
    scale: "standard" | "compact" | "large";
  };
  density?: "comfortable" | "compact";
  shape?: {
    radius: "sharp" | "soft" | "pill";
    elevation: "flat" | "raised" | "glass";
  };
  motion?: "standard" | "reduced";
  scopes?: { wallet?: ScopeTheme; predict?: ScopeTheme; dex?: ScopeTheme };
  variants?: {
    card?: "flat" | "elevated" | "outline";
    nav?: "bottom" | "rail";
    chart?: "line" | "candle";
  };
  assets?: SignedThemeAsset[];
};
```

`ThemeProfile` 是设计模型示例，落地时必须拆成 RN-Server、RN-Admin、RN-App 可共同生成/校验的 strict schema。`presetId` 等稳定 ID 才是契约；主题展示名称、颜色样例和宣传文案不能作为业务逻辑条件。方案 1–5 是在该模型上逐步开放的能力边界，方案 6 是仅使用 `global.light/dark` 的现有基线。

关系校验必须是独立的纯函数（例如 `validateBootstrapRelations(config)`），不能只依赖单字段 Zod：

- `predict=true` ⇒ `services.predict` 必须存在且通过 domain/scopeId/chain 校验；`predict=false` ⇒ 已发布 Bootstrap 不含 `services.predict` 和 `scopes.predict`。
- `dex=false` ⇒ 已发布 Bootstrap 不含 `scopes.dex` 及 DEX 专属可执行配置。
- `scopes.wallet` 始终只服务 Wallet；全局主题负责 AppShell、首页、资产、个人中心、设置和登录。
- 主题和 modules 使用同一个 `configVersion` 原子下发；主题切换不改变 modules，modules 切换不重写主题。

## 2.4 方案到代码的最小入口

| 方案                 | 最小实现入口                                                       | 主要产物                                        | 明确禁止                                                |
| -------------------- | ------------------------------------------------------------------ | ----------------------------------------------- | ------------------------------------------------------- |
| 1 调色板预设         | `bootstrap.schema.ts`、Admin 主题工作台、`FoundationThemeProvider` | 受控 preset registry + 17 色 palette            | 改页面布局、字体或模块可达性                            |
| 2 令牌主题包         | `tamagui.config.ts`、公共 recipes、token migration                 | versioned token resolver + recipe tests         | feature 继续新增裸字号/圆角                             |
| 3 模块作用域         | `ThemeScope`、各 feature 根入口、modules cross-field validator     | global + wallet/predict/dex scopes              | disabled scope 进入已发布 Bootstrap；scope 覆盖安全语义 |
| 4 Skin Pack          | `theme-registry`、资源完整性/缓存、Admin skin selector             | signed skin manifest + atomic cache             | 远程 JS、任意 DSL、未验签资源                           |
| 5 组件变体           | `ThemeVariantProvider`、Card/Button/Nav/Chart/Sheet recipes        | capability matrix + variant compatibility tests | 任意布局树、variant 组合无限增长                        |
| 6 Foundation Classic | 现有 `foundation-theme-provider.tsx`、`tamagui.config.ts`          | 当前 palette 的兼容与回滚快照                   | 把当前基线误当成新形态主题                              |

## 2.5 Admin 模块选择必须是“可视化模板选择”，不是两个开关

模块配置页不能只放 `Predict` / `DEX` 两个 checkbox。管理员需要在选择模块的同时看到 App 会变成什么样，再决定是否保存。这里将模块选择命名为“产品组合模板”，采用“模板卡片 + 实时手机预览”的交互；视觉主题另命名为“风格模板”。单独开关作为无障碍和高级编辑入口保留，但不能作为主要视觉入口。

### 页面结构

1. **产品组合模板卡片区**：四张可点击卡片分别代表 `11` 全功能、`10` 仅 Predict、`01` 仅 DEX、`00` Wallet-only。每张卡片本身就是一张 1:2 手机 UI 缩略图，展示模板名称、适用描述、启用模块徽标、底栏、首页卡片和 Assets 动作；下方再显示 `11/10/01/00` 技术摘要。选中卡片后，右侧预览立即切换，卡片显示选中状态和“未保存草稿”标识。
2. **手机预览区**：使用与 App 相同的模块导航合同，显示真实比例的手机框，至少包含 Home、Assets 和当前模块主屏三个可切换预览页。底栏图标、顺序、文案、首页模块卡片、资产页动作和个人中心交易入口必须随四态变化。
3. **预览状态栏**：提供 Light / Dark、中文 / English、字体 100% / 最大、Content / Loading / Empty / Error 四组预览控制。它们只改变预览，不改变草稿之外的服务端数据；预览必须标注“示意数据”，不能调用真实钱包、Predict 或 DEX 接口。
4. **配置摘要区**：在保存前显示 `modules.predict`、`modules.dex`、底栏结果、将被隐藏的入口、将停止的 Query/订阅，以及 Predict 服务关联是否完整。摘要与手机预览使用同一个草稿对象。
5. **保存区**：保留现有修改原因、`expectedVersion`、审计、并发冲突和回滚流程。保存按钮在跨字段校验失败时明确指出原因，例如“已启用 Predict，但尚未配置平台 scopeId”。

模块组合模板与视觉主题是两条正交轴：不做 4 个模块模板 × 6 个主题的 24 张卡片。模块区只选择 `11/10/01/00`，并在手机预览中使用当前选中的视觉主题；主题区选择六款 preset 后，同一手机预览更新颜色/形态。保存摘要分别列出 `modules diff` 与 `theme diff`。

### 交互状态

- **初次加载**：模板卡片和手机框同时显示 Skeleton；不能先显示旧模块状态再异步替换，避免管理员误保存。
- **选择草稿**：整张卡片可点击，键盘 Enter/Space 也可操作；卡片使用 `aria-pressed`、焦点环和选中说明。选择后顶部 sticky bar 显示“未保存 · 变更 N 项”，手机预览和摘要同步更新。
- **预览错误**：fixture 或渲染失败时，在手机框内显示可重试的 recoverable-error；其它模板仍可查看。schema/能力不兼容时标红并禁用“选择/发布”，不能用另一模板替代。
- **保存中/保存成功**：保存按钮进入 loading，锁定模板选择；成功后显示 `configVersion` 和生效策略。HTTP 409 时保留本地草稿，展示服务端/本地 diff，提供重新加载或基于最新配置重试，不能丢弃修改。
- **发布前确认与回滚**：确认层必须带手机缩略图、modules/theme diff 和受影响入口清单；历史版本回滚也先加载到同一预览中查看，再按 `expectedVersion` 保存。

### 四态模板内容

| 模板                  | 手机预览必须显示                                                                          | 必须明确显示的隐藏项/行为                                                     |
| --------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Full Suite（`11`）    | Home 预测卡片 + DEX 热门卡片；底栏 Home / Predict / DEX / Assets；Assets 有钱包与交易动作 | Predict 服务关联已配置；两类 Query 可用                                       |
| Predict Suite（`10`） | Home 预测卡片；底栏 Home / Predict / Positions / Assets；Assets 显示钱包与预测划转        | DEX 卡片、行情、兑换、DEX 深链和 DEX Query 均不可用                           |
| DEX Suite（`01`）     | Home DEX 卡片；底栏 Home / Market / Swap / Assets；Assets 显示钱包与兑换动作              | Predict 卡片、市场、持仓、Predict 深链和 Predict Query 均不可用               |
| Wallet Only（`00`）   | Home 钱包/资产概览；底栏 Home / Assets；Assets 只显示收款、发送、记录                     | Predict/DEX 卡片、交易设置、服务关联、Query、订阅、推送点击和业务深链均不可用 |

### 预览实现边界

- Admin 预览必须消费 canonical `ThemeProfile` 和 `modules` 草稿；不得另写一套“按钮选中后拼字符串”的视觉逻辑。底栏和入口映射应与 App 的 `buildAppTabs`、`isAppContentAvailable`、`ModuleGate` 保持契约测试一致。
- RN-Admin 不应深层导入 RN-App 源码。两端通过生成的契约类型、固定 module-preview fixture 和四态 contract test vectors 对齐；如果暂时没有共享包，至少在两边各自测试同一组 JSON vectors，并把 vectors 纳入版本控制。
- 预览内容使用固定、脱敏、可重复的 fixture（例如明确标注“Preview fixture”的资产和市场卡片），禁止读取真实用户、钱包余额、订单、签名或外部平台数据；不得因为预览而发起任何业务请求。
- 预览必须展示 disabled 模块的结果，而不是把它从画布中删除后让管理员猜测影响。关闭模块时显示“此入口将隐藏 / 此 Query 将停止 / 此深链将被阻断”。
- 主题切换只改变颜色、字体、几何和组件变体；模块切换只改变模块入口、路由和请求能力。两者在预览状态中分别显示变更 diff，不能相互隐式改写。
- 四态中 `00` 是正式 Wallet-only 产品模板。当前 Admin 代码仍会禁用最后一个 checkbox，当前 App/Server schema 仍拒绝 `00`；实现 agent 必须先完成 2.1 的契约迁移，再实现该卡片。
- 当前 RN-Admin 的 `moduleNavigationItems` 在 `00` 下会误返回 DEX-only 导航，不能复制这段逻辑到新预览；应由共享的四态 resolver 驱动，并新增 `00 → [首页, 资产]` 的失败测试后再修复。

### 可直接执行的验收条件

- Given 管理员打开模块配置，When 页面加载完成，Then 四张模板卡片和手机预览同时出现，不能只有两个开关。
- Given 管理员点击 Predict Suite，When 草稿切换为 `10`，Then 手机底栏、首页卡片、Assets 动作和摘要同时更新；DEX 相关入口显示为隐藏，预览不发起请求。
- Given 管理员点击 Wallet Only，When 草稿切换为 `00`，Then 手机只显示 Home/Assets，设置不显示交易项，预览明确标出 Predict/DEX 深链和 Query 不可用。
- Given 管理员在手机预览中切换 Light/Dark、语言或字体大小，When 预览刷新，Then 只改变视觉状态，不改变 modules 草稿和服务端数据。
- Given 当前草稿存在 disabled scope 或 Predict 服务缺失，When 管理员点击保存，Then 保存被阻止并指出字段原因；允许保留 Admin 草稿，但不得进入已发布 Bootstrap。
- Given App 与 Admin 使用相同的 `modules` 和主题 fixture，When 对四态执行契约测试，Then 底栏顺序、入口可达性和隐藏项结果一致。

### Admin 侧实现入口与测试

建议新增 `ModuleTemplatePreview`、`ModuleSelectionCard`、`PreviewPhoneFrame` 和 `module-preview-fixtures`（名称可调整），放在 RN-Admin 的 app-config feature 内；不要把业务 API 或真实数据 gateway 引入预览组件。复用现有 `ThemePreview` 的颜色令牌和保存工作流，扩展其输入为 `modules`、`previewScreen`、`previewState`。模板卡片的首屏信息必须同时包含：手机缩略图、模板名称、模块徽标、底栏缩略图和“适合什么租户”的一句话说明；不能把关键差异藏在点击后才出现的详情弹窗中。

最低测试：四态模板选择交互、手机预览底栏/入口断言、Light/Dark/字体放大、Loading/Empty/Error、禁用模块不出网、保存 `expectedVersion` 冲突、disabled scope/缺 Predict service 校验、键盘/屏幕阅读器可操作性和截图回归。RN-App 侧补充同一 fixture 的 `app-tabs`、`ModuleGate`、首页/资产 Query gating 测试，证明 Admin 预览没有展示 App 无法达到的页面。

### 推荐的 Schema-driven Preview 实现

为了避免 Admin 自己重新实现一套 App 规则，建议新增一个纯数据预览模型（放在可被 RN-App 与 RN-Admin 共同消费的 shared package；暂时不能共享代码时，至少共享版本化 JSON vectors）：

```ts
type ModulePreviewModel = {
  modules: { predict: boolean; dex: boolean };
  tabs: Array<{ key: string; label: string; enabled: boolean }>;
  screens: Array<
    "home" | "assets" | "predict" | "positions" | "market" | "swap"
  >;
  visibleCards: Array<"wallet" | "predict" | "dex" | "security">;
  hiddenItems: Array<{
    id: string;
    reason: "module-disabled" | "missing-service";
  }>;
  queryCapabilities: { wallet: boolean; predict: boolean; dex: boolean };
  blockedDeepLinks: Array<"predict" | "dex">;
};

function buildModulePreviewModel(input: {
  modules: { predict: boolean; dex: boolean };
  theme: ThemeProfile;
  screen: string;
  state: "content" | "loading" | "empty" | "error";
  locale: string;
}): ModulePreviewModel;
```

这个函数只做确定性映射，不请求网络、不读取真实用户数据、不决定是否保存配置。RN-App 用它约束 `buildAppTabs`、首页卡片、Assets 动作和 ModuleGate；RN-Admin 用它渲染模板卡片、手机画布、隐藏项摘要和 query 能力说明。主题只作为输入传递给视觉渲染，不得改变 `tabs`、`blockedDeepLinks` 或 query 能力。

`PreviewPhoneFrame` 用 Admin design-system CSS 还原手机比例，`ModuleTemplatePreview` 管理四态模板、页面和状态切换，fixture 中的金额、市场、地址都必须带“Preview fixture/示意数据”标识。首期不能只放静态截图作为唯一依据，因为字体放大、语言和模块组合会使截图过期；如需像素级 parity，可在后续用 RN Web/Storybook iframe 复用真实组件。

预览渲染方式的取舍：静态缩略图只能作为卡片辅助；Admin DOM + shared `ModulePreviewModel` 是首期推荐；RN Web 复用 App 组件可作为高差异主题的后续升级；Storybook iframe 适合组件变体审查但不能覆盖完整四态流程；CI/真机截图适合作为发布前像素回归，不能替代可交互预览。

以下做法禁止采用：每张卡手写一套 JSX；预览读取真实 API/钱包/订单/签名；只显示底栏文字而不显示页面内容；把 disabled 模块从画布直接删除；点击模板后立即保存；在 Admin 复制一份与 App 不同的 `moduleNavigationItems` 条件分支。

## 3. 五个实现方案（技术路径，不是五套并行系统）

下面五条是“如何实现主题能力”的替代路径。实现 agent 只能选择一条主路径并按阶段交付，不能同时搭建五套 Provider、五套组件库或五套 Admin 编辑器。租户实际选择的是第 4.1 节的六款主题。

### 方案一：受控语义调色板预设（Palette Presets）

**做法。** 在 RN-Admin 的主题页提供 5–8 个经过设计审核的 preset，例如 Ocean、Exchange Gold、Forest、Midnight Violet、Monochrome。保存时将 preset 展开为现有 Light / Dark 17 个语义令牌，`paletteVersion` 记录版本，`presetId` 作为审计元数据。App 继续使用现有 `FoundationThemeProvider`，不增加页面分支。

**覆盖效果。** 可改变品牌主色、背景层次、成功/风险/涨跌色和对比度，Wallet、Predict、DEX 都能立即生效；不能改变圆角、字号、布局或组件层级。

**契约与管理端。** `theme.presetId` 为受控枚举，服务端保存展开后的 palette；服务端和 Admin 均执行十六进制/rgba 格式、WCAG AA 对比度、`pricePositive !== priceNegative`、风险色可辨识检查。旧 App 只读取已有字段，新字段不能改变已有字段含义。

**验证。** 对每个 preset 运行 Bootstrap Zod、服务端深校验、Admin 预览与 RN-App `renderWithProviders` 渲染；覆盖 Wallet 列表、Predict 行情/订单、DEX Swap/Market 的 content/loading/empty/error/offline；再测 Light/Dark/System、红涨绿跌、最大字体、VoiceOver/TalkBack 和双端截图。

**优点与风险。** 开发量和发布风险最低，几乎可按 Bootstrap/OTA 发布；差异化主要停留在颜色，容易被认为仍然“同一套 UI”。

### 方案二：设计令牌主题包 v2（Typography + Density + Shape）

**做法。** 在 `theme` 下增加版本化的声明式 token：字体族（仅内置白名单）、字号比例、行高、间距密度、圆角档位、阴影档位和动效档位。`FoundationThemeProvider` 把 token 映射到 Tamagui；`Card`、`Button`、`ScreenHeader`、`Sheet`、`Chart` 等公共组件改为 recipe，feature 不再新增裸几何值。

**覆盖效果。** 同一业务结构可以形成稳健金融、紧凑交易、柔和消费等风格：Wallet 侧重可读地址和安全卡，Predict 侧重数据密度，DEX 侧重报价与订单信息。页面结构与业务状态不变。

**契约与管理端。** 主题增加 `schemaVersion`；`density`、`radiusPreset`、`typeScale`、`motionPreset` 均为枚举或有上下限的数值。远程只能选择内置字体；新增字体文件必须进全量包。RN-Admin 提供 token 编辑器、真实页面预览和“字体放大/低动效”预览。

**验证。** 先用 `rg` 建立裸值清单并禁止新增，再逐步迁移公共组件。执行 recipe 单测、布局溢出测试、最大字体和 RTL；在中低端 Android 检查阴影、模糊、重渲染和列表掉帧；运行 iOS/Android Development Build 及关键流程 E2E。配置结构变化需同步 OpenAPI、Zod、Admin schema，并新增 ADR。

**优点与风险。** 风格覆盖面和复用性平衡较好，仍可由 Bootstrap/OTA 控制；迁移面较大，动态字体、Android 阴影和历史裸值会带来回归。

### 方案三：模块作用域主题（Wallet / Predict / DEX Scopes）

**做法。** 保留全局壳层主题，再增加 `theme.scopes.wallet`、`theme.scopes.predict`、`theme.scopes.dex`。每个作用域只允许覆盖有限语义令牌，例如主色、次级 surface、数据强调色；`danger`、`focus`、签名风险语义仍受全局可访问性规则约束。feature 通过公开的 `ThemeScope`/领域 token 入口读取，不跨 feature 深层导入。

**覆盖效果。** Wallet 可使用中性、稳健的安全视觉；Predict 可使用高对比数据视觉；DEX 可使用深色、密集的交易盘视觉；AppShell、底栏、登录和系统弹层保持一致，避免用户迷失。

**契约与管理端。** 作用域与 `modules.predict/dex` 联动：关闭的模块在已发布配置中必须没有对应 scope；草稿如需保留只能停留在 Admin 草稿，不能进入 `mobile-bootstrap`。启用模块必须显式写 `mode: "inherit-global"` 或显式 scope，不能通过 optional 字段猜测继承。Admin 预览需支持双开、仅 Predict、仅 DEX、全关闭四种导航组合。

**验证。** 测试四种模块组合、跨模块导航、深链、底栏重复点击和主题切换；确认同屏公共组件不会串用另一个模块的 token；签名页、授权页、交易确认页的风险色和字段始终符合 Web3 规范；双端截图需覆盖模块边界。

**优点与风险。** 能直接解决 Wallet/Predict/DEX 的品牌差异；作用域增加了 token 冲突、导航重渲染和配置组合爆炸风险，适合确有模块品牌诉求的租户，不适合作为第一步。

### 方案四：签名的预置 Skin Pack

**做法。** App 内置有限的 `skin registry`，每个 skin 是经过审核的 palette、排版、组件变体和品牌资源集合。Bootstrap 只下发 `skinId` 与版本化 manifest；资源沿用现有 branding 资产的大小、哈希和 MIME 校验，按 tenant/applicationId/locale/theme 隔离缓存。客户端只解析本地注册的 skin，不接收可执行代码。

**覆盖效果。** 可实现 Classic Finance、Soft Rounded、Terminal、Editorial、Neon 等完整视觉套装，包括背景、图标、卡片层级、图表网格和底栏风格；原生图标和字体仍需全量包，JS/资源部分可按 OTA 发布。

**契约与安全。** manifest 至少包含 `schemaVersion`、`skinId`、版本、允许的 token/variant、资源引用、sha256、size 和签名 keyId。服务端按 App 能力过滤可用 skin；未知 skin、跨租户资源、哈希/签名/版本不符时整份配置无效或进入明确阻断状态，不能把未知值当作另一个 skin。

**验证。** 除页面和无障碍矩阵外，增加篡改、重放、过期、跨租户包、缓存原子切换、进程重启、慢网和 OTA 回滚测试；验证旧客户端遇到新字段时不会“解析成功但样式未生效”。需要真实 iOS/Android Development Build、启动耗时、内存和资源解码预算。

**优点与风险。** 运营可以批量切换经过审核的完整皮肤，差异化最大且仍保持代码边界；需要资源签名、缓存生命周期、皮肤能力协商和较多截图回归，平台维护成本明显增加。

### 方案五：白名单组件变体与布局槽位引擎

**做法。** 将 design-system 的公开组件扩展为有限 variant，例如 `card:flat/elevated/outline`、`button:solid/outline`、`nav:bottom/rail`、`chart:line/candle`、`list:comfortable/compact`。Bootstrap 只选择已注册的 variant 组合和少量 layout slot，不下发 JSX、脚本、任意布局树或任意样式字符串；App 通过统一 `ThemeVariantProvider` 映射到已测试的组件实现。

**覆盖效果。** 可以组合出差异最大的金融、终端、杂志、霓虹和极简风格，并按模块选择不同的卡片、筛选器、行情图和导航外观。

**契约与治理。** 必须先建立 variant capability matrix：每个 App build/runtime 支持哪些 variant、哪些组合互斥、哪些页面禁止使用。服务端保存前校验组合，Admin 只展示当前 App 能力；高风险页面（签名、授权、转账）只能使用安全组件变体。该方案应单独建立 ADR，记录体积、维护性、原生影响和退出策略。

**验证。** 进行 schema fuzz/property test、变体组合测试、页面状态和深链测试；保证 role/label/testID 不变，TalkBack/VoiceOver 焦点顺序不变；对列表、图表和底栏做性能基线；完成双端 Development Build、Maestro 关键路径、OTA/全量边界和灰度停止条件验证。

**优点与风险。** 灵活度最高，长期可形成白标平台能力；实现成本、组合爆炸、无障碍回归和性能风险也最高，不能在没有能力矩阵和设计审核的情况下直接开放给租户。

### 方案六：Foundation Classic（当前 App 基线）

**做法。** 继续使用当前全局语义主题：`theme.light/dark` 17 个颜色令牌，由 `FoundationThemeProvider` 映射到 Tamagui，支持 Light / Dark / System 和 `allowUserOverride`。Wallet、Predict、DEX、AppShell、设置和弹层共用同一套视觉，不使用模块 scope、Skin Pack 或组件布局变体。

**覆盖效果。** 这是稳定兼容的基础主题，能改变品牌色、背景层次、涨跌色和风险色；不能改变字体、密度、圆角、卡片形态、图表样式或导航结构。它对应第 4.1 节的 `foundation-classic`，但“当前基线”表示保留租户当前已保存的 palette，不得把所有存量租户强制改成内置金色。

**模块行为。** 主题与模块开关完全独立。四种 `predict/dex` 组合按 2.1 矩阵生效；关闭模块不因主题仍存在而显示入口或发起 Query。

**验证与回滚。** 复用当前 schema、Provider、Admin 主题工作台和已有截图；回滚就是恢复上一版 `mobile-bootstrap.theme` JSON。该方案的已验证范围只代表当前语义主题链路，不代表其他五款主题已完成。

## 4. 横向比较与推荐顺序

| 方案                 | 风格覆盖               | App 改造量 | 服务端契约                         | OTA/全量边界             | 主要风险             | 建议               |
| -------------------- | ---------------------- | ---------- | ---------------------------------- | ------------------------ | -------------------- | ------------------ |
| 1 调色板预设         | 颜色                   | 很低       | 现有 theme 增加受控元数据          | Bootstrap/OTA            | 差异有限             | 立即可做 MVP       |
| 2 令牌主题包 v2      | 颜色、排版、密度、形状 | 中         | 扩展 versioned tokens              | JS/Bootstrap；字体走全量 | 布局溢出、阴影性能   | 首选中期方案       |
| 3 模块作用域         | 模块品牌差异           | 中高       | 增加 scopes 与模块联动校验         | 主要是 JS/Bootstrap      | token 串用、组合爆炸 | 有明确模块诉求再做 |
| 4 预置 Skin Pack     | 完整皮肤和资源         | 高         | manifest、资源签名/缓存            | 资源可 OTA；原生资源全量 | 安全、缓存、兼容     | 规模化白标阶段     |
| 5 变体/槽位引擎      | 最大                   | 很高       | capability matrix + variant schema | 布局/原生变化按全量      | 复杂度和无障碍       | 长期平台能力       |
| 6 Foundation Classic | 当前结构与全局语义色   | 已有       | 现有 v1 theme                      | Bootstrap/OTA            | 差异有限、范围固定   | 兼容/回滚基线      |

推荐路线是 **6 → 1 → 2 → 4**：保留 Foundation Classic 作为兼容与回滚基线，先用 preset 消除单一配色，再把排版、密度、形状收敛成可复用 token，最后在租户数量和皮肤运营需求证明确实存在后引入签名 Skin Pack。方案 3 作为模块差异的专项能力，方案 5 暂不作为租户自由配置入口。

## 4.1 六个可供租户选择的示范主题

实现方案是能力层，主题是运营层的具体产品选项。首批可用以下六个受控主题，并让 Admin 在同一预览页对照 Wallet、Predict MarketList/EventDetail、DEX Market/Swap：

| 主题               | 视觉方向                                | 首选实现方案 | 主要注意事项                                  |
| ------------------ | --------------------------------------- | ------------ | --------------------------------------------- |
| Exchange Gold      | 黑金交易所、强主操作、清晰涨跌          | 方案一       | 仅颜色差异，作为兼容基线                      |
| Ocean Glass        | 蓝青、半透明层、轻玻璃质感              | 方案二或四   | Android 阴影、模糊和内存预算                  |
| Forest RWA         | 深绿、低饱和、资产与安全优先            | 方案三       | Wallet 安全语义与模块作用域隔离               |
| Editorial Light    | 米白、靛蓝、弱边框、信息卡片            | 方案二       | 排版 token、动态字体和长文案换行              |
| Terminal Neon      | 近黑、荧光青紫、数据终端感              | 方案四或五   | 等宽字体需全量包，图表对比度和减少动效        |
| Foundation Classic | 当前 App 的全局语义主题、统一卡片和底栏 | 方案六       | 保留当前租户已保存 palette；作为兼容/回滚基线 |

这些名称和配色只是产品 preset，不允许租户把 `danger`、`risk`、`focus` 或涨跌语义任意改成不可读颜色；主题选择仍须通过同一套服务端校验和灰度流程。Exchange Gold 必须在交易密度、卡片层级或图表网格上与 Foundation Classic 有可截图验证的形态差异，否则只能算颜色变体，不能宣称为独立 UI 风格。

## 4.2 给实现 agent 的交接规范

实现顺序固定为“契约 → 纯函数解析 → 运行时 Provider → 模块行为 → Admin → 发布验证”，不能先改页面颜色再补契约。

### Phase 0：锁定决策

- 选择一个主路径；推荐先交付方案 6/1，再按需要进入方案 2/3/4。
- 固定六个稳定 ID：`foundation-classic`、`exchange-gold`、`ocean-glass`、`forest-rwa`、`editorial-light`、`terminal-neon`。中文名称只用于显示。
- 把 `modules` 四态和 2.1 矩阵写入 Change Spec；`00` 是正式的 Wallet-only 状态，不是异常、演示或空页面。
- 明确禁止远程 JSX、JS、脚本、任意 URL/CSS、任意布局树；只允许 strict JSON、白名单 token、variant 和已校验资源。

### Phase 1：三端契约同步

修改范围：RN-App `src/core/config/bootstrap.schema.ts`、`src/core/config/fallback-config.ts`、`src/test/harness.tsx`；RN-Server `mobile-bootstrap` 生成/保存校验和 OpenAPI；RN-Admin `src/core/api.ts`、`pages.tsx` 校验与编辑器。

要求：

- `theme` 使用明确的 `schemaVersion`/`profileVersion`；关键子对象采用 `.strict()` 或等价未知字段拒绝策略，不能依赖 Zod 默认剥离未知字段。
- `modules.predict` 和 `modules.dex` 必须显式下发；取消现有 `predict || dex` 的 `00` 拒绝逻辑，并同步 Server/Admin 的“至少开启一个”校验和文案。
- 增加跨字段校验：Predict 开启时 `services.predict` 必须完整且 scopeId/chain 通过校验；Predict 关闭时 App Bootstrap 不下发该服务。关闭模块的 scope 可保留在 Admin 草稿，但不得进入已发布 Bootstrap。
- 主题与 modules 必须同一 `configVersion` 原子发布；主题切换不能触发业务 Query 重拉，模块切换才清理对应 Query/订阅/活动路由。
- 处理旧客户端：旧客户端收到旧 v1 配置时明确按方案 6；新客户端收到旧配置也明确按方案 6；未知 schema/skin/variant、缺失必填字段或能力不匹配时整份配置拒绝并保留最近一次成功快照，不能解析成功后静默使用另一方案。

Phase 1 DoD：四态 schema/contract tests、Admin `expectedVersion` 冲突与审计 reason、租户隔离、未知字段/禁用 scope/缺失 Predict service 失败测试、OpenAPI breaking-change 检查。

### Phase 2：主题解析与运行时

修改范围：`src/design-system/foundation-theme-provider.tsx`、`src/design-system/tamagui.config.ts`，新增 `theme-profile.ts`/`theme-registry.ts` 或等价 core 能力；方案 2/4/5 还需迁移 `Card`、`Button`、`ScreenHeader`、`Sheet`、`Chart`、Tab 等公共 recipe。

要求：先将 canonical `ThemeProfile` 解析为已注册能力，再把结果交给 Tamagui；不要让 feature 直接读取远程 JSON。主题作用域只影响允许的模块 token，不能覆盖 `danger`、`risk`、`focus` 或签名安全字段。新字体、原生图标和 ABI 变化必须标记全量包。

Phase 2 DoD：六主题的 Light/Dark/System、最大字体、reduced motion、RTL/无障碍测试；主题 apply latency、重渲染、颜色对比度和色盲检查；Admin 预览与 App 使用同一 canonical JSON。

### Phase 3：模块开关与路由

修改范围：`src/features/foundation/app-tabs.ts`、`app-shell-screen.tsx`、`module-gate.tsx`、首页/资产/设置/个人中心，以及所有 Predict/DEX hooks。

必须写成 Given/When/Then：

- `11`：底栏 Home/Predict/DEX/Assets，两类 Query 可发起。
- `10`：底栏 Home/Predict/Positions/Assets，DEX 入口、深链、Query、订阅均不可用。
- `01`：底栏 Home/Market/Swap/Assets，Predict 入口、深链、Query、订阅均不可用。
- `00`：底栏 Home/Assets；首页无业务模块卡片，资产只显示钱包收发/记录，设置不显示交易项；Predict/DEX gateway 不出网，深链和推送点击由 ModuleGate 拦截并回到安全页面。

运行时从开启变为关闭时，当前模块页卸载、回到 Home、取消 pending query/订阅并清理临时状态；不能继续显示旧模块数据。必须专测 `FoundationHomeScreen` 当前无条件 `useDexTokens` 的缺口，并让 `ModuleGate` 的 blocked 结果可观测（统一页面状态或 telemetry），不能只 `return null + popToTop` 而没有可验证证据。

### Phase 4：Admin 工作台

主题选择、模块开关、scope/variant 能力、四态预览、真实页面预览、草稿 diff、保存原因、版本冲突和回滚都在同一配置工作流中。关闭模块时明确显示“草稿可保留，已发布 Bootstrap 不生效”；服务端不得把 disabled scope/service 下发到已发布 Bootstrap，也不能静默清空草稿。

### Phase 5：发布与证据

每个阶段交付必须列出变更文件、通过项、未运行项、OTA/全量判断、灰度指标和回滚 JSON。选定主题后至少提供 Wallet、Predict、DEX 各一条关键页面的 Golden screenshot；四态模块组合先做 smoke 全覆盖，再对选中的主题/页面做全量视觉回归。

## 5. 统一验证矩阵与发布门禁

每个方案在进入开发前都应生成 Change Spec，写明用户场景、页面状态、API/schema、钱包/链影响、OTA/全量判断、灰度指标和回滚 JSON。最低验证矩阵如下：

| 维度       | 必须验证的证据                                                                                                                                                                     |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 契约       | RN-Server OpenAPI 与 Admin/App Zod 同步；严格处理未知/缺失字段；`expectedVersion`、审计、签名、重放和租户隔离测试                                                                  |
| 主题正确性 | 每个 preset/skin 的 Light/Dark/System、对比度 AA、色盲模拟、涨跌双编码、风险色和 focus 色检查                                                                                      |
| 页面状态   | Wallet/Predict/DEX 关键页覆盖 initial-loading、refreshing、content、empty、recoverable-error、offline-stale、permission-denied、blocked                                            |
| Web3 安全  | 金额使用 bigint/string + decimals；地址、chainId、token、spender/recipient、gas 在签名前清晰展示；拒签、切链、重入和交易终态回归                                                   |
| 可访问性   | 最大字体、最小触控目标、VoiceOver/TalkBack role/label/hint/state、焦点顺序、RTL（若开启）、减少动效                                                                                |
| 视觉与交互 | RN Testing Library、交互测试、Golden screenshot；Admin 预览与 App 同源配置；模块四种组合与跨模块导航                                                                               |
| 运行时     | Bootstrap 刷新、进程重启、慢网、离线旧快照、缓存原子切换、未知 skin/variant、OTA 回滚和旧客户端能力协商                                                                            |
| 性能       | 冷启动、主题应用延迟、Provider 重渲染、列表掉帧、图片/字体内存、Android 阴影与低端机表现                                                                                           |
| 发布       | `pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm api:check`、`pnpm config:check`、`pnpm i18n:check`；涉及原生时补充 iOS/Android Development Build 和关键 E2E |
| 观测与停止 | `theme_parse_failure`、`theme_apply_latency`、`contrast_violation`、`theme_asset_integrity_failure`、UI crash、页面掉帧；明确灰度停止阈值并可恢复上一版配置                        |

## 6. 数据、兼容与回滚原则

- 优先复用 `app_configs.mobile-bootstrap`、现有版本字段和 `audit_events`，不为主题另建登记表；若引入大资源包，先证明现有 branding 资源模型不能承载，再附复用映射表和列注释。
- Bootstrap 新字段应放入带 `schemaVersion` 的受控子对象，并对关键子对象采用 strict schema。不能依赖 Zod 默认剥离未知字段，否则会出现配置解析成功但样式未生效。
- 服务端按客户端 build/runtime 能力下发可用 preset/skin/variant；已发布旧客户端只接收它理解的契约版本。关键能力缺失或不符时显示明确错误/阻断，并保留最近一次成功快照的既有可靠性机制。
- 回滚优先把 RN-Admin 的上一版 `mobile-bootstrap.theme` JSON 按 `expectedVersion` 保存回去；若涉及新增原生字体、图标或 ABI，则必须发布对应全量包，不能仅靠 OTA 回退。

## 7. 当前基线验证记录

本次方案基于工作区 `main` 完成盘点；当前唯一工作区变更是新增本方案文档。已验证的主题基线包括：

- `src/core/config/bootstrap.schema.spec.ts`：拒绝不安全颜色值。
- `src/test/harness.spec.tsx`：设计系统读取租户主题并渲染。
- `src/features/settings/settings-screen.spec.tsx`：外观预览读取下发 Light/Dark palette。
- `pnpm typecheck`：通过。

本轮实际定向运行 6 个 Jest suites、49 个 tests，全部通过：Bootstrap schema、测试 harness、设置页、Wallet 列表、Predict 市场列表、DEX Swap。输出包含既有 Expo Go notifications、React `act` 和异步句柄 warning；它们没有导致测试失败，但不应当被写成“无告警”。

这些证据证明现有 Foundation Classic 语义主题链路可复用，但不等同于其他五款新主题已经实现。全量 Jest 本轮为 147 suites / 1125 tests，其中 144 suites / 1117 tests 通过，3 个与本方案无关的既有失败来自 `series-screen` 日期分组、OTA signing key 脚本和 release keystore 脚本，共 8 个 tests；iOS/Android 真机截图、生产 Bootstrap、Admin 与 Server 联调仍需在选定方案后按上方矩阵执行并单独记录。
