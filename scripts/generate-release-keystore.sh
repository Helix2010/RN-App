#!/usr/bin/env bash
# 生成租户的 Android 生产签名密钥，并输出登记信息（安全评审 N1；运行手册 §3.1）。
#
#   pnpm android:keystore                 # 交互式
#   pnpm android:keystore --tenant anyfun --out /secure/keys/anyfun
#
# 由密钥保管人在干净机器上执行。脚本只做三件事：生成 PKCS12 keystore、提取证书 SHA-256
# 指纹（64 位小写十六进制）、把要登记到 tenant.json / RN-Admin / CI secrets 的值写成文件。
# 它不会把口令打印到终端，不会把任何东西写进仓库（除非你确认写 tenant.json 的 signerSha256）。
set -euo pipefail

DEBUG_SIGNER_SHA256="fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"

TENANT=""; OUT_DIR=""; ALIAS=""; VALIDITY=10000; KEYSIZE=4096; DNAME=""
PASSWORD_FILE=""; ASSUME_YES=0; WRITE_TENANT=""; FORCE=0

usage() {
  cat <<'USAGE'
用法: generate-release-keystore.sh [选项]
  --tenant <slug>          租户 slug（tenants/<slug>/tenant.json 必须存在）
  --out <dir>              输出目录，必须在仓库之外；默认 ~/release-keys/<slug>
  --alias <name>           keystore 别名，默认 = slug
  --validity <days>        证书有效期，默认 10000
  --dname "<X.500 DN>"     证书主体，默认 "CN=<appName> Release, O=<appName>, C=CN"
  --password-file <file>   从文件读取口令（首行）；不传则交互选择自动生成或手动输入
  --write-tenant yes|no    是否把 signerSha256 写入 tenant.json；不传则询问
  --yes                    非交互：全部使用默认值 / 已给参数，不再询问
  --force                  tenant.json 已有 signerSha256 时仍继续（换钥前先读运行手册 §3.3）
  -h, --help
USAGE
}

fail() { echo "错误: $*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --tenant) TENANT="$2"; shift 2 ;;
    --out) OUT_DIR="$2"; shift 2 ;;
    --alias) ALIAS="$2"; shift 2 ;;
    --validity) VALIDITY="$2"; shift 2 ;;
    --dname) DNAME="$2"; shift 2 ;;
    --password-file) PASSWORD_FILE="$2"; shift 2 ;;
    --write-tenant) WRITE_TENANT="$2"; shift 2 ;;
    --yes) ASSUME_YES=1; shift ;;
    --force) FORCE=1; shift ;;
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

# ---- 工具检查 ----
KEYTOOL="${JAVA_HOME:+$JAVA_HOME/bin/keytool}"
if [ -z "$KEYTOOL" ] || [ ! -x "$KEYTOOL" ]; then KEYTOOL="$(command -v keytool || true)"; fi
[ -n "$KEYTOOL" ] || fail "找不到 keytool：安装 JDK 17 或设置 JAVA_HOME"
command -v openssl >/dev/null || fail "找不到 openssl"
command -v node >/dev/null || fail "找不到 node"

