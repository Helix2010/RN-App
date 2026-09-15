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

## 关键点：只改 App 不生效，而且根因不在 App

覆盖关系是三层，后面盖前面：内置文案 → bootstrap 的 inline `messages`（服务端按
`language_document` 实时编译）→ 已发布的语言包 `resource`（App 在
`bootstrap-repository.ts:200` merge 在 inline 之上）。改之前 bootstrap 下发的
`action.refresh` 就是 `Refresh configuration`。

根因在 RN-Server：内嵌的 RN-App 种子（`internal/store/localization_seed.go`）一直是
`ON DUPLICATE KEY UPDATE id=id`，**只补缺键、不改已有值**，所以代码里改过的文案永远
到不了库里那行全局记录。已在 RN-Server `fix(i18n): 启动种子把全局文案行也对齐` 改成
`content=VALUES(content)`（meta 不覆盖，mtime 只在内容真变时动），并补了库测。

对齐时线上库里查出 **25 条**陈旧全局行，其中几条是错的不是旧的：

- `split.hint.split` / `split.hint.merge` 把 USDW 写成 **USDC**，代币名不对
- `profile.logoutHint` 少了「本机保存的助记词与私钥不会被删除」这句
- `settings.txConfirm.hint` 写死 Face ID，Android 上不适用
- `update.pausedNetwork` / `pausedStalled` 没说会自动续传
- `wallet.setup.createHint` 写死「12 个助记词」
- `nav.profile`、`assets.today`、`assets.available` 是更短的新标签

## 线上处置

1. RN-Server 部署后 `rn-server migrate` 把全局行对齐（本次用 `systemd-run` 单跑
   migrate，没重启 API）；
2. 删掉 anyfun 的 **84 条租户覆盖**（42 键 × 2 语言）——那是当时为了救急写的，内容
   与种子完全一致、零真实定制，留着只会永久遮住以后的 App 文案更新；
3. 重新发布语言包，让快照跟上。

验收：bootstrap 下发的 1245 键 × 2 语言与 `i18n/seed/` **全量 0 处不一致**；模拟器上
首页/资产/邀请的下拉刷新标签为「刷新」，资产页显示新的短标签 `Today`。

## 影响

纯文案，无原生变更，可走 OTA。回滚 = 改回旧值、重新同步种子并发布。
