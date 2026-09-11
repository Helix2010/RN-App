# Feature: 外泄出口上的秘密扫描（§12.2 的 canary secret 扫描）

状态：Done

涉及仓库：RN-App。评审：`docs/design/cross-platform-wallet-key-security-adversarial-review-2026-09-09.md` §12.2「日志、崩溃、分析和客服采集做 canary secret 扫描；发现 mnemonic/private key/pairing URI 即阻断」。

## 用户场景与现状证据

- 用户/角色：钱包导入失败后点"复制诊断信息"发给客服的普通用户。
- 当前行为与代码证据：`root-error-boundary.tsx` 的 `diagnostics()` 把 `error.message` 和 `componentStack` 拼成一段文本，`copy()` 直接 `Clipboard.setStringAsync` —— 这是应用里少数几个**内容离开设备**的出口，而其中两段的内容**不受我们控制**。导入失败、解密失败这类路径都会把用户输入拼进异常 message。
- ESLint 那条规则（A2-7）只管得住"有人直接把 phrase 写进 `console.*`"。真正会出事的是拼起来的那种：每一步都没有人写过 `console.log(phrase)`，但助记词还是出去了。
- 非目标：把出口整段丢弃（诊断的价值就在于看得懂发生了什么）；按形状拦私钥（见下）。

## Given / When / Then

- Given 异常 message 里带着助记词，When 用户点"复制诊断信息"，Then 剪贴板里那段助记词是 `[redacted:secret]`，其余诊断（diagnosticId、版本、componentStack）原样可读。
- Given 同一段文本里还有 WalletConnect 配对 URI，Then 一并遮蔽。
- Given 文本里是交易哈希、区块哈希、组件栈、普通报错，Then 一个字都不动。
- Given 开发/预发构建登记过 canary 值，When 它出现在任何扫描过的出口上，Then 命中并遮蔽。
- Given 登记一个太短的 canary（`0x`），Then 不收——它会命中一切，把扫描变成噪声。

## UI 与交互状态

界面无变化。诊断文本里可能多出 `[redacted:secret]`。

## 技术影响

新增 `src/core/security/secret-scan.ts`：`findSecrets()` / `redactSecrets()` / `registerSecretCanary()`。接在 `root-error-boundary` 的 `diagnostics()` 与 `componentDidCatch` 的日志上。

### 为什么不按"64 位十六进制"找私钥

私钥、交易哈希、区块哈希、EIP-712 摘要、WalletConnect 的 symKey、scopeId —— 形状**完全一样**都是 `0x` + 64 hex。这个应用的诊断信息里交易哈希遍地都是，按形状拦截等于把正常诊断全打上马赛克，最后没人再看诊断。

所以只做两类**高精度**判定，外加显式登记的 canary 名单兜底：

- **助记词**：连续 12 个以上的词全部落在 BIP-39 英文词表里。表里只有 2048 个常用短词，但连续十二个英文单词恰好全在表内的概率低到可以忽略。
- **配对 URI**：`wc:<topic>@N?…symKey=<hex>`，形状独特，拿到它等于拿到会话对称密钥。
- **canary**：形状判定不了的东西（私钥就是典型）靠它。值是我们自己种的，出现即精确命中、零误报。

## 两个实测出来的发现

### 1. `phrase` 这个词本身就在 BIP-39 词表里

最初按 BIP-39 的合法长度判定（恰好 12 / 15 / 18 / 21 / 24 个词）。测试直接挂在最典型的形状上：

```
phrase: legal winner thank year wave sausage worth useful legal winner thank yellow
```

`phrase` 在词表里，于是连续长度是 **13**，不是任何一个合法长度，判定整个失效。`error`、`wallet` 之外还有一大批常用短词都在表里，助记词旁边挨上一个是常态而不是例外。

改成**只看下限**（≥ 12），命中后把整段连续词一起遮蔽。多盖掉几个挨着的普通单词，比漏掉一整句助记词划算得多。

### 2. React 自己会先打印一遍原始错误，错误边界拦不住

canary 端到端用例（种一句 canary 助记词、走完整条崩溃路径）暴露出：剪贴板干净、边界自己那条日志也已遮蔽，但 `console.error` 里还有一条

```
Caught error: Error: failed to import wallet: legal winner thank year wave sausage …
```

这是 **React 在开发模式下的内部行为**，发生在 `componentDidCatch` 之前，错误边界没有任何办法拦它。

**这是这次扫描扫出来的真实残留风险，不是测试写法问题。** 用例的断言因此收敛到边界真正管得住的部分（剪贴板 + 边界自己的日志），并在代码与本文里写明原因，没有把它糊过去。真正的修法在上游：**不要把秘密拼进异常 message**。下一步可以给 vault / 导入路径的异常加一条静态检查，禁止把输入原样拼进 `new Error(...)`。

## 验证与发布

- **passed** — `secret-scan.spec.ts` 13 条：助记词、配对 URI、canary、长度下限、遮蔽后仍可读、两段分别遮蔽不错位、普通诊断零改动。
- **passed** — `root-error-boundary.spec.ts` 新增 canary 端到端用例。
- **not run** — 真机。诊断复制在模拟器/真机上没实测过（本次只改了内容，没改交互）。
- 无原生变更，可走 OTA。
