const { spawnSync } = require("node:child_process");
const {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { describe, expect, test } = require("@jest/globals");

const script = resolve(process.cwd(), "scripts/generate-ota-signing-key.sh");
const anyfun = JSON.parse(
  readFileSync(resolve(process.cwd(), "tenants/anyfun/tenant.json"), "utf8"),
);
const hasOpenssl = spawnSync("bash", ["-c", "command -v openssl"]).status === 0;

function withFixture(run) {
  const root = mkdtempSync(join(tmpdir(), "rn-ota-keygen-"));
  try {
    mkdirSync(join(root, "tenants", "zzota"), { recursive: true });
    writeFileSync(
      join(root, "tenants", "zzota", "tenant.json"),
      JSON.stringify({ ...anyfun, slug: "zzota" }, null, 2) + "\n",
    );
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
      "zzota",
      "--out",
      join(root, "keys"),
      "--yes",
      ...extra,
    ],
    {
      encoding: "utf8",
      env: { ...process.env, RN_TENANTS_ROOT: join(root, "tenants") },
    },
  );
}

/** openssl 眼里这张证书长什么样 */
function certificateText(path) {
  return spawnSync("openssl", ["x509", "-in", path, "-noout", "-text"], {
    encoding: "utf8",
  }).stdout;
}

const maybe = hasOpenssl ? describe : describe.skip;

maybe("ota signing key generator", () => {
  test("produces a certificate expo-updates will actually accept", () => {
    withFixture((root) => {
      const result = generate(root, ["--keysize", "2048"]);
      expect(result.status).toBe(0);

      const key = join(root, "keys", "private-key.pem");
      const cert = join(root, "keys", "certificate.pem");
      expect(existsSync(key)).toBe(true);
      expect(existsSync(cert)).toBe(true);

      // 这两条是 expo-updates CertificateChain.kt:39-58 的硬性前提。少任何一个
      // 都会在**运行时**被拒，症状是所有设备静默停在内置 bundle——所以它们必须
      // 由生成器保证，而不是靠谁记得加 openssl 参数
      const text = certificateText(cert);
      expect(text).toContain("Digital Signature");
      expect(text).toContain("Code Signing");
      // 叶证书不是 CA
      expect(text).toContain("CA:FALSE");
    });
  });

  test("keeps the private key unreadable by anyone else", () => {
    withFixture((root) => {
      expect(generate(root, ["--keysize", "2048"]).status).toBe(0);
      const mode = statSync(join(root, "keys", "private-key.pem")).mode & 0o777;
      expect(mode).toBe(0o600);
      expect(statSync(join(root, "keys")).mode & 0o777).toBe(0o700);
    });
  });

  test("emits a request body that carries both PEMs and nothing hand-assembled", () => {
    withFixture((root) => {
      expect(
        generate(root, ["--keysize", "2048", "--key-id", "rotate-1"]).status,
      ).toBe(0);
      const body = JSON.parse(
        readFileSync(join(root, "keys", "signing-key.json"), "utf8"),
      );
      expect(body.keyId).toBe("rotate-1");
      expect(body.confirm).toBe(true);
      expect(body.expectedVersion).toBe(0);
      // PEM 带换行，手拼 JSON 必错，所以请求体必须由脚本生成
      expect(body.privateKeyPem).toContain("PRIVATE KEY");
      expect(body.certificatePem).toContain("BEGIN CERTIFICATE");
      expect(
        statSync(join(root, "keys", "signing-key.json")).mode & 0o777,
      ).toBe(0o600);
    });
  });

  test("carries the caller's expectedVersion so rotation needs no hand-edited JSON", () => {
    withFixture((root) => {
      expect(
        generate(root, ["--keysize", "2048", "--expected-version", "3"]).status,
      ).toBe(0);
      const body = JSON.parse(
        readFileSync(join(root, "keys", "signing-key.json"), "utf8"),
      );
      // 服务端拿 expectedVersion 做乐观锁：不等于线上当前 version 就拒绝写入。
      // 之前只能手改这个 JSON——而这个文件里有私钥，编辑器备份/剪贴板都是泄露面
      expect(body.expectedVersion).toBe(3);
      expect(body.reason).toMatch(/rotate/);
    });
  });

  test("refuses an expectedVersion the server could never match", () => {
    withFixture((root) => {
      const result = generate(root, ["--keysize", "2048", "--expected-version", "-1"]);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/expected-version/);
    });
  });

  test("refuses to write inside the repository", () => {
    withFixture((root) => {
      // 私钥一旦入库就无法撤回
      const result = spawnSync(
        "bash",
        [
          script,
          "--tenant",
          "zzota",
          "--out",
          resolve(process.cwd(), "artifacts/ota-keys"),
          "--yes",
        ],
        {
          encoding: "utf8",
          env: { ...process.env, RN_TENANTS_ROOT: join(root, "tenants") },
        },
      );
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/不能在仓库内/);
      expect(
        existsSync(
          resolve(process.cwd(), "artifacts/ota-keys/private-key.pem"),
        ),
      ).toBe(false);
    });
  });

  test("refuses to overwrite an existing key", () => {
    withFixture((root) => {
      expect(generate(root, ["--keysize", "2048"]).status).toBe(0);
      const before = readFileSync(
        join(root, "keys", "private-key.pem"),
        "utf8",
      );
      const again = generate(root, ["--keysize", "2048"]);
      expect(again.status).not.toBe(0);
      expect(again.stderr).toMatch(/拒绝覆盖/);
      // 覆盖掉一把还在用的私钥 = 所有设备再也收不到 OTA
      expect(readFileSync(join(root, "keys", "private-key.pem"), "utf8")).toBe(
        before,
      );
    });
  });

  test("refuses an RSA size the server would reject", () => {
    withFixture((root) => {
      const result = generate(root, ["--keysize", "1024"]);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/2048/);
    });
  });
});

// 这个脚本的意义之一就是能单独拷到运维机上跑——私钥生成在哪台机器，就等于它被
// 保管在哪。回归：第一版把「脚本所在目录的上一级」当成仓库根，拷到 ~/tools/ 之后
// 会把整个 $HOME 当成仓库，拒绝一切输出目录，等于在仓库外完全不可用。
maybe("portability", () => {
  test("still works when the script is copied out of the repository", () => {
    withFixture((root) => {
      const elsewhere = join(root, "opsbox");
      mkdirSync(elsewhere, { recursive: true });
      const copied = join(elsewhere, "generate-ota-signing-key.sh");
      writeFileSync(copied, readFileSync(script, "utf8"));

      const result = spawnSync(
        "bash",
        [
          copied,
          "--tenant",
          "anyfun",
          "--common-name",
          "AnyFun OTA",
          "--out",
          join(elsewhere, "keys"),
          "--keysize",
          "2048",
          "--yes",
        ],
        { encoding: "utf8" },
      );
      expect(result.stderr).not.toMatch(/不能在仓库内/);
      expect(result.status).toBe(0);
      expect(existsSync(join(elsewhere, "keys", "certificate.pem"))).toBe(true);
    });
  });
});
