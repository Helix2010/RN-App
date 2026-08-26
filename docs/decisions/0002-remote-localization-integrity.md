# ADR-0002：使用 expo-crypto 校验远程语言包

- 状态：Accepted
- 日期：2026-08-26

## 决策

RN-App 使用 Expo SDK 57 对应的 `expo-crypto` 计算远程语言 JSON 的 SHA-256。语言包下载后必须先通过结构校验、语言编码校验、大小校验和 SHA-256 校验，再写入 AsyncStorage；校验失败继续使用旧缓存或内置语言包。

## 原因

Hermes/React Native 不保证始终提供 Web Crypto `subtle`，自行维护 SHA-256 会增加安全与测试负担。`expo-crypto` 有 Expo 原生适配，体积和原生影响可控，且只用于完整性校验，不存储任何密钥。

## 影响

新增原生依赖，首次接入需要 Development Build；语言文案变更仍可通过远程资源发布，不改变原生 ABI，因此语言包更新本身仍可走服务端资源刷新。
