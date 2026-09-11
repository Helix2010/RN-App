# Feature: OTA 签名密钥搬进管理端（服务端生成 + 状态页）

状态：Done（代码与用例就位；真机端到端仍未跑，见「验证与发布」）

涉及仓库：RN-Server（生成接口）、RN-Admin（页面）、RN-App（运行手册与契约 pin）。

## 用户场景与现状证据

- 用户/角色：发布负责人与运维。
- 当前行为与代码证据：密钥仪式只有命令行一条路——本机 `pnpm ota:keygen` 生成，`curl -X PUT` 装进服务端。2026-09-11 这条路真的断了一次：轮换时 `mv` 跑了两次，新生成的目录被挪进了旧目录，`curl --data-binary @…/signing-key.json` 指向一个已经不存在的文件，请求根本没发出去，而操作者以为换完了。线上仍是那把泄露的密钥，直到用 `GET` 对指纹才发现。
- 非目标：Android keystore。它不走这条路，理由见下。

## Given / When / Then

- Given 租户没配密钥，When 打开「OTA 签名密钥」页，Then 明说"OTA 只有完整性没有真实性"，并给出生成入口。
- Given 填了原因并确认，When 点生成，Then 服务端生成 RSA 私钥与自签证书、加密落库，响应只带证书与指纹，**不带私钥**。
- Given 已经配过密钥，When 再次生成，Then 确认框先说清楚：内嵌旧证书的存量包从换掉的那一刻起再也验不过任何 OTA。
- Given 并发有人改过，Then `expectedVersion` 不匹配，409，页面报错而不是假装换成功了。
- Given 证书剩余有效期不足 180 天，Then 页面上是一条告警，而不是要靠谁记得当初填了几年。
- Given 任何人打开这个页面，Then 没有任何可以粘贴私钥的输入框。

## UI 与交互状态

`应用配置 → OTA 签名密钥`。loading / error / empty / content 四态齐全。状态卡片给的是能和构建对账的公开事实：keyId、证书 CN、证书 SHA-256 全串、有效期与剩余天数、版本与更新人。证书可下载，下载下来就是构建时的 `EXPO_UPDATES_CODE_SIGNING_CERTIFICATE`。

**不提供粘贴私钥的表单**是设计决定，不是没做完。生成已经在服务端，正常路径不需要私钥经过浏览器；导入一把外部已有的密钥是极低频的迁移操作，留给 `PUT /v1/admin/ota/signing-key`。少一个能输入私钥的地方就少一处泄露面。

## 技术影响

### 为什么服务端生成是安全的，而 Android keystore 不是

签每一份 manifest 时，服务端本来就必须把明文私钥解出来。让 OTA 密钥在那边诞生，暴露面没有变大，却省掉了明文文件、跨机器搬运和 shred 纪律——那条链路上的每一环都真实地出过错。代价是没有离线备份，但丢了这把密钥的代价本来就等于主动轮换它的代价：发一个原生新版。

Android keystore 三条都反过来：服务端运行时根本不用它；它泄露意味着对方能签一个同签名的 APK 在用户设备上原地覆盖安装、数据目录（含钱包）完整保留；direct 分发没有 Play App Signing 那套轮换，补救办法只有换包名。规则写成一句：**服务端运行时真的要用的密钥，才住在服务端的数据库里；丢不起又用不着的，不许进来。**

### 实现

- `POST /v1/admin/ota/signing-key/generate`。落库路径与 `PUT` 共用 `storeOTASigningKey`——分成两份实现的话，迟早有一边漏掉配对校验或乐观锁。审计的 action 区分 `ota_signing_key_generate` 与 `ota_signing_key_update`。
- 生成的证书照着 `CertificateChain.kt` 的判据写：`keyUsage[0]`（digitalSignature）+ EKU 含 `1.3.6.1.5.5.7.3.3`，`CA:FALSE`。**NotBefore 往前挪 5 分钟**——客户端 `checkValidity()` 用的是设备时钟，刚签发就被判"还没生效"是一种只在部分设备上出现、而且完全静默的故障。
- keySize 限 2048..8192，years 限 1..30。上限不是洁癖：32768 位会把 CPU 焊死几分钟，而"有效期一百年"等于永远不会被换掉。
- `GET` 新增 `certificateSubject` / `certificateNotBefore` / `certificateNotAfter`。证书过期后 OTA 救不了自己，"还有多久过期"必须看得见。
- 页面从当前记录填 `expectedVersion`。让人手填这个数，等于把并发覆盖的判断交给记性——服务端拒绝时他只会再试一次，直到填对为止。

