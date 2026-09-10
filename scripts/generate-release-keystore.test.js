const { spawnSync } = require("node:child_process");
const {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { describe, expect, test } = require("@jest/globals");

const script = resolve(process.cwd(), "scripts/generate-release-keystore.sh");
const anyfun = JSON.parse(
  readFileSync(resolve(process.cwd(), "tenants/anyfun/tenant.json"), "utf8"),
);
const hasKeytool =
  spawnSync("bash", [
    "-c",
    'command -v keytool || test -x "$JAVA_HOME/bin/keytool"',
  ]).status === 0;

/** 临时租户目录 + 临时输出目录；口令走文件，全程非交互 */
function withFixture(run) {
  const root = mkdtempSync(join(tmpdir(), "rn-keystore-"));
  try {
    const tenant = { ...anyfun, slug: "zzkey" };
    delete tenant.signerSha256;
    mkdirSync(join(root, "tenants", "zzkey"), { recursive: true });
    writeFileSync(
      join(root, "tenants", "zzkey", "tenant.json"),
      JSON.stringify(tenant, null, 2) + "\n",
    );
    writeFileSync(join(root, "pw"), "correct-horse-battery-staple-9\n");
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function generate(root, extra = []) {
  return spawnSync(
    "bash",
    [
      script,
      "--tenant",
      "zzkey",
      "--out",
      join(root, "keys"),
      "--password-file",
      join(root, "pw"),
      "--yes",
      ...extra,
    ],
    {
      env: { ...process.env, RN_TENANTS_ROOT: join(root, "tenants") },
      encoding: "utf8",
    },
  );
}

const describeIfKeytool = hasKeytool ? describe : describe.skip;

describeIfKeytool("generate-release-keystore.sh", () => {
  test("generates a PKCS12 keystore, prints a 64-hex fingerprint, writes tenant.json on request and refuses to overwrite", () => {
    withFixture((root) => {
      const first = generate(root, ["--write-tenant", "yes"]);
      expect(first.status).toBe(0);
      const match = /signerSha256:\s+([0-9a-f]{64})/.exec(first.stdout);
      expect(match).not.toBeNull();
      const fingerprint = match[1];
      expect(fingerprint).not.toBe(
        "fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c",
      );
      expect(existsSync(join(root, "keys", "zzkey-release.jks"))).toBe(true);
      expect(existsSync(join(root, "keys", "zzkey-release.jks.base64"))).toBe(
        true,
      );
      // 口令不上屏，只落文件
      expect(first.stdout).not.toContain("correct-horse-battery-staple-9");
      expect(
        readFileSync(join(root, "keys", "zzkey-release.password"), "utf8"),
      ).toBe("correct-horse-battery-staple-9\n");
      const tenant = JSON.parse(
        readFileSync(join(root, "tenants", "zzkey", "tenant.json"), "utf8"),
      );
      expect(tenant.signerSha256).toBe(fingerprint);

      // 已登记指纹 + 已存在 keystore：两道都拒绝
      const second = generate(root, ["--write-tenant", "no"]);
      expect(second.status).not.toBe(0);
      expect(second.stderr).toContain("已登记 signerSha256");
      const forced = generate(root, ["--write-tenant", "no", "--force"]);
      expect(forced.status).not.toBe(0);
      expect(forced.stderr).toContain("拒绝覆盖");
    });
  }, 90_000);

  test("refuses an output directory inside the repository", () => {
    withFixture((root) => {
      const result = spawnSync(
        "bash",
        [
          script,
          "--tenant",
          "zzkey",
          "--out",
          resolve(process.cwd(), "artifacts", "zz-keys-should-not-exist"),
          "--password-file",
          join(root, "pw"),
          "--yes",
        ],
        {
          env: { ...process.env, RN_TENANTS_ROOT: join(root, "tenants") },
          encoding: "utf8",
        },
      );
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("不能在仓库内");
      rmSync(resolve(process.cwd(), "artifacts", "zz-keys-should-not-exist"), {
        recursive: true,
        force: true,
      });
    });
  });
});