# ---- 租户 ----
if [ -z "$TENANT" ]; then
  echo "可用租户："
  for d in "$TENANTS_ROOT"/*/; do [ -f "$d/tenant.json" ] && echo "  - $(basename "$d")"; done
  ask TENANT "租户 slug" ""
fi
[ -n "$TENANT" ] || fail "必须指定租户"
TENANT_FILE="$TENANTS_ROOT/$TENANT/tenant.json"
[ -f "$TENANT_FILE" ] || fail "租户配置不存在: $TENANT_FILE"
read -r APP_NAME ANDROID_PACKAGE EXISTING_SIGNER < <(node -e '
  const t = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  console.log([t.appName, t.androidPackage, t.signerSha256 || "-"].join(" "));
' "$TENANT_FILE")
[ -n "$ANDROID_PACKAGE" ] || fail "tenant.json 缺少 androidPackage"
if [ "$EXISTING_SIGNER" != "-" ] && [ "$FORCE" != 1 ]; then
  fail "tenant.json 已登记 signerSha256=$EXISTING_SIGNER。更换签名密钥意味着已装机用户必须卸载重装，先读 docs/SAAS_TENANT_BUILD_RUNBOOK.md §3.3；确认要换再加 --force"
fi

# ---- 输出目录（禁止在仓库内） ----
ask OUT_DIR "输出目录（仓库之外）" "$HOME/release-keys/$TENANT"
mkdir -p "$OUT_DIR"; chmod 700 "$OUT_DIR"
OUT_ABS="$(cd "$OUT_DIR" && pwd -P)"
case "$OUT_ABS/" in "$REPO_ROOT"/*) fail "输出目录不能在仓库内（$OUT_ABS）：keystore 一旦入库就无法撤回" ;; esac
KEYSTORE="$OUT_ABS/$TENANT-release.jks"
[ ! -e "$KEYSTORE" ] || fail "已存在 $KEYSTORE，拒绝覆盖。要重新生成请先手动移走它"

ask ALIAS "keystore 别名" "$TENANT"
ask VALIDITY "证书有效期（天）" "10000"
[[ "$VALIDITY" =~ ^[0-9]+$ ]] || fail "有效期必须是整数天数"
ask DNAME "证书主体 DN" "CN=$APP_NAME Release, O=$APP_NAME, C=CN"

# ---- 口令：写文件不上屏 ----
PASSWORD_OUT="$OUT_ABS/$TENANT-release.password"
if [ -n "$PASSWORD_FILE" ]; then
  [ -f "$PASSWORD_FILE" ] || fail "口令文件不存在: $PASSWORD_FILE"
  PASSWORD="$(head -n1 "$PASSWORD_FILE")"
else
  GEN="Y"; ask GEN "自动生成 32 字节随机口令？(Y/n)" "Y"
  if [[ "$GEN" =~ ^[Yy]$ ]]; then
    PASSWORD="$(openssl rand -base64 32)"
  else
    read -r -s -p "输入口令（不少于 16 位）: " PASSWORD; echo
    read -r -s -p "再输入一次: " PASSWORD2; echo
    [ "$PASSWORD" = "$PASSWORD2" ] || fail "两次口令不一致"
  fi
fi
[ "${#PASSWORD}" -ge 16 ] || fail "口令不少于 16 位"
umask 077
printf '%s\n' "$PASSWORD" > "$PASSWORD_OUT"

# ---- 生成 ----
echo "生成 $KEYSTORE（RSA $KEYSIZE，SHA256withRSA，$VALIDITY 天）..."
"$KEYTOOL" -genkeypair -v -keystore "$KEYSTORE" -storetype PKCS12 \
  -alias "$ALIAS" -keyalg RSA -keysize "$KEYSIZE" -sigalg SHA256withRSA \
  -validity "$VALIDITY" -dname "$DNAME" \
  -storepass:file "$PASSWORD_OUT" -keypass:file "$PASSWORD_OUT" >/dev/null 2>&1 \
  || fail "keytool 生成失败"

# ---- 指纹：64 位小写十六进制，与门禁比对格式一致 ----
FINGERPRINT="$("$KEYTOOL" -list -v -keystore "$KEYSTORE" -alias "$ALIAS" -storepass:file "$PASSWORD_OUT" \
  | awk '/SHA256:/{print $2; exit}' | tr -d ':' | tr 'A-F' 'a-f')"
[[ "$FINGERPRINT" =~ ^[0-9a-f]{64}$ ]] || fail "无法读取证书 SHA-256 指纹"
[ "$FINGERPRINT" != "$DEBUG_SIGNER_SHA256" ] || fail "生成结果竟是模板 debug 指纹，环境异常"

# ---- CI secret 用的 base64（写文件，不上屏） ----
BASE64_OUT="$OUT_ABS/$TENANT-release.jks.base64"
base64 < "$KEYSTORE" | tr -d '\n' > "$BASE64_OUT"

# ---- 可选：写入 tenant.json ----
if [ -z "$WRITE_TENANT" ]; then
  if [ "$ASSUME_YES" = 1 ]; then WRITE_TENANT="no"; else ask WRITE_TENANT "把 signerSha256 写入 $TENANT_FILE？(yes/no)" "no"; fi
fi
if [ "$WRITE_TENANT" = "yes" ]; then
  node -e '
    const fs = require("fs"); const [file, fp] = process.argv.slice(1);
    const t = JSON.parse(fs.readFileSync(file, "utf8")); t.signerSha256 = fp;
    fs.writeFileSync(file, JSON.stringify(t, null, 2) + "\n");
  ' "$TENANT_FILE" "$FINGERPRINT"
  echo "已写入 $TENANT_FILE 的 signerSha256"
fi

cat <<SUMMARY

================ 生成完成 ================
租户:            $TENANT（包名 $ANDROID_PACKAGE）
keystore:        $KEYSTORE
别名:            $ALIAS
口令文件:        $PASSWORD_OUT   （0600，只此一份，不上屏）
CI base64:       $BASE64_OUT
signerSha256:    $FINGERPRINT

接下来登记三处（缺任一处，发布链都会拒绝）：
1. tenants/$TENANT/tenant.json → "signerSha256": "$FINGERPRINT"$( [ "$WRITE_TENANT" = "yes" ] && echo "   （已写入）" )
2. RN-Admin「发布基础设施 → Android 发布身份」：包名 $ANDROID_PACKAGE，指纹同上
   （或 PUT /v1/admin/release-identity/android）
3. GitHub 环境 android-release 的 secrets：
   ANDROID_RELEASE_KEYSTORE_BASE64 = $BASE64_OUT 的内容
   ANDROID_RELEASE_STORE_PASSWORD  = $PASSWORD_OUT 的内容
   ANDROID_RELEASE_KEY_ALIAS       = $ALIAS
   ANDROID_RELEASE_KEY_PASSWORD    = 同 STORE_PASSWORD（PKCS12 两者相同）

本地构建：
   export ANDROID_RELEASE_KEYSTORE_PATH="$KEYSTORE"
   export ANDROID_RELEASE_STORE_PASSWORD="\$(cat "$PASSWORD_OUT")"
   export ANDROID_RELEASE_KEY_ALIAS="$ALIAS"
   export ANDROID_RELEASE_KEY_PASSWORD="\$ANDROID_RELEASE_STORE_PASSWORD"
   pnpm android:release $TENANT && pnpm android:verify artifacts/<apk> $TENANT

保管：把 keystore 与口令分别放进密钥管理服务，离线加密备份两份并做一次恢复演练，
然后删除本目录的明文文件。丢失即全员重装。已装机用户的迁移见运行手册 §3.3。
SUMMARY
