#!/usr/bin/env bash
# 在**真实 Android 运行时**上跑一遍 expo-updates 的验签判据。
#
#   scripts/ota-signature-android-check/run.sh <manifest-url> [device]
#   scripts/ota-signature-android-check/run.sh --offline <cert.pem> <body-file> <sig-base64-file> [device]
#
# 为什么要有这个：服务端的 Go 测试用 Go 自己的 x509 与 rsa 复验签名，那证明的是
# "我们的实现自洽"。客户端跑的是 Android 的 Conscrypt 和 CertificateChain.kt 的
# 判据（keyUsage[0] + EKU 1.3.6.1.5.5.7.3.3 + checkValidity），是另一套实现。
# 这两者不一致时的症状是**所有设备静默停在内置 bundle**——线上完全看不出来。
#
# 2026-09-11 用它抓到过一件事：模拟器时钟比宿主机慢 1 秒，一张 NotBefore=now 的
# 证书当场 CertificateNotYetValidException。生成器把 NotBefore 往前挪 5 分钟不是
# 讲究，是这个。
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

fail() { echo "错误: $*" >&2; exit 1; }

ANDROID_HOME="${ANDROID_HOME:-$HOME/android-sdk}"
ADB="$ANDROID_HOME/platform-tools/adb"
[ -x "$ADB" ] || fail "找不到 adb（ANDROID_HOME=$ANDROID_HOME）"
D8="$(ls -d "$ANDROID_HOME"/build-tools/* 2>/dev/null | tail -1)/d8"
[ -x "$D8" ] || fail "找不到 d8，需要 Android build-tools"
command -v javac >/dev/null || fail "找不到 javac"

OFFLINE=0
if [ "${1:-}" = "--offline" ]; then OFFLINE=1; shift; fi

if [ "$OFFLINE" = 1 ]; then
  CERT="${1:?cert.pem}"; BODY="${2:?body file}"; SIG="${3:?signature base64 file}"; DEVICE="${4:-}"
  cp "$CERT" "$WORK/certificate.pem"; cp "$BODY" "$WORK/part-body.bin"; cp "$SIG" "$WORK/part-sig.b64"
else
  URL="${1:?manifest url}"; DEVICE="${2:-}"
  : "${OTA_PLATFORM:=android}" "${OTA_RUNTIME:?需要 OTA_RUNTIME}" "${OTA_CHANNEL:=production}"
  : "${OTA_APP_VERSION:=}" "${OTA_BUILD_NUMBER:=}"
  curl -sS -D "$WORK/resp.h" -o "$WORK/resp.body" "$URL" \
    -H "Accept: multipart/mixed" \
    -H "expo-platform: $OTA_PLATFORM" -H "expo-runtime-version: $OTA_RUNTIME" \
    -H "expo-channel-name: $OTA_CHANNEL" -H "expo-protocol-version: 1" \
    -H 'expo-expect-signature: sig, keyid="main", alg="rsa-v1_5-sha256"' \
    ${OTA_APP_VERSION:+-H "x-app-version: $OTA_APP_VERSION"} \
    ${OTA_BUILD_NUMBER:+-H "x-build-number: $OTA_BUILD_NUMBER"}
  [ -n "${OTA_CERTIFICATE:-}" ] || fail "需要 OTA_CERTIFICATE 指向要验的那张证书"
  cp "$OTA_CERTIFICATE" "$WORK/certificate.pem"
  # 签名在 **part 的头**里，不在 HTTP 响应头（FileDownloader.kt:556,570）
  WORK="$WORK" python3 - <<'PY'
import os, pathlib, re, sys
work = pathlib.Path(os.environ["WORK"])
headers = (work / "resp.h").read_text()
match = re.search(r"boundary=([^\s;]+)", headers)
if not match:
    sys.exit("响应不是 multipart，服务端可能没有可下发的更新（204）")
for part in (work / "resp.body").read_bytes().split(b"--" + match.group(1).strip().encode()):
    if b"Expo-Signature" not in part:
        continue
    head, body = part.lstrip(b"\r\n").split(b"\r\n\r\n", 1)
    # 分界前的 CRLF 属于 multipart 框架，不是被签名的正文
    (work / "part-body.bin").write_bytes(body[: body.rfind(b"\r\n")])
    (work / "part-sig.b64").write_text(re.search(rb'sig="([^"]+)"', head).group(1).decode())
    break
else:
    sys.exit("响应里没有 Expo-Signature：这个租户可能还没装签名密钥")
PY
fi

javac -d "$WORK/classes" "$HERE/ExpoSignatureCheck.java"
"$D8" --output "$WORK" "$WORK/classes/ExpoSignatureCheck.class" >/dev/null

if [ -z "$DEVICE" ]; then
  DEVICE="$("$ADB" devices | awk '$2=="device"{print $1; exit}')"
  [ -n "$DEVICE" ] || fail "没有在线的模拟器/设备"
fi
REMOTE=/data/local/tmp/ota-signature-check
"$ADB" -s "$DEVICE" shell "rm -rf $REMOTE && mkdir -p $REMOTE"
for f in classes.dex certificate.pem part-body.bin part-sig.b64; do
  "$ADB" -s "$DEVICE" push "$WORK/$f" "$REMOTE/" >/dev/null
done
echo "设备 $DEVICE（Android $("$ADB" -s "$DEVICE" shell getprop ro.build.version.release | tr -d '\r')）"
"$ADB" -s "$DEVICE" shell "cd $REMOTE && CLASSPATH=$REMOTE/classes.dex app_process / ExpoSignatureCheck certificate.pem part-body.bin part-sig.b64"
STATUS=$?
"$ADB" -s "$DEVICE" shell "rm -rf $REMOTE"
exit $STATUS
