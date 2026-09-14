# Fix: default-locale-from-tenant

状态：Implemented（自动化验证完成；真机未运行）

## 现有行为

- 语言偏好默认 `system`，客户端把设备语言硬映射成 `zh-CN` / `en-US` 两种之一，带着它请求
  `/v1/mobile/bootstrap?locale=…`。服务端只在这种语言没开启时才退回租户的回退语言，所以
  管理端「多语言管理」里设的**回退语言从来不是默认语言**：中文设备永远先拿到中文。
- 「跟随系统」只认中英两种，租户开了其它语言也匹配不到。
- 可选语言列表已经来自服务端下发的 `localeCatalog` / `supportedLocales`。
- 文案已经是「内置字典垫底 → 服务端下发文案覆盖 → 远程语言包覆盖」；但选中的语言没有
  内置字典时，垫底的一律是中文。

## 预期行为（验收条件）

1. 默认语言 = 租户在管理端设的回退语言：没选过语言时请求不带 `locale`，服务端按回退语言下发。
2. 语言设置第一项「默认语言」，右侧写着回退语言的名字（取自下发的语言目录）；其后「跟随系统」、
   再是服务端下发的语言目录。
3. 「跟随系统」把设备的「语言-地区」标签（如 `ja-JP`）交给服务端；租户没开这种语言时服务端
   同样退回回退语言。
4. 文案顺序不变：内置字典 → 服务端文案 → 远程语言包。选中语言没有内置字典时，用回退语言那份垫底。
5. 已安装用户：持久化偏好 v3 迁移把以前默认存下的 `system` 迁为 `default`（分不清是否主动选过）；
   主动选过的具体语言保留。
6. 升级后第一次启动，默认语言那一格还没有缓存时，读以前按设备语言存的缓存画启动页 / 断网兜底。
7. 系统验证弹窗（只能用内置字典）跟应用当前显示的语言走；那种语言没有内置字典时取设备语言。

## 改动

- `locale-change.ts`：`requestLocale(preference, deviceLocale)` 决定请求带的语言，`default` → 不带。
- `system-locale.ts`：新增 `deviceLanguageTag()`；`systemLocale()` 只留给拿不到下发的地方
  （崩溃页、验证弹窗兜底、下发到达前的启动门禁）。
- `bootstrap-repository.ts` / `use-bootstrap.ts`：locale 可为 null；缓存与 query 键用 `default`；
  内置字典按 `hasBuiltinMessages` 选垫底语言。
- `preferences-store.ts`：`LocalePreference` 加 `default` 并设为默认值；`migratePreferences` v3。
- 语言设置页、设置页语言行、`prompt-text.ts`。
- 新增文案 `settings.defaultLanguage`（1206 键），i18n seed 已同步到 RN-Server。

## 服务端（RN-Server `fix/default-locale-fallback`）

生产实测发现服务端也不对：不带 `locale` 时，服务端先落到应用配置里旧的
`localization.fallbackLocale`（种子里是 zh-CN），而不是管理端「多语言管理」里的回退语言
（anyfun 设的是 en-US，返回的却是 zh-CN）；只有请求的语言没开启时才用到管理端的设置。
更新说明也在语言定下来之前就按 zh-CN 取了。

修复：先解析租户的语言设置，`locale` = 请求的语言（开启时）否则管理端回退语言，再往下走。
回归测试 `TestDBBootstrapDefaultsToTenantFallbackLanguage`（不带 / 开启 / 未开启三种），
撤掉修复时该测试失败（拿到 zh-CN）。

**上线顺序：先服务端后 App**。App 先上而服务端没上时，默认语言的用户拿到的是旧的 zh-CN
默认，和改动前一样，不会出错，只是还不生效。

未做：`en-GB` 这类只差地区的设备语言不会匹配到租户开启的 `en-US`，会走回退语言。

## 验证

- 新增 / 更新：`locale-change.spec.ts`、`preferences-store.spec.ts`、`language-settings-screen.spec.tsx`、
  `bootstrap-repository.spec.ts`（不带 locale 的请求与缓存键、非内置语言的垫底、旧缓存兜底）、
  `prompt-text.spec.ts`。
- 真机、生产租户下切换回退语言的端到端未运行。

## 回滚

回退本提交即可。偏好已迁到 `default` 的设备回滚后会被当作一个具体语言码处理：旧版本把它
原样带进 `?locale=default`，服务端校验语言码失败返回 400——回滚时需要同时发一个把
`default` 迁回 `system` 的版本，或者不回滚。
