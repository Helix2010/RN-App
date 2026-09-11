#!/usr/bin/env bash
# 生成租户的 OTA 代码签名密钥对（安全评审 N19；运行手册 §3.2.2）。
#
#   pnpm ota:keygen                        # 交互式
#   pnpm ota:keygen --tenant anyfun --out /secure/keys/anyfun-ota --yes
#
# 由密钥保管人在**打算长期保管这把私钥的机器上**执行——私钥生成在哪台机器，
# 就等于它被保管在哪。脚本只用 openssl，不需要仓库的 node_modules，也不联网，
# 可以直接拷到运维机上跑。
#
# 产出：
#   private-key.pem   机密。装进服务端（PUT /v1/admin/ota/signing-key）+ 离线备份
#   certificate.pem   公开。构建 APK 时作为 EXPO_UPDATES_CODE_SIGNING_CERTIFICATE
#   signing-key.json  ready-to-PUT 的请求体（含私钥！用完 shred 掉）
#
# 为什么不直接用 `openssl req -x509`：expo-updates 会检查叶证书带
# X509v3 Key Usage: Digital Signature 与 X509v3 Extended Key Usage: Code Signing
# （CertificateChain.kt:39-58）。少任何一个都会在**运行时**被拒，症状是所有设备
# 静默停在内置 bundle——最难查的那种。所以这里显式写扩展，并在生成后逐条复验。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
CODE_SIGNING_OID="1.3.6.1.5.5.7.3.3"

# 这个脚本是给人拷到运维机上单独跑的，那时它上一级目录不是仓库而是随便什么地方
# （拷到 ~/tools/ 就会把 $HOME 当成"仓库根"，然后拒绝一切输出目录）。
# 所以"不许写进仓库"这条只在脚本确实待在仓库里时才生效。
IN_REPO=0
if [ -f "$REPO_ROOT/package.json" ] && [ -d "$REPO_ROOT/scripts" ] && [ -d "$REPO_ROOT/tenants" ]; then
  IN_REPO=1
fi

TENANT=""; OUT_DIR=""; YEARS=10; COMMON_NAME=""; KEY_ID="main"; KEYSIZE=4096; ASSUME_YES=0
EXPECTED_VERSION=0

usage() {
  cat <<'USAGE'
用法: generate-ota-signing-key.sh [选项]
  --tenant <slug>        只用于取名：证书 CN 与默认输出目录。读得到 tenants/<slug>/tenant.json
                         就用里面的 appName，读不到就直接用 slug（拷到别的机器上跑时如此）
  --out <dir>            输出目录；默认 ~/ota-keys/<slug>。脚本在仓库里时禁止写进仓库
  --years <n>            证书有效期年数，默认 10。过期后只能发原生新版换证书，OTA 救不了自己
  --common-name <name>   证书 CN，默认 "<appName> OTA"
  --key-id <id>          expo-signature 的 keyid，默认 main
  --expected-version <n> 请求体里的 expectedVersion，默认 0（首次安装）。轮换时填**当前线上
                         版本号**（GET /v1/admin/ota/signing-key 的 version）。填错服务端拒绝写入，
                         这是防并发覆盖用的——两个人同时换密钥，后一个必须失败而不是悄悄盖掉
  --keysize <bits>       RSA 位数，默认 4096（服务端下限 2048）
  --yes                  非交互：全部用默认值 / 已给参数
  -h, --help
USAGE
}

fail() { echo "错误: $*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --tenant) TENANT="$2"; shift 2 ;;
    --out) OUT_DIR="$2"; shift 2 ;;
    --years) YEARS="$2"; shift 2 ;;
    --common-name) COMMON_NAME="$2"; shift 2 ;;
    --key-id) KEY_ID="$2"; shift 2 ;;
    --expected-version) EXPECTED_VERSION="$2"; shift 2 ;;
    --keysize) KEYSIZE="$2"; shift 2 ;;
    --yes) ASSUME_YES=1; shift ;;
    -h|--help) usage; exit 0 ;;
    --) shift ;;   # pnpm 会把 "--" 原样传进来
    *) usage; fail "未知参数 $1" ;;
  esac
done

# 与 scripts/tenant-config.mjs 一致：RN_TENANTS_ROOT 只在 Jest 子进程里生效
if [ -n "${RN_TENANTS_ROOT:-}" ] && [ -n "${JEST_WORKER_ID:-}" ]; then
  TENANTS_ROOT="$RN_TENANTS_ROOT"
else
  TENANTS_ROOT="$REPO_ROOT/tenants"
fi

ask() { # ask <变量名> <提示> <默认值>
  local __var="$1" __prompt="$2" __default="$3" __answer
  if [ "$ASSUME_YES" = 1 ] && [ -n "${!__var:-}" ]; then return; fi
  if [ "$ASSUME_YES" = 1 ]; then printf -v "$__var" '%s' "$__default"; return; fi
  if [ -n "$__default" ]; then read -r -p "$__prompt [$__default]: " __answer; else read -r -p "$__prompt: " __answer; fi
  printf -v "$__var" '%s' "${__answer:-$__default}"
}

