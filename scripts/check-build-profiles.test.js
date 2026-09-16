const { spawnSync } = require("node:child_process");
const {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { expect, test } = require("@jest/globals");

const script = resolve(process.cwd(), "scripts/check-build-profiles.mjs");
const anyfun = JSON.parse(
  readFileSync(resolve(process.cwd(), "tenants/anyfun/tenant.json"), "utf8"),
);

function runWithTenants(tenants) {
  const root = mkdtempSync(join(tmpdir(), "rn-tenants-"));
  try {
    for (const tenant of tenants) {
      mkdirSync(resolve(root, tenant.slug), { recursive: true });
      writeFileSync(
        resolve(root, tenant.slug, "tenant.json"),
        JSON.stringify(tenant),
      );
    }
    return spawnSync(process.execPath, [script], {
      env: { ...process.env, RN_TENANTS_ROOT: root },
      encoding: "utf8",
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const tenantA = {
  ...anyfun,
  slug: "aaa",
  scheme: "aaa",
  androidPackage: "com.example.aaa",
  iosBundleId: "com.example.aaa",
};
const tenantB = {
  ...anyfun,
  slug: "bbb",
  scheme: "bbb",
  androidPackage: "com.example.bbb",
  iosBundleId: "com.example.bbb",
};

test("two tenants sharing an Android package are rejected", () => {
  const result = runWithTenants([
    tenantA,
    { ...tenantB, androidPackage: tenantA.androidPackage },
  ]);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain(
    "androidPackage com.example.aaa is already used by tenant aaa",
  );
});

test("a tenant using the development build identity is rejected", () => {
  const result = runWithTenants([
    { ...tenantA, androidPackage: "com.anyfun.foundation.dev" },
  ]);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("development build identity");
});

test("a malformed signerSha256 is rejected", () => {
  const result = runWithTenants([{ ...tenantA, signerSha256: "FA:C6:17" }]);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("signerSha256 must be 64 lowercase hex");
});

test("distinct tenants pass", () => {
  const result = runWithTenants([tenantA, tenantB]);
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("tenant build configs are valid");
});

// EAS 托管签名会绕开签名闸：EAS 构建机上的非 development Android 构建必须在读配置时就失败
const expoCli = resolve(process.cwd(), "node_modules/expo/bin/cli");
function expoConfig(env) {
  // EXPO_NO_DOTENV：不读开发者本机的 .env.local
  const childEnv = { ...process.env, EXPO_NO_DOTENV: "1", ...env };
  for (const key of [
    "EXPO_PUBLIC_TENANT",
    "EXPO_PUBLIC_DISTRIBUTION_CHANNEL",
    "EAS_BUILD",
    "EAS_BUILD_PLATFORM",
  ])
    if (!(key in env)) delete childEnv[key];
  return spawnSync(process.execPath, [expoCli, "config", "--json"], {
    env: childEnv,
    encoding: "utf8",
  });
}

test("EAS refuses to build a non-development Android package", () => {
  const result = expoConfig({
    EAS_BUILD: "true",
    EAS_BUILD_PLATFORM: "android",
    EXPO_PUBLIC_TENANT: "anyfun",
  });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain(
    "EAS cannot build Android direct packages: Android release APKs are signed only by the signing gate",
  );
}, 60000);

test("EAS still builds iOS and the Android development client", () => {
  const ios = expoConfig({
    EAS_BUILD: "true",
    EAS_BUILD_PLATFORM: "ios",
    EXPO_PUBLIC_TENANT: "anyfun",
  });
  expect(ios.stderr).not.toContain("EAS cannot build");
  expect(ios.status).toBe(0);

  const devClient = expoConfig({
    EAS_BUILD: "true",
    EAS_BUILD_PLATFORM: "android",
  });
  expect(devClient.stderr).not.toContain("EAS cannot build");
  expect(devClient.status).toBe(0);
  expect(JSON.parse(devClient.stdout).android.package).toBe(
    "com.anyfun.foundation.dev",
  );
}, 60000);
