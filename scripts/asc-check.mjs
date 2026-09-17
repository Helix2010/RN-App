#!/usr/bin/env node
/**
 * App Store Connect 只读体检（设计 `RN-Server/docs/design/ios-testflight-distribution-2026-09-17.md` §7.1）。
 *
 * 发版前跑一次，回答四个只有 Apple 那边才知道答案的问题：这把 Key 还能用吗、
 * App 记录和 `tenant.json` 对得上吗、当前 TestFlight build 还有几天过期、公开
 * 链接开着吗。**全部是 GET**，不改 Apple 侧任何状态——提审、开关公开链接、增删
 * 测试员一律由人在 ASC 上点（§4.6.6）。
 *
 * 机密纪律：`.p8` 只按路径读进内存用于签名，私钥、JWT、演示账号口令都不打印。
 * 凭证文件是机器级输入，路径由 `--env` 或 `ASC_ENV_FILE` 给，不写进仓库。
 *
 * 用法：
 *   node scripts/asc-check.mjs --env <凭证文件> [--tenant anyfun] [--json] [--strict]
 *
 * 凭证文件（0600，放在仓库外）：
 *   ASC_ISSUER_ID=...
 *   ASC_KEY_ID=...
 *   ASC_PRIVATE_KEY_PATH=/abs/path/AuthKey_XXXXXXXXXX.p8
 *   APPLE_TEAM_ID=...
 *   IOS_BUNDLE_ID=com.example.app
 */
import { Buffer } from "node:buffer";
import { createPrivateKey, createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readTenantConfig } from "./tenant-config.mjs";

const API_BASE =
  process.env.ASC_API_BASE ?? "https://api.appstoreconnect.apple.com";
// Apple 拒绝有效期超过 20 分钟的 token；给 15 分钟，留足时钟偏移的余量
const TOKEN_TTL_SECONDS = 900;
// build 过期前多久开始报警（设计 §5 的 90 天时钟：过期前 14 天必须已经在出下一个包）
const EXPIRY_WARNING_DAYS = 14;

function parseArgs(argv) {
  const args = { json: false, strict: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--json") args.json = true;
    else if (flag === "--strict") args.strict = true;
    else if (flag === "--env") args.env = argv[(i += 1)];
    else if (flag === "--tenant") args.tenant = argv[(i += 1)];
    else throw new Error(`未知参数：${flag}`);
  }
  return args;
}

/** 只认 `KEY=value`，value 里的 `=` 原样保留；注释与空行跳过。 */
export function parseEnvFile(text) {
  const values = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    values[trimmed.slice(0, separator).trim()] = trimmed
      .slice(separator + 1)
      .trim();
  }
  return values;
}

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

/**
 * ES256 的 JWT 签名是 raw `r||s`（64 字节），不是 OpenSSL 默认的 DER。
 * `dsaEncoding: "ieee-p1363"` 让 node 直接给出前者——手工拆 DER 是这条路上最常见的坑。
 */
