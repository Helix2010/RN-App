# Fix: `action.refresh` 的「刷新配置」被 10 个页面当下拉刷新与按钮文案用

状态：Implemented（`pnpm check` 全绿；服务端文案目录同步并发布）

## 现象

`action.refresh` 的值是「刷新配置」/「Refresh configuration」，但它在 12 处被用作
下拉刷新的可访问名和两处可见按钮文案，其中 11 处并不刷新配置：

| 位置 | 用法 | 准确吗 |
|---|---|---|
| `foundation-home-screen.tsx:114` | 下拉刷新 a11y | 准确（`runtime.refresh()` + 数据 refetch） |
| `assets-screen.tsx:194` | 下拉刷新 a11y | 不准（只 refetch 余额） |
| `records-screen.tsx:465` | 下拉刷新 a11y | 不准 |
| `transfer-form.tsx:339` | **可见按钮文案** | 不准（重取手续费与余额） |
| `account-detail-screen.tsx:171`、`:399` | 下拉刷新 a11y | 不准 |
| `account-detail-screen.tsx:202` | **可见按钮文案** | 不准 |
| `predict/ui/market-list-screen.tsx:465` | 下拉刷新 a11y | 不准 |
| `predict/ui/positions-screen.tsx:224` | 下拉刷新 a11y | 不准 |
| `dex/ui/market-screen.tsx:105` | 下拉刷新 a11y | 不准 |
| `dex/ui/swap-history-screen.tsx:76` | 下拉刷新 a11y | 不准 |
| `referral/ui/referral-screen.tsx:257` | 下拉刷新 a11y | 不准 |

是既有问题，邀请页只是第 12 个用上它的地方。

## 处理

把值改成中性的「刷新」/「Refresh」，**不新增键**。理由：改完在 12 处全部准确，
包括首页——首页那次刷新确实也是「刷新」，只是范围更大；而给每页各配一个键要
新增四五个键、且每个键只有一个使用者，不值当。两处可见按钮文案跟着变准。

## 关键点：只改 App 不生效

App 的文案是 `{...builtinMessages, ...serverMessages}`，服务端下发的同名键覆盖内置值。
改之前 `GET /v1/mobile/bootstrap` 下发的 `action.refresh` 就是 `Refresh configuration`，
所以这次同时把新值推到服务端文案目录（`PUT /v1/admin/localization/documents`）并发布
（`POST /v1/admin/localization/publish`），两边一致后设备上才会变。

## 影响

纯文案，无原生变更，可走 OTA。回滚 = 改回旧值并重新发布文案目录。
