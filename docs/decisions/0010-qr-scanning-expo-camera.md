# ADR 0010：收款地址扫码采用 expo-camera

- 状态：已采纳（2026-09-02）
- 关联：ADR 0005（OTA 与 APK 绑定）、ADR 0009（已知缺口）、`docs/design/wallet-onchain-security-2026-09-01.md`

## 背景

转出页此前只有"粘贴"一种录入方式。真机反馈里"没有扫码"是最直接的缺口：线下收款、跨设备转账时，二维码是最不容易抄错的途径，而地址抄错一位就是不可逆的损失。

## 决定

| 项               | 选择                                                                                          | 理由                                                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 扫码库           | `expo-camera`（SDK 57，`CameraView` + `barcodeScannerSettings: { barcodeTypes: ["qr"] }`）    | Expo 官方维护，随 SDK 升级；自带权限 hook（`useCameraPermissions`）与 config plugin，不需要手写 Manifest / Info.plist |
| 码制             | 只认 QR                                                                                       | 钱包地址二维码就是 QR；多认一种码制只多一种误读                                                                       |
| 内容             | 纯地址或 EIP-681 链接 `ethereum:[pay-]<address>[@chainId][?value=…]`（`parsePaymentRequest`） | 主流钱包的收款码两种都有                                                                                              |
| 链接里的 chainId | 只用于**提示**，不切链                                                                        | 换链等于换了转出的资产；静默照做是替用户做决定。与当前选的币不在同一条链时显示黄字提示，让用户与收款方核对            |
| 链接里的 value   | 一律丢弃                                                                                      | 金额必须由用户自己输入；扫出来就填好的金额会被当成"对方要求的数"直接确认                                              |
| 权限被拒         | 显示说明 + "去设置"（`Linking.openSettings`）                                                 | 不假装能扫；也不在页面上留一个点了没反应的按钮                                                                        |
| 扫描节流         | 一次只报一个码；不是地址时提示 1.5 s 后恢复                                                   | 同一个码每帧都会触发 `onBarcodeScanned`                                                                               |

## 交付边界

这是**原生依赖**：新增相机权限与原生模块，必须走全量包，不能发 OTA（`docs/workflows/APP_CHANGE_WORKFLOW.md` §原生变更）。随 anyfun 1.2.7（androidVersionCode 21）发布；1.2.6 的 OTA 只能包含此前一个提交（转出页重排、链信息）——那个提交刻意不引用 `expo-camera`。

iOS 权限文案由 config plugin 的 `cameraPermission` 写入 Info.plist；不申请麦克风、不申请 Android 录音权限。

## 不做

- 相册选图识别二维码：需要额外的图片解码依赖，暂无反馈需要。
- WalletConnect 配对码扫描：扫码入口只在转出页，配对仍走深链。
