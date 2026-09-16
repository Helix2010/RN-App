import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readDevelopmentIdentity } from "./tenant-config.mjs";
import {
  assertApkUnsigned,
  findBuildTool,
  inspectBadging,
  inspectSigners,
} from "./lib/android-release-identity.js";
import { loadMachineEnv } from "./lib/machine-env.js";

/**
 * 开发自测出包：只给**开发包名**签名，用这台开发机自己生成的测试密钥。
 *
 *   pnpm android:dev-signed keygen             生成本机测试密钥（一次）
 *   pnpm android:dev-signed                    无租户 prebuild + assembleRelease，签名，输出到 artifacts/
 *   pnpm android:dev-signed --apk <未签名包>    只给一个已经构建好的未签名开发包签名
 *
 * 为什么只签开发包名：正式包只由签名闸产出（RN-Server
 * `docs/design/android-signing-gate-2026-09-16.md`）。开发包名不是任何租户登记的身份，
 * 服务端上传门禁天然拒收，签出来的包只能装在自己的设备上。包名不是开发包名时脚本
 * 拒绝签名——要验证正式包的行为（例如对正式基线的热更新），在控制台排构建任务，
 * 从签名闸产出的包下载安装。
 *
 * 测试密钥放在仓库外：默认 `~/.rn-test-keys/`，`RN_TEST_KEYS_DIR`（进程环境或 .env.local）
 * 可改。口令是随机生成的，只写进 0600 文件，不打印、不进命令行参数（keytool 用
 * `-storepass:file`，apksigner 用 `--ks-pass file:`）。
 */

const KEYSTORE_FILE = "android-dev-test.p12";
const PASSWORD_FILE = "android-dev-test.password";
const KEY_ALIAS = "rn-dev-test";
const KEY_DNAME = "CN=RN-App local test key, OU=Not for distribution";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const projectRoot = process.cwd();
loadMachineEnv(projectRoot, [
  "ANDROID_HOME",
  "ANDROID_SDK_ROOT",
  "JAVA_HOME",
  "RN_TEST_KEYS_DIR",
]);

const env = { ...process.env, NODE_ENV: "production" };
if (env.JAVA_HOME)
  // apksigner 是个调 PATH 上 java 的 shell 脚本
  env.PATH = `${join(env.JAVA_HOME, "bin")}:${env.PATH ?? ""}`;
const keytool = env.JAVA_HOME
  ? join(env.JAVA_HOME, "bin", "keytool")
  : "keytool";

const developmentPackage = readDevelopmentIdentity().androidPackage;

// 测试密钥目录：RN_TEST_KEYS_DIR 或 ~/.rn-test-keys（文档化的默认位置）
const keysDir =
  env.RN_TEST_KEYS_DIR === undefined
    ? join(homedir(), ".rn-test-keys")
    : resolve(env.RN_TEST_KEYS_DIR);
const keystore = join(keysDir, KEYSTORE_FILE);
const passwordFile = join(keysDir, PASSWORD_FILE);

const USAGE = `Usage:
  pnpm android:dev-signed keygen          generate this machine's test key in ${keysDir}
  pnpm android:dev-signed                 build the no-tenant development package and sign it
  pnpm android:dev-signed --apk <path>    sign an already built, unsigned development APK`;

function isInside(child, parent) {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

/** 目录与文件只许本人读写：组和其他人有任何权限都拒绝，让人自己去收紧。 */
function assertPrivate(path, expected) {
  const mode = statSync(path).mode & 0o777;
  if ((mode & 0o077) !== 0)
    throw new Error(
      `${path} is readable by other users (mode ${mode.toString(8)}); run chmod ${expected.toString(8)} ${path}`,
    );
}

/** 本机测试密钥的证书 SHA-256（DER），与 apksigner 打印的签名者指纹同一口径。 */
function certificateSha256() {
  const result = spawnSync(
    keytool,
    [
      "-exportcert",
      "-keystore",
      keystore,
      "-storetype",
      "PKCS12",
      "-alias",
      KEY_ALIAS,
      "-storepass:file",
      passwordFile,
    ],
    { env },
  );
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `keytool -exportcert failed (${result.status}): ${result.stderr.toString("utf8")}`,
    );
  return createHash("sha256").update(result.stdout).digest("hex");
}

function keygen() {
  for (const root of new Set([repositoryRoot, projectRoot]))
    if (isInside(keysDir, root))
      throw new Error(
        `Refusing to put the test key inside the repository (${keysDir}); keep it outside, e.g. ~/.rn-test-keys`,
      );
  if (existsSync(keystore) || existsSync(passwordFile))
    throw new Error(
      `${keysDir} already holds a test key; to replace it, delete ${KEYSTORE_FILE} and ${PASSWORD_FILE} yourself`,
    );
  mkdirSync(keysDir, { recursive: true, mode: 0o700 });
  assertPrivate(keysDir, 0o700);
  // 口令只在这一行出现：随机生成，直接写进 0600 文件
  writeFileSync(passwordFile, randomBytes(32).toString("base64url"), {
    mode: 0o600,
    flag: "wx",
  });
  const result = spawnSync(
    keytool,
    [
      "-genkeypair",
      "-keystore",
      keystore,
      "-storetype",
      "PKCS12",
      "-alias",
      KEY_ALIAS,
      "-keyalg",
      "EC",
      "-groupname",
      "secp256r1",
      "-sigalg",
      "SHA256withECDSA",
      "-validity",
      "3650",
      "-dname",
      KEY_DNAME,
      "-storepass:file",
      passwordFile,
      "-keypass:file",
      passwordFile,
    ],
    { env, encoding: "utf8" },
  );
  if (result.error || result.status !== 0) {
    rmSync(keystore, { force: true });
    rmSync(passwordFile, { force: true });
    throw new Error(
      `keytool -genkeypair failed: ${result.error?.message ?? result.stderr}`,
    );
  }
  chmodSync(keystore, 0o600);
  console.log(
    [
      `Test key:        ${keystore}`,
      `Password file:   ${passwordFile} (0600, never printed)`,
      `Certificate SHA-256: ${certificateSha256()}`,
      `Only for ${developmentPackage}; this key must never sign a tenant package.`,
    ].join("\n"),
  );
}