command -v openssl >/dev/null || fail "找不到 openssl"

# ---- 租户（只用于取名；这个脚本不写任何仓库文件） ----
if [ -z "$TENANT" ]; then
  if [ -d "$TENANTS_ROOT" ]; then
    echo "可用租户："
    for d in "$TENANTS_ROOT"/*/; do [ -f "$d/tenant.json" ] && echo "  - $(basename "$d")"; done
  fi
  ask TENANT "租户 slug" ""
fi
[ -n "$TENANT" ] || fail "必须指定租户"
APP_NAME="$TENANT"
TENANT_FILE="$TENANTS_ROOT/$TENANT/tenant.json"
if [ -f "$TENANT_FILE" ] && command -v node >/dev/null; then
  APP_NAME="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).appName || process.argv[2])' "$TENANT_FILE" "$TENANT")"
fi

# ---- 输出目录（禁止在仓库内） ----
ask OUT_DIR "输出目录（仓库之外）" "$HOME/ota-keys/$TENANT"
mkdir -p "$OUT_DIR"; chmod 700 "$OUT_DIR"
OUT_ABS="$(cd "$OUT_DIR" && pwd -P)"
if [ "$IN_REPO" = 1 ]; then
  case "$OUT_ABS/" in "$REPO_ROOT"/*) fail "输出目录不能在仓库内（$OUT_ABS）：私钥一旦入库就无法撤回" ;; esac
fi

KEY_OUT="$OUT_ABS/private-key.pem"
CERT_OUT="$OUT_ABS/certificate.pem"
BODY_OUT="$OUT_ABS/signing-key.json"
for f in "$KEY_OUT" "$CERT_OUT"; do
  [ ! -e "$f" ] || fail "已存在 $f，拒绝覆盖。要重新生成请先手动移走整个目录"
done

ask YEARS "证书有效期（年）" "10"
[[ "$YEARS" =~ ^[0-9]+$ ]] && [ "$YEARS" -ge 1 ] || fail "有效期必须是正整数年"
ask COMMON_NAME "证书 CN" "$APP_NAME OTA"
[[ "$KEYSIZE" =~ ^[0-9]+$ ]] && [ "$KEYSIZE" -ge 2048 ] || fail "RSA 位数不得小于 2048（服务端会拒绝）"
[[ "$EXPECTED_VERSION" =~ ^[0-9]+$ ]] || fail "--expected-version 必须是非负整数（首次安装填 0）"

# ---- 生成 ----
umask 077
DAYS=$(( YEARS * 365 ))
EXT_CONF="$(mktemp)"
trap 'rm -f "$EXT_CONF"' EXIT
# 这三行是 expo-updates 验签的硬性前提，不要改：
#   keyUsage digitalSignature  → CertificateChain.kt 的 keyUsage[0]
#   extendedKeyUsage codeSigning (1.3.6.1.5.5.7.3.3) → CODE_SIGNING_OID
#   CA:FALSE                   → 叶证书，不是 CA
cat > "$EXT_CONF" <<EXT
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
subjectKeyIdentifier = hash
EXT

echo "生成 RSA $KEYSIZE 私钥与自签证书（$YEARS 年 / $DAYS 天）..."
openssl req -x509 -newkey "rsa:$KEYSIZE" -nodes -sha256 \
  -days "$DAYS" -subj "/CN=$COMMON_NAME" \
  -extensions v3_code_signing -config <(cat /etc/ssl/openssl.cnf 2>/dev/null || echo "[req]
distinguished_name=req"; echo "
[v3_code_signing]"; cat "$EXT_CONF") \
  -keyout "$KEY_OUT" -out "$CERT_OUT" >/dev/null 2>&1 \
  || fail "openssl 生成失败"
chmod 600 "$KEY_OUT"; chmod 644 "$CERT_OUT"

# ---- 复验：逐条对照 expo-updates 实际会检查的东西 ----
# 少任何一项都会在运行时被拒，而那时的症状是"所有设备静默停在内置 bundle"。
# 在这里失败，比在用户手机上失败便宜太多。
BITS="$(openssl rsa -in "$KEY_OUT" -noout -text 2>/dev/null | sed -n 's/.*Private-Key: (\([0-9]*\) bit.*/\1/p')"
[ -n "$BITS" ] || fail "生成的不是 RSA 私钥"
[ "$BITS" -ge 2048 ] || fail "RSA 只有 $BITS 位，服务端下限 2048"

KEY_PUB="$(openssl rsa -in "$KEY_OUT" -pubout 2>/dev/null | openssl sha256 | awk '{print $NF}')"
CERT_PUB="$(openssl x509 -in "$CERT_OUT" -noout -pubkey | openssl sha256 | awk '{print $NF}')"
[ "$KEY_PUB" = "$CERT_PUB" ] || fail "证书与私钥不是一对（服务端也会拒绝）"

