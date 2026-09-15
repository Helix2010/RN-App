# Fix: 共用基座的默认值里写死了一个租户的品牌名

状态：Implemented（`pnpm check` 全绿 167 套 / 1344 测试；服务端迁移 51 已在线上跑过；模拟器复核）

## 现象

白标基座里有四处把当时唯一那个租户的名字 `AnyFun` 写成了默认值：

| 位置 | 作用 |
|---|---|
| `app.config.ts:189` | `name: tenant?.appName ?? "AnyFun"` |
| `src/core/config/builtin-messages.ts` ×2 | `app.name` 内置文案 |
| `src/core/config/fallback-config.ts:102` | 离线兜底配置的 `branding.launch.title`（而且两个 locale 写的是同一个值） |

内置文案还会被导出成种子、进服务端的**平台全局**文案目录，所有没自己配的租户都继承它。
再加上服务端早期文案迁移（13、15）也把 `launch.title`、`app.name` 的全局行写成了
`AnyFun`——而 `branding.launch.title` 就是取 `launch.title` 这个键——**任何新租户的
启动页和关于页都会显示别人的品牌**。

## 处理

App 自己的名字只有一个来源：`tenants/<slug>/tenant.json` 的 `appName`，经
`app.config.ts` 写进原生应用标签与 manifest。运行时加 `appRuntime.appName`
（`Application.applicationName`，取不到时退到 `Constants.expoConfig.name`）把它读回来，
三处显示位置改成用它，不再经过共用文案：

- `src/app/runtime-context.tsx:619` 启动页标题
- `src/features/settings/about-screen.tsx:78,154` 关于页标题与版权行
- `fallback-config.ts` 的 `launch.title`

`app.name` 这个键在 App 侧已无使用者，从内置文案里删掉（种子 1245 → 1244 键）。
服务端只有邀请落地页读它，而它读的是 `app_configs` 那份，且缺值时退到「应用」。

服务端加迁移 **51 `tenant_neutral_platform_brand_copy`**：把 `tenant_id=0` 的
`launch.title`、`app.name` 内容清成**空串**。

**为什么清空而不是删行**：bootstrap 的 `branding.launch.title` 是
`messages[titleKey]`，键不存在就下发 `null`，而 App 侧 schema 是 `z.string()` 非空——
现网所有安装会直接解析失败。空串是合法 string，App 拿到空值后退到这个包自己的名字。

**顺序上的坑**：启动种子在迁移之后跑，所以必须同时同步服务端内嵌种子（`app.name`
已从中移除），否则种子会把刚清空的行又写回 `AnyFun`。

## 防回归

- `src/core/config/tenant-neutral-defaults.spec.ts`：读 `tenants/*/tenant.json` 的
  `appName`，断言没有一条内置文案的值等于其中任何一个；断言离线兜底的启动页标题
  取 `appRuntime.appName`。把 `app.name` 加回去时该测试失败（3 处命中）。
  用相等而非包含判定——将来可能有租户叫「钱包」这类通用词，包含判定会满屏误报。
- `internal/store/platform_brand_copy_test.go`：迁移后全局行仍存在且为空串、
  租户自己的覆盖不受影响、之后再跑启动种子也不会把品牌名写回来。

## 修这个时顺手暴露的一个问题

`bootstrap-repository.spec.ts` 里手写的 `appRuntime` mock 缺了 `appName`，于是
`fallback-config` 造出 `title: undefined`，`JSON.stringify` 把这个键整个丢掉，
19 个用例都报「响应不符合契约」。mock 得跟真模块的形状一致，已补上。

## 影响

App 侧无原生变更，可走 OTA；但 `app.config.ts` 的 dev 占位名改动只影响本地开发构建。
服务端是一次前向迁移，不可逆（旧值是某个租户的品牌名，本来就不该在平台默认里）。
