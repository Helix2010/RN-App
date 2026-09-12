# Feature: 账户私钥与助记词分开保管（N29 第三部分 / N6）

状态：Done（核心已完成；设置口令的界面仍未接，见"还没做的"）

涉及仓库：RN-App。方案：`docs/design/wallet-key-hardening-2026-09-12.md` §3.3。

## 现状证据

`withPrivateKey` 解开条目拿到的是**助记词**，然后调 `assertOwner` 重新跑一遍 BIP-39 / BIP-32 派生。也就是说**每签一次名，根种子就进一次 JS 堆**，而 Hermes 没有字符串清零 API、字符串不可变且可能被驻留，进去了就擦不掉。

同时，拿到包裹密钥 WK 的人拿到的是可以离线、跨链、永久使用的那份材料，而不只是当前几个账户。

## 新的形状

```
accounts[]  密文 = 这个账户派生出来的那一把私钥
            key  = HKDF-SHA256(WK, salt)
            aad  = v2|address|kind|path|seedId

seeds[]     密文 = 助记词
            key  = HKDF-SHA256(WK ‖ scrypt(口令), salt)   开了口令保护时
                   HKDF-SHA256(WK, salt)                  没开时
            aad  = seed.v1|id|protected
```

`aad` 标记同时说明**密文里装的是什么**，并且它参与 AAD：把 `2` 改回 `1` 会让解密当场失败，不会出现"按错误的语义解读明文"。

一个改动同时解掉两件事：

- **N29 第三部分**：日常签名只解一把账户私钥，根种子再也不进堆。不需要原生派生模块。
- **N6 的爆炸半径**：拿到 WK 只能拿到已经存在的那几个账户，拿不到派生未来账户的能力，也拿不到那份永久有效的材料。想拿助记词必须再骗到用户口令，而骗口令是有声音的、会失败的、用户看得见的。

## 各操作需要什么

| 操作 | WK | 口令 | 系统验证 | 根种子进堆 |
| --- | --- | --- | --- | --- |
| 列出账户 | 否 | 否 | 否 | 否 |
| 签名 | 是 | 否 | 读 WK 时一次 | **否** |
| 导入私钥 | 是 | 否 | 是 | 否 |
| 查看助记词 | 是 | 是 | 是 | 是 |
| 新增派生账户 | 是 | 是 | 是 | 是 |

## Given / When / Then

- Given 一个 mnemonic 账户，When 签名，Then 解的是账户那把私钥，助记词条目不被触碰。
- Given 开了口令保护，When 签名，Then **不问口令**；When 查看助记词，Then 问口令。
- Given 用户取消输入口令，Then 看不到助记词，但签名照常。
- Given 账户的 `seedId` 被调包指向别人的助记词，Then 派生出的地址对不上，拒绝。
- Given 助记词条目整个丢了，Then 报"不在这个金库里"，不是笼统的解不开。
- Given 一个 v1 文件，When 签名，Then 先照旧解出助记词并派生（不中断用户），随后顺手就地升级成 v2；再签一次不会重复写盘。
- Given 删除账户，When 没有别的账户引用那条助记词，Then 一起删掉——留着等于"删了钱包，助记词还在设备上"。
- Given 老文件（没有 wkCheck）解不开助记词条目，Then 归类为 `KeyMissing(mismatch)` 进恢复流程，与账户条目同一套判定。

## 技术影响

- `keystore-vault.ts`：`StoredSeed`、`entryAadV2`、`secretKindOf`、`deriveSeedKey`、`writeSeed` / `readSeed`、`upgradeToV2` / `rewriteAsV2` / `upgradeVaultFile`；`addSecret`、`revealMnemonic`、`remove`、`enablePassphrase` 随之改写。
- `wrap-key-envelope.ts`：`derivePassKeyFor` —— 助记词条目要的口令密钥不能从已经解开的 WK 反推，否则拿到 WK 就等于拿到助记词，这次拆分就白做了。
- 升级**不落半截**：`upgradeToV2` 是纯同步的，由调用方在同一个写队列段里一起落盘。

## 已知取舍

同一条助记词导入两次会写两条助记词条目。去重要把所有助记词都解出来比对，而那正是这次改动要避免的事。

## 测试

`keystore-vault-entry-split.spec.ts` 11 例，其中 v1 升级那两例是**真的**造了一个 v1 文件（账户密文里装助记词、带 v1 AAD、没有 seeds），不是假装的。全量 145 套 1099 例通过，`tsc --noEmit`、eslint 干净。

## 还没做的

设置口令的界面。`enablePassphrase` 至今没有调用方，所以口令保护默认不开，助记词条目仍由 WK 单层加密。接上界面之前，这次改动拿到的是 N29 第三部分（根种子不进堆）和爆炸半径收窄，还没拿到"必须骗到口令才能拿走助记词"。