CERT_TEXT="$(openssl x509 -in "$CERT_OUT" -noout -text)"
grep -q "Digital Signature" <<<"$CERT_TEXT" \
  || fail "证书缺 X509v3 Key Usage: Digital Signature —— expo-updates 会在运行时拒绝它"
grep -q "Code Signing" <<<"$CERT_TEXT" \
  || fail "证书缺 X509v3 Extended Key Usage: Code Signing（$CODE_SIGNING_OID）—— expo-updates 会在运行时拒绝它"
openssl x509 -in "$CERT_OUT" -noout -checkend 0 >/dev/null \
  || fail "证书已经过期，系统时间可能不对"

# 服务端 certificateFingerprint 取的是证书 DER 的 sha256，这里用同一口径，方便对账
CERT_SHA256="$(openssl x509 -in "$CERT_OUT" -outform DER | openssl sha256 | awk '{print $NF}')"
NOT_AFTER="$(openssl x509 -in "$CERT_OUT" -noout -enddate | cut -d= -f2)"

# ---- ready-to-PUT 请求体（含私钥，用完 shred） ----
if command -v node >/dev/null; then
  node -e '
    const fs = require("fs");
    const [keyFile, certFile, keyId, expectedVersion] = process.argv.slice(1);
    const version = Number(expectedVersion);
    process.stdout.write(JSON.stringify({
      keyId,
      privateKeyPem: fs.readFileSync(keyFile, "utf8"),
      certificatePem: fs.readFileSync(certFile, "utf8"),
      expectedVersion: version,
      reason: version === 0 ? "install ota code signing key" : "rotate ota code signing key",
      confirm: true,
    }));
  ' "$KEY_OUT" "$CERT_OUT" "$KEY_ID" "$EXPECTED_VERSION" > "$BODY_OUT"
  chmod 600 "$BODY_OUT"
  BODY_NOTE="$BODY_OUT   （0600，**含私钥**，装完 shred 掉）"
else
  BODY_OUT=""
  BODY_NOTE="（本机没有 node，未生成请求体；装的时候自己拼 JSON，PEM 有换行不能手拼）"
fi

cat <<SUMMARY

================ 生成完成 ================
租户:          $TENANT
私钥:          $KEY_OUT   （0600，机密）
证书:          $CERT_OUT
keyId:         $KEY_ID
expectedVersion: $EXPECTED_VERSION$( [ "$EXPECTED_VERSION" = 0 ] && echo "   （首次安装）" || echo "   （轮换：线上当前版本必须正好是这个数）" )
证书 SHA-256:  $CERT_SHA256
有效期至:      $NOT_AFTER   ← 记进日历。过期后只能发原生新版换证书，OTA 救不了自己
请求体:        $BODY_NOTE
SUMMARY

if [ "$EXPECTED_VERSION" != 0 ]; then
  cat <<ROTATE

!! 这是一次**轮换**。已经装在用户手机上、内嵌旧证书的原生包，从换掉的那一刻起
   就再也验不过任何 OTA——它们只认编进包里的那张证书，而 OTA 换不了自己的证书。
   所以轮换只有两种安全时机：(a) 还没有任何原生包带过证书；(b) 你已经准备好
   立刻发一个带新证书的原生版本，并接受旧版设备在升级前收不到 OTA。
   先用 GET /v1/admin/ota/signing-key 确认 version 确实等于 $EXPECTED_VERSION，
   不等就说明中间还有人动过，停下来查清楚——服务端也会用这个数拒掉并发覆盖。
ROTATE
fi

cat <<SUMMARY

接下来两步，**顺序不能反**：

1) 私钥装进服务端（先做这一步，安全性不变，对现有用户零影响）：
$( [ -n "$BODY_OUT" ] && cat <<CURL
   curl -sS -X PUT https://<租户域名>/v1/admin/ota/signing-key \\
     -H "content-type: application/json" -H "x-admin-key: \$ADMIN_API_KEY" \\
     --data-binary @$BODY_OUT
   shred -u $BODY_OUT
CURL
)
   返回里的 certificateSha256 必须等于上面那串；不等说明装错了东西。
   响应不含私钥——装进去之后只能整把替换，读不回来。

2) 下次出原生包时带上证书（代码不用改，只加构建环境变量）：
   EXPO_UPDATES_CODE_SIGNING_CERTIFICATE=$CERT_OUT
   EXPO_REQUIRE_OTA_SIGNING=1

   反过来先发包会让那批设备收不到任何 OTA——它们要求验签而服务端给不出签名。

3) 发完必须验两条，只验第一条说明不了问题：
   a. 装上新包拉一次 OTA，能装上 = 验签通过；
   b. 再出一个**故意用错证书**的包，拉 OTA 必须失败并停在内置版本。
      如果 b 也"成功"了，说明验签根本没生效，a 的成功是假的。

保管：私钥与 Android keystore 同档——密钥管理服务 + 两份离线加密备份 + 一次恢复演练，
然后删除本目录的明文。丢了就再也发不了 OTA（只能发原生新版换证书），被偷了对方就能签 OTA。
SUMMARY
