# Bugfix: 本机钱包存储 fail-closed（N4 / N7 / N8 / N9 地址校验 / N35 / N38）

状态：Implemented，待 code review 与真机验证  
类型：bugfix · 模块：core/wallet/vault、features/wallet、features/session  
依据：`docs/design/cross-platform-wallet-key-security-adversarial-review-2026-09-09.md`（修订 3）与 `docs/design/wallet-security-phase0-scope-2026-09-10.md` A1-1 ～ A1-6

## 用户场景与现状证据

- 用户/角色：持有本机自托管钱包的用户；能写 AsyncStorage 的同设备进程（root / 被替换的升级包）。
- 当前行为（修复前）：
  - vault 文件 JSON 损坏或版本不认识时 `read()` 返回空 vault，随后任何写入整体覆盖原文件；界面因 0 条目引导用户"创建钱包"，旧密文永久丢失（N7）。`keystore-vault.spec.ts` 的 "survives a corrupted vault file" 把它固化为规格。
  - SecureStore 里没有 WK 时 `wrapKey()` 无条件铸新并写入，不看文件里是否已有条目；同一 vault 里的条目分属两把 WK 且无法检测（N8）。
  - `putSecret` 的 读→取 WK→写 之间没有锁，并发创建/导入会丢条目或产生两把 WK（N35）。
  - `revealMnemonic` 与签名共用 5 分钟 `cachedWrapKey`：刚签完一笔交易，点进备份页就能不弹认证看到助记词（N4）。`remove`/`wipeAll`/向非空 vault 导入都不要求认证。
  - 解密成功即返回，不核对解出的材料是否属于条目登记的地址；对调两条目的密文后 `signMessage/signTypedData` 会用 B 的私钥替 A 签名（N9）。
  - 账户注册表 `readRegistry()` 损坏时同样返回空表并被覆盖（N38）。
- 代码调用链：`backup-screen.tsx` → `gateway.revealMnemonic` → `vault.revealMnemonic` → `decrypt` → `unlock`（缓存）；`use-session.ts connect("embedded")` → `vault.list()` → 0 条目 → `needs-wallet` → `WalletSetupScreen.create` → `putSecret` → `write` 覆盖。
- 非目标：`unavailable`（设备未录入生物识别 / 锁屏）仍放行，这是 N10 的独立产品决策；`withPrivateKey` 仍把私钥字符串交给回调（N5，原生签名器范围）；助记词仍经 navigation 参数（N36，另一变更）。

## Given / When / Then

1. Given vault 文件是 `{not json` 或 `version: 2`，When 调用 `list/has/createWallet/importMnemonic/markBackedUp`，Then 抛 `WalletVaultCorruptedError`，原文一个字节不变；When 用户明确 `wipeAll`，Then 先把原文写到 `foundation.wallet.vault.v1.corrupt.<ISO>` 再删。
2. Given vault 有 ≥1 条目而 SecureStore 无 WK，When `verifyWrapKey/reveal/withPrivateKey/import`，Then 抛 `WalletVaultKeyMissingError("missing")`，SecureStore 不被写入；条目仍可 `list()`。
3. Given 文件登记的 `wkCheck` 与密钥库里的 WK 不符，When 任何解密，Then 抛 `WalletVaultKeyMissingError("mismatch")`，不触碰密文。
4. Given 修复前写出的文件（无 `wkCheck`），When 一次解密成功（GCM 认证通过），Then 补写 `wkCheck`；再解密不再写文件。
5. Given 两个并发 `importMnemonic`，Then 两条都落盘且只写一次 WK。
6. Given 两条目的 `ciphertext/salt/nonce` 被对调，When `withPrivateKey/revealMnemonic`，Then 抛 "does not belong to this account"。
7. Given 刚用 `withPrivateKey` 签过名（缓存有效），When `revealMnemonic`，Then 仍弹一次认证；reveal 也不给签名预热缓存。`remove`/`wipeAll`/向非空 vault 导入同样独立认证；导入不传 `reason` 而 vault 非空即失败。
8. Given 注册表 JSON 损坏或版本不认识，When `listAccounts/connect/rename`，Then 抛 `WalletRegistryCorruptedError`，原文不变。
9. Given 上述任一错误发生在登录流程，When `connect("embedded")` 或签名，Then 登录 sheet 进入 `needs-recovery`，显示原因与"归档旧数据并导入助记词"，不显示"创建钱包"。
10. Given 用户点"归档旧数据并导入助记词"，Then `recoverStorage` 只归档确实损坏的部分（注册表不弹认证；vault 归档前弹认证），健康的 vault 一律不动；完成后跳转导入页。

