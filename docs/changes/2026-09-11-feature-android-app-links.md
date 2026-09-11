# Feature: Android App Links 回跳（N13 服务端与清单侧，A3-5）

状态：Done

## 用户场景与现状证据

- 用户/角色：用外部钱包（MetaMask / Trust / OKX）签名的用户。
- 当前行为：WalletConnect 的回跳只声明 `anyfun://`。自定义 scheme 谁都能在自己的 manifest 里声明，装了恶意应用的机器上，用户在钱包里点完批准后可能被带回**别的应用**，而那个应用能看到回跳携带的上下文。出站方向已在上一批改用官方通用链接 + Android 显式包名（`wallet-deep-links.ts`），入站回跳一直没处理。
- 代码调用链：`walletconnect-client.ts` `appIdentity()` → `SignClient.init` 的 `metadata.redirect`；服务端无 `.well-known` 路由（`grep` 零命中）。
- 非目标：iOS 的 `apple-app-site-association`。它需要 Apple Team ID，仓库与租户配置里都没有，iOS 签名整套尚未建立。

## Given / When / Then

- Given 租户已登记 Android 发布身份，When 系统拉 `https://<租户域名>/.well-known/assetlinks.json`，Then 返回由该登记生成的包名与大写冒号分隔指纹。
- Given 租户没登记发布身份，When 拉同一地址，Then 404，而不是发一份猜出来的授权。
- Given 入库指纹不是 64 位十六进制，When 生成文件，Then 报错不输出，不把域名授权给不确定的应用。
- Given App 已安装且系统校验通过，When 钱包批准后回跳，Then 只会打开本应用，不弹"用什么打开"。
- Given 本地 http 构建，When 初始化 WalletConnect，Then 没有 universal 回跳，退回自定义 scheme。

## UI 与交互状态

无可见变化。回跳从"可能弹选择框 / 可能被别的应用接走"变成"直接回到本应用"。

## 技术影响

- `app.config.ts`：新增 `autoVerify` 的 https intent filter，**只声明一条窄路径** `/app/wc`。声明整个 host 会让浏览器里打开任何一个 API 地址都被系统拉起应用。同一处算出 `extra.walletConnectRedirectUrl`，客户端不再自己拼。
- `walletconnect-client.ts`：`metadata.redirect` 变为 `{ native, universal? }`，universal 缺失（http 构建）时不填，不做兜底默认值。
- RN-Server `wellKnownAssetLinks`：按 Host 解析租户，内容由 `app_configs` 的 `release.android` 生成，不引入第二份真相源；`colonFingerprint` 只接受 64 位十六进制，缓存 1 小时。契约 2026.09.11。
- **原生变更**：需要重新出包。anyfun 提到 1.3.1 / 27（服务端要求版本与 Build 同时递增，沿用 1.3.0 会被 `RELEASE_VERSION_NOT_INCREASING` 拒收）。

## 验证与发布

- RN-App `pnpm check` 全绿：128 套 / 923 用例。`aapt dump xmltree` 确认清单里有 `autoVerify=true` / `host=api.anyfun.win` / `pathPrefix=/app/wc`。
- RN-Server `gofmt` / `go vet` / `go test -race ./internal/api` 通过；新增 `colonFingerprint` 正反用例。
- 产物：`artifacts/anyfun-1.3.1-build27-release.apk`，38,747,794 字节，SHA-256 `702bd04e2eccc7f544d7b8f17b5e36d5e281ceebeb43b97f6218ff1226fa95fe`，签名者 `1a5d9fb4…e694`，`pnpm android:verify` 通过。
- **上线顺序**：先部署服务端让 `assetlinks.json` 可访问，再分发 APK。Android 在安装时去校验域名，文件不在位的话这一版装上去也是未校验状态，要等系统下次重试。
- 取代：1.3.0 (26) 的待发布记录与 runtime 1.3.0 的 OTA 修订 2 均未发布过，内容已包含在本包里，不再需要。