function requireTestKey() {
  if (!existsSync(keystore) || !existsSync(passwordFile))
    throw new Error(
      `No test key in ${keysDir}; run \`pnpm android:dev-signed keygen\` first`,
    );
  assertPrivate(keysDir, 0o700);
  assertPrivate(passwordFile, 0o600);
  assertPrivate(keystore, 0o600);
}

function sdkRootOrThrow() {
  const sdkRoot = env.ANDROID_HOME ?? env.ANDROID_SDK_ROOT;
  if (!sdkRoot || !existsSync(sdkRoot))
    throw new Error(
      "ANDROID_HOME must point at an installed Android SDK; set it in .env.local",
    );
  return sdkRoot;
}

function buildTool(sdkRoot, tool, args) {
  const result = spawnSync(findBuildTool(sdkRoot, tool), args, {
    env,
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `${tool} failed (${result.status}): ${result.stderr || result.stdout}`,
    );
}

function refuseFormalPackage(packageName) {
  if (packageName !== developmentPackage)
    throw new Error(
      `Refusing to sign ${packageName}: android:dev-signed only signs the development package ${developmentPackage}. ` +
        "Formal packages are signed only by the signing gate; to test one, queue a build in the console and install the APK it produces.",
    );
}

function signDevelopmentApk(apkPath, sdkRoot) {
  // 输入必须是未签名包，包名必须是开发包名：两条都在碰密钥之前查
  assertApkUnsigned({ apkPath, sdkRoot, env });
  const badging = inspectBadging({ apkPath, sdkRoot, env });
  refuseFormalPackage(badging.packageName);
  requireTestKey();

  const artifact = resolve(
    projectRoot,
    "artifacts",
    `${badging.packageName}-${badging.versionName}-build${badging.versionCode}-test-signed.apk`,
  );
  const work = mkdtempSync(join(tmpdir(), "rn-dev-signed-"));
  try {
    const aligned = join(work, "aligned.apk");
    buildTool(sdkRoot, "zipalign", ["-f", "-P", "16", "4", apkPath, aligned]);
    mkdirSync(dirname(artifact), { recursive: true });
    buildTool(sdkRoot, "apksigner", [
      "sign",
      "--ks",
      keystore,
      "--ks-type",
      "PKCS12",
      "--ks-key-alias",
      KEY_ALIAS,
      "--ks-pass",
      `file:${passwordFile}`,
      "--v4-signing-enabled",
      "false",
      "--out",
      artifact,
      aligned,
    ]);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  const expected = certificateSha256();
  const signers = inspectSigners({ apkPath: artifact, sdkRoot, env });
  if (signers.length !== 1 || signers[0] !== expected) {
    rmSync(artifact, { force: true });
    throw new Error(
      `Signed APK carries ${signers.join(", ") || "no signer"}, expected only the local test key ${expected}`,
    );
  }
  console.log(
    `Test-signed ${badging.packageName} ${badging.versionName} (${badging.versionCode}) · signer ${expected}\n${artifact}`,
  );
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? projectRoot,
    env,
    encoding: options.capture ? "utf8" : undefined,
    stdio: options.capture ? ["ignore", "pipe", "inherit"] : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} ${args.join(" ")} exited ${result.status}`);
  return result.stdout;
}

function buildAndSign() {
  if (env.EXPO_PUBLIC_TENANT)
    throw new Error(
      `android:dev-signed builds the no-tenant development package; unset EXPO_PUBLIC_TENANT (${env.EXPO_PUBLIC_TENANT}). ` +
        "To test a tenant release, queue a build in the console and install the APK the signing gate produces.",
    );
  const sdkRoot = sdkRootOrThrow();
  requireTestKey();
  const config = JSON.parse(
    run("pnpm", ["exec", "expo", "config", "--json"], { capture: true }),
  );
  // .env.local 里的 EXPO_PUBLIC_TENANT 进程环境看不到，Expo 自己会读；以解析后的配置为准
  refuseFormalPackage(config.android?.package);
  run("pnpm", ["exec", "expo", "prebuild", "--platform", "android", "--clean"]);
  run("./gradlew", ["assembleRelease"], {
    cwd: resolve(projectRoot, "android"),
  });
  const output = resolve(
    projectRoot,
    "android/app/build/outputs/apk/release/app-release-unsigned.apk",
  );
  if (!existsSync(output)) throw new Error(`Gradle did not produce ${output}`);
  signDevelopmentApk(output, sdkRoot);
}

const args = process.argv.slice(2);
try {
  if (env.RN_TEST_KEYS_DIR !== undefined && !isAbsolute(env.RN_TEST_KEYS_DIR))
    throw new Error(
      `RN_TEST_KEYS_DIR must be an absolute path, received ${env.RN_TEST_KEYS_DIR}`,
    );
  if (args.length === 1 && args[0] === "keygen") keygen();
  else if (args.length === 0) buildAndSign();
  else if (args.length === 2 && args[0] === "--apk")
    signDevelopmentApk(resolve(projectRoot, args[1]), sdkRootOrThrow());
  else {
    console.error(USAGE);
    process.exit(2);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