## UI 与交互状态

- 登录 sheet 新增 `needs-recovery` 面板（`testID=login-recovery`）：图标 + 原因文案（corrupted / keyMissing）+ 主按钮归档并导入 + 关闭。归档中按钮禁用；取消系统验证时 toast `wallet.recovery.failed`，数据不动。
- `WalletSetupScreen` 创建失败时若是恢复类错误，toast `wallet.recovery.blocked` 而不是"创建失败请重试"。
- `WalletImportScreen`：导入到非空 vault 会弹系统验证（文案 `wallet.import.authReason`）；取消显示 `wallet.import.authRequired`；存储损坏显示 `wallet.recovery.blocked`。
- light / dark / 字体放大：复用设计系统 `Row/Body/PrimaryButton/SecondaryButton`，无裸值。

## 技术影响

- API/OpenAPI：无。
- 状态与本地数据：
  - vault 文件新增可选字段 `wkCheck`（HKDF-SHA256(WK, salt=`foundation.wallet.wk-check.v1`) 前 8 字节 base64）。老文件在首次成功解密后补写，幂等；不改变 `version`。
  - 新增归档键 `foundation.wallet.vault.v1.corrupt.<ISO>` 与 `foundation.wallet.accounts.v1.corrupt.<ISO>`，只在归档时写入，不自动清理。
  - `KeystoreVault.remove/wipeAll` 增加必填 `reason`；`importMnemonic(phrase, index, reason?)`、`importPrivateKey(key, reason?)`；新增 `verifyWrapKey()`、`archiveAndReset(reason)`；`WalletGateway` 新增可选 `recoverStorage(reason)`，导入方法新增 `options.reason`。
- 钱包/签名/链/金额精度：签名路径的 5 分钟解锁缓存不变；每次签名多一次地址派生比对（毫秒级）。
- 权限、隐私与遥测：无新增；错误信息不含密钥材料。
- OTA 或全量更新：纯 JS，可 OTA。回滚到修复前 JS 时：`wkCheck` 字段被旧代码忽略；归档键不被读取；旧代码遇到损坏文件会恢复"清空覆盖"行为（这正是本修复要关的口子，回滚即重开）。

## 验证与发布

- 修复前失败测试：`keystore-vault.spec.ts` 新增/改写 12 个用例（损坏拒写、版本不符、WK 缺失不铸新、WK 不符、wkCheck 幂等补写、并发串行化、地址对调、reveal 独立认证、remove/wipeAll 认证、归档重置、verifyWrapKey）；`embedded-wallet-gateway.spec.ts` 新增 4 个（注册表损坏、连接时 WK 校验、只归档损坏部分、健康存储 no-op）。
- 实际运行（2026-09-10 工作树）：
  - `pnpm test -- --runInBand src/core/wallet src/features/wallet src/features/session`：22 suites / 237 tests 通过。
  - `pnpm typecheck`：通过。`pnpm lint`：通过。`pnpm format:check`：通过。`pnpm i18n:check`：1114 keys × 2 locales ok。
  - `pnpm test`（全量）：首轮记录的 `build-android-release.test.js` 失败已由发布链门禁变更修正；最新结果见文末"追加（评审修正）"。
- 未验证：iOS / Android 开发构建与真机（环境无 adb/xcodebuild）；登录 sheet 恢复面板与导入页认证弹窗只有类型与静态检查，未做组件交互测试；线上老文件的 `wkCheck` 补写只有单测覆盖。
- 灰度指标与停止条件：观察 `WalletVaultCorruptedError` / `WalletVaultKeyMissingError` / `WalletRegistryCorruptedError` 在遥测中的出现率；任何非零出现都要人工核对，是否为原本会被静默清空的存量用户。出现"健康用户被判 KeyMissing"（wkCheck 误判）即停止发布并回滚。
- 回滚：OTA 回滚到上一 rev。数据兼容见上；归档键保留，可用于事后恢复。

## 追加（2026-09-10）：新建钱包认证、系统弹窗文案只用内置字典、scrypt 死代码

