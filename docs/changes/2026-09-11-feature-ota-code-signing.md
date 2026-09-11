# Feature: OTA 代码签名（N19 服务端实现，§13 阶段 0b-2）

状态：Done（实现就位；**启用还差密钥仪式**，见「上线顺序」）

涉及仓库：RN-Server（主）、RN-App（契约与 runbook）。评审：`docs/design/cross-platform-wallet-key-security-adversarial-review-2026-09-09.md` N19 / §12.1。

## 用户场景与现状证据

- 用户/角色：任何装了这个 App 的人——OTA 能改的是整个 JS 层，**包括钱包签名前的确认界面**。
- 当前行为与代码证据：`grep -rn "expo-signature\|CodeSigning" RN-Server/internal` 零命中。OTA 此前只有**完整性**没有**真实性**：manifest 的 sha256 存在我们自己的数据库里，能改数据库或能顶替这条响应的人，可以让客户端拿到一份它认为"完整"的恶意 bundle。`rollBackToEmbedded` 指令同样没有签名——那是一条"把所有人退回内置版本"的指令。
- 非目标：密钥本身的生成与保管（组织决策，runbook §3.2.2 写了流程）；`includeManifestResponseCertificateChain` 的证书链轮换（需要自定义 config plugin，单独排期）。

## Given / When / Then

- Given 租户装了签名密钥，When 客户端拉 manifest，Then 响应带 `expo-signature`（plain 是响应头，multipart 是 part 头），签的是**改写完成后**的字节。
- Given 是 `rollBackToEmbedded` 指令，Then 同样签名。
- Given 租户没装密钥，Then 照常下发未签名响应——要验签的客户端自己拒绝并回落内置 bundle；服务端按 (租户, 运行时) 去重记一条 warning。
- Given 装了密钥但解不开（master key 换了、记录被改坏），Then 500 `OTA_SIGNING_KEY_INVALID`，**不降级成不签名**。
- Given 装密钥时证书与私钥不是一对，Then 400 拒绝。
- Given 私钥不是 RSA 或小于 2048 位，Then 400 拒绝。
- Given 装上或换掉密钥，When 客户端带 `if-none-match` 再拉，Then 拿到的是 200 而不是 304。
- Given 任何人调 `GET /v1/admin/ota/signing-key`，Then 拿不到私钥。

## UI 与交互状态

无界面。RN-Admin 暂无对应页面（密钥仪式是低频运维操作，先用接口；证书就位后再决定要不要做界面）。

## 技术影响

### 协议事实是读源码确认的，不是照文档抄的

| 事实 | 出处（expo-updates 57.0.22） |
| --- | --- |
| `SHA256withRSA`（PKCS#1 v1.5 + SHA-256）签 body **原始字节** | `CodeSigningConfiguration.kt:93-96` |
| `expo-signature` 是 RFC 8941 字典：`sig`/`keyid`/`alg` | `SignatureHeaderInfo.kt` |
| **plain 响应**：HTTP 响应头 | `FileDownloader.kt:478` |
| **multipart**：**part 的头**，manifest 与 directive 各签各的 | `FileDownloader.kt:556,570` |
| 只认 `rsa-v1_5-sha256` | `CodeSigningAlgorithm.kt` |

写错位置（比如 multipart 下把签名放 HTTP 响应头）的表现是"签了但客户端说没签名"，从日志上完全看不出来。

### 实现

- 新增 `internal/api/ota_signing.go`：每租户一把密钥存 `app_configs` 的 `ota.signing`，私钥用 storage master key 认证加密（与灰度令牌、品牌资源同一套）后落库。`GET/PUT /v1/admin/ota/signing-key`。
- **签的是改写完成后的最终字节**。下发前 `applyManifestStrategy` 会用数据库里的生效策略覆盖 manifest 里的值；对入库原文签名，中间那段改写就成了签名覆盖不到的缺口（评审 §13 阶段 0b-2 的原话是"对所有改写完成后的最终 Expo 响应签名"）。
- **私钥永不出现在任何响应里**。装进去之后只能整把替换，不提供读回。审计记 keyid 与证书指纹。
- **ETag 把 keyid 算进去**。装上或换掉密钥时 manifest 字节并没有变，不算进去的话带 `if-none-match` 的客户端会一直拿 304，永远收不到那个签名。
- **写入时校验证书与私钥是一对**。不匹配的话服务端签得出来而客户端一定验不过，表现是所有设备静默停在内置 bundle——最难查的那种故障，必须在写入时就拦住。
- **没配密钥不是错误，但要留痕**。客户端带了 `expo-expect-signature` 而我们给不出签名时，它会拒绝更新并停在内置 bundle；这个故障在设备上完全静默，只能从服务端看见，所以按 (租户, 运行时) 去重记一条 warning。
- **输入校验先于基础设施检查**。第一版把 `s.secrets == nil` 放在解析私钥之前，结果一个明显不合法的私钥收到的是 500「服务端问题」——调用方照着这个提示永远查不到自己贴错了东西。测试直接抓到了这一点。

## 上线顺序（不能反）

**先装服务端密钥，再发带 `codeSigningCertificate` 的原生包。** 反过来的话，新包的所有设备都收不到 OTA——它们要求验签而服务端给不出签名。App 侧的 `EXPO_REQUIRE_OTA_SIGNING` 开关用来保证"带证书"这件事不被忘记。完整步骤见 RN-App `docs/SAAS_TENANT_BUILD_RUNBOOK.md` §3.2.2。

## 验证与发布

- **passed** — RN-Server `gofmt` / `go vet` 干净，`go test ./...` 11 个包全绿。8 条新用例，地基那条是**用 Go 侧同一套算法（`rsa.VerifyPKCS1v15` + SHA-256）复验服务端签出来的东西**，并断言改一个字节就验不过——否则签的等于没签。另有：keyid 转义、PKCS#1/PKCS#8 都接受、1024 位拒绝、证书必须配对、view 不泄私钥、nil signer 静默不签。
- **passed** — 依赖升级后复核协议未变：`expo-updates@57.0.22` 里 `SHA256withRSA` 与三处 `expo-signature` 都在。
- **not run** — 真机端到端（需要先做密钥仪式、发一个带证书的包）。runbook §3.2.2 第 5 步写了怎么验：装上新包拉一次 OTA 确认能装上，再**故意用错的证书验一次**——那次必须失败并停在内置 bundle，否则说明验签根本没生效。
- **passed** — `pnpm ota:keygen` 的 9 条用例（含 `--expected-version` 写进请求体、负数被拒）。轮换是会反复发生的操作，之前只能手改那个**含私钥**的 JSON——编辑器备份和剪贴板都是泄露面，所以这个参数不是便利而是安全项。
- 契约 2026.09.13 增加两条路由与 `OTASigningKeyWrite`；RN-App 的 pin 副本同步。

## 每租户 / 每环境各一把

密钥按租户存在 `app_configs` 的 `ota.signing`，证书按租户编进各自的原生包。共用一把 = 任何一个租户或 staging 泄露就打穿全部租户的 OTA 真实性。已写进 RN-App `docs/SAAS_TENANT_BUILD_RUNBOOK.md` §2 第 4 步（新租户清单）与 §3.2.2「轮换」。
