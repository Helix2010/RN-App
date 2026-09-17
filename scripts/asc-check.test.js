const { Buffer } = require("node:buffer");
const { execFileSync, spawn } = require("node:child_process");
const { generateKeyPairSync } = require("node:crypto");
const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { createServer } = require("node:http");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const {
  afterAll,
  beforeAll,
  beforeEach,
  expect,
  test,
} = require("@jest/globals");

const script = resolve(process.cwd(), "scripts/asc-check.mjs");
const BUNDLE_ID = "com.anyfun.foundation";
const APP_ID = "6811004741";

let server;
let baseUrl;
let workspace;
let envPath;
/** 每个用例自己决定假 ASC 返回什么 */
let state;
/** 脚本发出去的 Authorization 头，用来验 JWT 的形状 */
let seenAuthorization;

// src/test/setup.ts 把 Date.now() 锚定到夹具日期，而被测脚本跑在子进程里、用的是
// 真实时钟。过期判断要跨这条边界，所以基准时间也从一个子进程取。
const realNowMs = Number(
  execFileSync(process.execPath, [
    "-e",
    "process.stdout.write(String(Date.now()))",
  ]).toString(),
);

function days(count) {
  return new Date(realNowMs + count * 86_400_000).toISOString();
}

beforeAll(async () => {
  workspace = mkdtempSync(join(tmpdir(), "asc-check-"));
  const { privateKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const keyPath = join(workspace, "AuthKey_TEST123456.p8");
  writeFileSync(keyPath, privateKey);
  envPath = join(workspace, "asc.env");
  writeFileSync(
    envPath,
    [
      "# 注释与空行要被跳过",
      "",
      "ASC_ISSUER_ID=11111111-2222-3333-4444-555555555555",
      "ASC_KEY_ID=TEST123456",
      `ASC_PRIVATE_KEY_PATH=${keyPath}`,
      "APPLE_TEAM_ID=ABCDE12345",
      `IOS_BUNDLE_ID=${BUNDLE_ID}`,
    ].join("\n"),
  );

  server = createServer((request, response) => {
    seenAuthorization = request.headers.authorization;
    const url = new URL(request.url, "http://127.0.0.1");
    let body = { data: [] };
    if (url.pathname === "/v1/apps") {
      body = { data: state.app ? [state.app] : [] };
    } else if (url.pathname.endsWith("/builds")) {
      body = { data: state.builds };
    } else if (url.pathname.endsWith("/betaGroups")) {
      body = { data: state.groups };
    } else if (url.pathname.endsWith("/betaAppReviewDetail")) {
      body = { data: state.reviewDetail };
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((done) => server.close(done));
  rmSync(workspace, { recursive: true, force: true });
});

beforeEach(() => {
  state = {
    app: { id: APP_ID, attributes: { name: "AnyFun", bundleId: BUNDLE_ID } },
    builds: [
      {
        attributes: {
          version: "9",
          processingState: "VALID",
          expired: false,
          expirationDate: days(60),
        },
      },
    ],
    groups: [
      {
        attributes: {
          name: "公开测试",
          isInternalGroup: false,
          publicLinkEnabled: true,
          publicLink: "https://testflight.apple.com/join/AAAAAAAA",
        },
      },
    ],
    reviewDetail: {
      attributes: {
        contactEmail: "a@example.com",
        contactPhone: "123",
        demoAccountRequired: false,
      },
    },
  };
});

function run(extra = []) {
  return new Promise((done) => {
    const child = spawn(
      process.execPath,
      [script, "--env", envPath, "--tenant", "anyfun", ...extra],
      { env: { ...process.env, ASC_API_BASE: baseUrl } },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (code) => done({ code, stdout, stderr }));
  });
}

test("身份齐备时通过，并按 ASC 的规矩签 ES256 token", async () => {
  const { code, stdout } = await run();
  expect(stdout).toContain("AnyFun");
  expect(stdout).toContain("App Store Connect 侧检查通过");
  expect(code).toBe(0);

  const [rawHeader, rawPayload, signature] = seenAuthorization
    .replace("Bearer ", "")
    .split(".");
  const header = JSON.parse(Buffer.from(rawHeader, "base64url").toString());
  const payload = JSON.parse(Buffer.from(rawPayload, "base64url").toString());
  expect(header).toMatchObject({ alg: "ES256", kid: "TEST123456", typ: "JWT" });
  expect(payload.aud).toBe("appstoreconnect-v1");
  // Apple 拒收有效期超过 20 分钟的 token
  expect(payload.exp - payload.iat).toBeLessThanOrEqual(1200);
  // raw r||s 是 64 字节；DER 签名会更长且长度不固定——ES256 最常见的坑
  expect(Buffer.from(signature, "base64url")).toHaveLength(64);
});

test("ASC 上的 bundleId 与 tenant.json 不一致时失败", async () => {
  state.app = {
    id: APP_ID,
    attributes: { name: "别人", bundleId: "com.other.app" },
  };
  const { code, stderr } = await run();
  expect(stderr).toContain("不一致");
  expect(code).toBe(1);
});

test("查不到 App 记录时失败", async () => {
  state.app = null;
  const { code, stderr } = await run();
  expect(stderr).toContain("没有 bundleId");
  expect(code).toBe(1);
});

test("build 临近过期只是警告，--strict 下才失败", async () => {
  state.builds = [
    {
      attributes: {
        version: "9",
        processingState: "VALID",
        expired: false,
        expirationDate: days(10),
      },
    },
  ];
  const lenient = await run();
  expect(lenient.stdout).toContain("10 天后过期");
  expect(lenient.code).toBe(0);
  const strict = await run(["--strict"]);
  expect(strict.code).toBe(1);
});

test("没有外部测试组或没开公开链接都会提醒", async () => {
  state.groups = [{ attributes: { name: "内部", isInternalGroup: true } }];
  const { stdout, code } = await run();
  expect(stdout).toContain("还没有外部测试组");
  expect(code).toBe(0);
});

test("--json 输出公开链接与 build 概要", async () => {
  const { stdout, code } = await run(["--json"]);
  const report = JSON.parse(stdout);
  expect(report).toMatchObject({ appId: APP_ID, bundleId: BUNDLE_ID });
  expect(report.publicLinks).toEqual([
    "https://testflight.apple.com/join/AAAAAAAA",
  ]);
  expect(report.builds[0]).toMatchObject({ version: "9", expired: false });
  expect(code).toBe(0);
});
