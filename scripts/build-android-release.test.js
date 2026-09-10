const { spawnSync } = require("node:child_process");
const {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { expect, test } = require("@jest/globals");

const script = resolve(process.cwd(), "scripts/build-android-release.mjs");

test("release build refuses to fall back to a local API URL", () => {
  const env = { ...process.env };
  delete env.EXPO_PUBLIC_TENANT;
  delete env.EXPO_PUBLIC_API_BASE_URL;
  const result = spawnSync(process.execPath, [script, "--check-env"], {
    env,
    encoding: "utf8",
  });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("EXPO_PUBLIC_TENANT is required");
});

test("release build keeps the production tenant configuration together", () => {
  const result = spawnSync(
    process.execPath,
    [script, "anyfun", "--check-env"],
    {
      env: {
        ...process.env,
        EXPO_PUBLIC_API_BASE_URL: "https://wrong-tenant.example",
        EXPO_PUBLIC_APPLICATION_ID: "wrong-tenant",
      },
      encoding: "utf8",
    },
  );
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({
    tenant: "anyfun",
    apiBaseUrl: "https://api.anyfun.win",
    distributionChannel: "direct",
    otaChannel: "production",
    applicationId: "dex-mobile",
  });
});

test("release build fails fast when the push config file is missing", () => {
  const result = spawnSync(process.execPath, [script, "anyfun"], {
    env: {
      ...process.env,
      ANDROID_HOME: process.cwd(),
      GOOGLE_SERVICES_JSON: resolve(
        process.cwd(),
        "missing-google-services.json",
      ),
    },
    encoding: "utf8",
  });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain(
    "GOOGLE_SERVICES_JSON points to a missing file",
  );
});

test("release build refuses to silently ship without push", () => {
  const result = spawnSync(process.execPath, [script, "anyfun"], {
    env: {
      ...process.env,
      ANDROID_HOME: process.cwd(),
      GOOGLE_SERVICES_JSON: "",
    },
    encoding: "utf8",
  });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("GOOGLE_SERVICES_JSON is required");
});

const anyfunTenant = JSON.parse(
  readFileSync(resolve(process.cwd(), "tenants/anyfun/tenant.json"), "utf8"),
);

/** 临时租户目录（RN_TENANTS_ROOT 只在 Jest 子进程里生效）：不往仓库 tenants/ 写任何夹具 */
function withTenantFixture(tenant, run) {
  const root = mkdtempSync(join(tmpdir(), "rn-tenants-"));
  try {
    mkdirSync(resolve(root, tenant.slug), { recursive: true });
    writeFileSync(
      resolve(root, tenant.slug, "tenant.json"),
      JSON.stringify(tenant),
    );
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const SIGNING_ENV = [
  "ANDROID_RELEASE_KEYSTORE_PATH",
  "ANDROID_RELEASE_STORE_PASSWORD",
  "ANDROID_RELEASE_KEY_ALIAS",
  "ANDROID_RELEASE_KEY_PASSWORD",
];

function releaseEnv(root, overrides = {}) {
  const env = {
    ...process.env,
    RN_TENANTS_ROOT: root,
    // 临时目录里没有 .env.local：断言不受开发者本机 ANDROID_RELEASE_KEYSTORE_PATH 等机器配置影响
    RN_ENV_ROOT: root,
    ANDROID_HOME: process.cwd(),
    GOOGLE_SERVICES_JSON: "",
    ...overrides,
  };
  for (const key of SIGNING_ENV) if (!(key in overrides)) delete env[key];
  return env;
}

test("release build refuses a tenant that has not pinned its production signer", () => {
  const unpinned = { ...anyfunTenant, slug: "zz-unpinned" };
  delete unpinned.signerSha256;
  withTenantFixture(unpinned, (root) => {
    const result = spawnSync(
      process.execPath,
      [script, unpinned.slug, "--no-push"],
      { env: releaseEnv(root), encoding: "utf8" },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("must pin signerSha256");
  });
});

const pinned = {
  ...anyfunTenant,
  slug: "zz-pinned",
  scheme: "zzpinned",
  androidPackage: "com.example.zzpinned",
  iosBundleId: "com.example.zzpinned",
  signerSha256:
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
};

test("release build refuses to start without the signing material in the environment", () => {
  withTenantFixture(pinned, (root) => {
    const result = spawnSync(
      process.execPath,
      [script, pinned.slug, "--no-push"],
      {
        env: releaseEnv(root),
        encoding: "utf8",
      },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "Release signing requires ANDROID_RELEASE_KEYSTORE_PATH",
    );
  });
});

test("release build rejects a relative keystore path (Gradle would resolve it elsewhere)", () => {
  withTenantFixture(pinned, (root) => {
    const result = spawnSync(
      process.execPath,
      [script, pinned.slug, "--no-push"],
      {
        env: releaseEnv(root, {
          ANDROID_RELEASE_KEYSTORE_PATH: "keys/release.jks",
          ANDROID_RELEASE_STORE_PASSWORD: "x",
          ANDROID_RELEASE_KEY_ALIAS: "x",
          ANDROID_RELEASE_KEY_PASSWORD: "x",
        }),
        encoding: "utf8",
      },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("must be an absolute path");
  });
});