## 验证与发布

- **passed** — RN-Server `gofmt` / `go vet` 干净，`go test ./...` 全绿。新增 3 条用例：生成的证书逐条对照 `CertificateChain.kt` 的判据（含 NotBefore 已过去、非 CA），并用客户端那套算法（`rsa.VerifyPKCS1v15` + SHA-256）复验它真的能签能验；参数越界一律拒绝；handler 在碰数据库之前拒掉不合法请求（`db` 为 nil，走到数据库就会 panic）。
- **passed** — RN-Admin `pnpm check` 全绿，15 个测试文件 110 条。新增 8 条，包括"指纹完整显示不截断"、"临期告警"、"expectedVersion 来自记录而不是输入框"、"确认前说清楚轮换后果"、"页面上没有任何地方能粘贴私钥"。
- **passed** — **在真实 Android 运行时上验过**（模拟器 emulator-5558，Android 16 / API 36，Dalvik 2.1.0）。搭了一套一次性的本地栈：MySQL 容器 + 本地 RN-Server，用**新接口**生成密钥、插一条 rollback OTA、按 expo 协议拉一次 `/v1/ota/manifest`，把 **part 头**里的 `expo-signature` 与被签的正文原样取出来，推到设备上用 `CertificateChain.kt` 的原判据（`CertificateFactory` + `checkValidity()` + `keyUsage[0]` + EKU `1.3.6.1.5.5.7.3.3`）和 `CodeSigningConfiguration.kt` 的 `Signature.getInstance("SHA256withRSA")` 跑：

  | 用例 | 结果 |
  | --- | --- |
  | 新证书 + 新签名 | ACCEPTED |
  | 改一个字节的正文 | 拒绝 |
  | 轮换后拿旧证书验新签名（= 内嵌旧证书的存量包） | REJECTED |
  | 裸 `openssl req -x509` 生成的证书 | `keyUsage[0]=false`、`EKU=false`，REJECTED |

  最后一行是这套生成器存在的全部理由：不写那两个扩展的证书，在 Android 上根本不算代码签名证书。

  这次还抓到一件事：**模拟器时钟比宿主机慢 1 秒**，一张 `NotBefore=now` 的证书当场 `CertificateNotYetValidException`。往前挪 5 分钟不是讲究，是这个。

  复跑用 `scripts/ota-signature-android-check/run.sh`（已入库）。

- **passed** — 接口层在真实 MySQL 上验过：生成 → version 1；用过期的 `expectedVersion` 再写一次 → 409 `STALE_OTA_SIGNING_KEY`；正确版本号轮换 → version 2；库里 `ota.signing.privateKey` 是密文不是 PEM；审计记 `ota_signing_key_generate` + 指纹 + 版本，不记私钥；响应不含私钥。
- **passed** — `EXPO_UPDATES_CODE_SIGNING_CERTIFICATE` 指向证书时，`expo config` 解析出的 `updates.codeSigningMetadata` 是 `{alg: rsa-v1_5-sha256, keyid: main}`，与服务端 `expo-signature` 里发的两个值一致。
- **not run** — 整包端到端（装一个带证书的原生包、拉一次真的 bundle 更新）。缺的是对象存储与一次原生构建，不是签名链路。
- **not run** — 管理端页面没有真浏览器跑过，RN-Admin 只有 jsdom，没装 Playwright 之类。页面逻辑由 8 条 vitest 用例覆盖。
- 契约 2026.09.14 增加 `POST /v1/admin/ota/signing-key/generate` 与 `OTASigningKeyGenerate`；RN-App 的 pin 副本同步。