- `KeystoreVault.createWallet(reason?)`：vault 已有账户时与导入一样先过独立认证；网关与 `wallet-setup-screen` 传 `wallet.create.authReason`。测试：第一枚钱包不弹、第二枚缺 reason 抛错、取消不写入、成功后两条。
- N12：`authenticate(reasonKey)` 与 `AuthenticatePort` 的参数改为内置字典 key；`core/security/prompt-text.ts` 只从 `builtinMessages(locale)` 取文案，key 不存在时用通用文案并告警，绝不把裸 key 或服务端字典串交给系统弹窗。所有调用方改传 key：签名默认 `wallet.sign.reason`、转出 `wallet.sign.transfer`、预测 `predict.sign.reason`、导入 `wallet.import.authReason`、恢复 `wallet.recovery.authReason`、备份展示 `backup.revealReason`、应用锁 `security.locked.subtitle` / `security.appLock.disableReason`、交易前验证 `security.verify.reason`。新增 4 个内置 key，seed 已重导出（1118 键）。测试：`prompt-text.spec.ts` 4 例，含 `authenticate()` 交给 OS 的是英文内置文案而非 key。
- 设备语言判断从 `runtime-context` 抽到 `core/config/system-locale.ts`，与弹窗文案共用。
- 移除 `deriveEntryKey` 的 scrypt 口令分支与 `SCRYPT_PARAMS`（主评审 §0.3 已判定为死代码）；派生结果不变（原分支在无口令时拼接的是空数组）。

## 追加（2026-09-10，独立评审后修正）

评审（RN-App 独立复核 2.2 / 1.5 / 2.3 / 2.4 / 2.5 / 1.1）指出的问题与处置：

1. **认证判定移进写队列（2.2）**。`createWallet/importMnemonic/importPrivateKey` 统一走 `addSecret`：读文件、"非空即认证"判定、认证、取 WK、写回都在同一个串行段内。两个并发的添加不会都看到空 vault 而一起免认证。测试：并发两条带 reason 的导入只弹一次认证；并发两条不带 reason 的导入第二条被拒。
2. **`wkCheck` 不再在加账户时盖到老文件上（1.5）**。只有空 vault 的第一条目登记 `wkCheck`；老文件（有条目、无 `wkCheck`）只在一次成功 GCM 解密后由 `backfillWkCheck` 补写。测试：老文件 + 导入 → 仍无 `wkCheck`；之后一次签名 → 写一次。
3. **老文件 + 错误 WK 有恢复路径（2.3）**。`decrypt` 在文件无 `wkCheck` 且 GCM 失败时抛 `WalletVaultKeyMissingError("mismatch")`（有 `wkCheck` 且核对通过时仍是笼统的"解不开"），登录流程因此进入 `needs-recovery`。新增 `verifyLegacyWrapKey(reason)`：老文件认证一次、真的解一条，解得开补写 `wkCheck`，解不开抛 mismatch；`recoverStorage` 在 `verifyWrapKey` 之后调用它，据此归档 vault。代价：这条存量路径恢复时会弹两次认证（探测一次、归档一次）。
4. **注册表坏了不再先写 vault（2.4）**。网关的创建/导入先 `readRegistry()`，注册表损坏在写入 vault 之前失败，不留孤儿条目。
5. **恢复结果被消费、不再吞异常（2.5）**。登录 sheet 按 `WalletStorageRecovery` 分流：归档了 vault → 去导入页；只归档了注册表 → toast `wallet.recovery.registryArchived` 并回到选择器；什么都没归档 → toast `wallet.recovery.failed`。`catch` 里用户取消认证只提示，其它错误 `console.warn` 留痕。新增内置 key `wallet.recovery.registryArchived`（seed 已重导出，1119 键）。
6. **N12 漏网（1.1）**。`connect-wallet-sheet` 的 `useWalletLogin(..., "login.reason")`、`dispute-sheet` 的 `reason: "predict.dispute.verifyReason"` 改传 key。
7. **测试补齐**。`use-wallet-login.spec.tsx` 新增 4 例：vault 损坏 / 注册表损坏 / WK 缺失 / WK 不符都进入 `needs-recovery` 并带正确 reason；新增 `connect-wallet-sheet.spec.tsx`：vault 损坏时显示恢复面板而非创建/导入，点归档后调用 `recoverStorage("wallet.recovery.authReason")`，只归档注册表时留在原地。
