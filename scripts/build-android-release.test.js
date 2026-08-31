const { spawnSync } = require("node:child_process");
const { resolve } = require("node:path");
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