function signToken({ issuerId, keyId, privateKeyPem, now }) {
  const header = { alg: "ES256", kid: keyId, typ: "JWT" };
  const payload = {
    iss: issuerId,
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
    aud: "appstoreconnect-v1",
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = createSign("SHA256")
    .update(signingInput)
    .sign({ key: createPrivateKey(privateKeyPem), dsaEncoding: "ieee-p1363" });
  return `${signingInput}.${signature.toString("base64url")}`;
}

async function get(path, token) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

function apiErrors(body) {
  return (body.errors ?? [])
    .map((error) => `${error.title ?? ""}: ${error.detail ?? ""}`)
    .join("; ");
}

// 向上取整：剩 9.6 天要说成 10 天而不是 9 天，剩 20 分钟要说成 1 天而不是 0 天——
// 「还剩几天」被低估一天，正好会让人以为还来得及。
function daysUntil(iso, now) {
  if (!iso) return null;
  return Math.ceil((Date.parse(iso) - now) / 86_400_000);
}

/** 把一次体检压成结构化结果；打印与退出码都从它来，不各算各的。 */
export function summarize({
  app,
  builds,
  groups,
  reviewDetail,
  expectedBundleId,
  now,
}) {
  const failures = [];
  const warnings = [];
  if (!app) {
    failures.push(
      `App Store Connect 里没有 bundleId 为 ${expectedBundleId} 的 App 记录`,
    );
    return { failures, warnings, builds: [], groups: [] };
  }
  if (app.attributes?.bundleId !== expectedBundleId) {
    failures.push(
      `App 记录的 bundleId（${app.attributes?.bundleId}）与期望值（${expectedBundleId}）不一致`,
    );
  }
  const live = builds.filter((build) => !build.attributes?.expired);
  if (live.length === 0) {
    warnings.push(
      builds.length === 0
        ? "还没有任何 build（iOS 包一次都没打过）"
        : "所有 build 都已过期：TestFlight 用户现在打不开",
    );
  } else {
    const soonest = live
      .map((build) => daysUntil(build.attributes?.expirationDate, now))
      .filter((days) => days !== null)
      .sort((a, b) => a - b)[0];
    if (soonest !== undefined && soonest <= EXPIRY_WARNING_DAYS) {
      warnings.push(
        `最近的 build ${soonest} 天后过期：该出下一个包了（设计 §5）`,
      );
    }
  }
  const external = groups.filter((group) => !group.attributes?.isInternalGroup);
  if (external.length === 0) {
    warnings.push("还没有外部测试组：公开链接要先有外部组 + 一个过审的 build");
  } else if (!external.some((group) => group.attributes?.publicLinkEnabled)) {
    warnings.push("外部测试组都没开公开链接：扫码装不了");
  }
  const review = reviewDetail?.attributes ?? {};
  if (!review.contactEmail || !review.contactPhone) {
    warnings.push("Beta 审核资料不全（联系人邮箱/电话），提审会被退回");
  }
  if (review.demoAccountRequired && !review.demoAccountName) {
    warnings.push("勾了「需要演示账号」但没填账号");
  }
  return { failures, warnings, builds, groups, app };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const envPath = args.env ?? process.env.ASC_ENV_FILE;
  if (!envPath) {
    console.error(
      "需要 --env <凭证文件>（或设 ASC_ENV_FILE）。文件放仓库外，权限 600。",
    );
    process.exit(2);
  }
  const env = parseEnvFile(readFileSync(resolve(envPath), "utf8"));
  const missing = [
    "ASC_ISSUER_ID",
    "ASC_KEY_ID",
    "ASC_PRIVATE_KEY_PATH",
    "IOS_BUNDLE_ID",
  ].filter((key) => !env[key]);
  if (missing.length > 0) {
    console.error(`凭证文件缺少：${missing.join("、")}`);
    process.exit(2);
  }

  // tenant.json 是 bundle id 的唯一事实来源；传了 --tenant 就以它为准，
  // 凭证文件里那份只是给不在仓库里跑的场景用的副本
  let expectedBundleId = env.IOS_BUNDLE_ID;
  if (args.tenant) {
    const tenant = readTenantConfig(args.tenant);
    if (tenant.iosBundleId !== env.IOS_BUNDLE_ID) {
      console.error(
        `凭证文件的 IOS_BUNDLE_ID（${env.IOS_BUNDLE_ID}）与 tenants/${args.tenant}/tenant.json（${tenant.iosBundleId}）不一致`,
      );
      process.exit(1);
    }
    expectedBundleId = tenant.iosBundleId;
  }

  const now = Date.now();
  const token = signToken({
    issuerId: env.ASC_ISSUER_ID,
    keyId: env.ASC_KEY_ID,
    privateKeyPem: readFileSync(resolve(env.ASC_PRIVATE_KEY_PATH), "utf8"),
    now: Math.floor(now / 1000),
  });

  const apps = await get(
    `/v1/apps?filter[bundleId]=${encodeURIComponent(expectedBundleId)}`,
    token,
  );
  if (apps.status !== 200) {
    console.error(
      `App Store Connect 拒绝了这次请求（HTTP ${apps.status}）：${apiErrors(apps.body)}`,
    );
    process.exit(1);
  }
  const app = (apps.body.data ?? [])[0] ?? null;
  const appId = app?.id;
  const [builds, groups, reviewDetail] = appId
    ? await Promise.all([
        get(`/v1/apps/${appId}/builds?limit=10`, token),
        get(`/v1/apps/${appId}/betaGroups?limit=20`, token),
        get(`/v1/apps/${appId}/betaAppReviewDetail`, token),
      ])
    : [{ body: {} }, { body: {} }, { body: {} }];

  const result = summarize({
    app,
    builds: builds.body.data ?? [],
    groups: groups.body.data ?? [],
    reviewDetail: reviewDetail.body.data,
    expectedBundleId,
    now,
  });

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          appId: appId ?? null,
          appName: app?.attributes?.name ?? null,
          bundleId: app?.attributes?.bundleId ?? null,
          builds: result.builds.map((build) => ({
            version: build.attributes?.version,
            processingState: build.attributes?.processingState,
            expired: build.attributes?.expired,
            expirationDate: build.attributes?.expirationDate,
          })),
          publicLinks: result.groups
            .filter((group) => group.attributes?.publicLinkEnabled)
            .map((group) => group.attributes?.publicLink),
          failures: result.failures,
          warnings: result.warnings,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(
      `App：${app?.attributes?.name ?? "（未找到）"}  bundleId=${app?.attributes?.bundleId ?? "-"}  id=${appId ?? "-"}`,
    );
    for (const build of result.builds) {
      const attributes = build.attributes ?? {};
      console.log(
        `  build ${attributes.version}  ${attributes.processingState}  过期=${attributes.expirationDate ?? "-"}${attributes.expired ? "（已过期）" : ""}`,
      );
    }
    for (const group of result.groups) {
      const attributes = group.attributes ?? {};
      console.log(
        `  测试组 ${attributes.name}（${attributes.isInternalGroup ? "内部" : "外部"}）公开链接=${attributes.publicLink ?? "未开"}`,
      );
    }
    for (const warning of result.warnings) console.log(`  ⚠ ${warning}`);
    for (const failure of result.failures) console.error(`  ✗ ${failure}`);
  }

  if (result.failures.length > 0) process.exit(1);
  if (args.strict && result.warnings.length > 0) process.exit(1);
  if (!args.json) console.log("App Store Connect 侧检查通过。");
}

// 被测试 import 时不自动执行
if (process.argv[1] && process.argv[1].endsWith("asc-check.mjs")) {
  await main();
}
