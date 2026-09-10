const { withDangerousMod } = require("expo/config-plugins");
const { readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

/**
 * Gradle wrapper 分发包校验和（安全评审 N28）。模板生成的 gradle-wrapper.properties
 * 只有 distributionUrl，没有 distributionSha256Sum，wrapper 下载到什么就跑什么。
 * 这里按 URL 固定校验和；模板换 Gradle 版本时必须先到 services.gradle.org 核对新值再加进表，
 * 否则 prebuild 失败——不猜、不放行。
 */
const KNOWN_DISTRIBUTIONS = {
  // https://services.gradle.org/distributions/gradle-9.3.1-bin.zip.sha256（2026-09-10 核对）
  "https://services.gradle.org/distributions/gradle-9.3.1-bin.zip":
    "b266d5ff6b90eada6dc3b20cb090e3731302e553a27c5d3e4df1f0d76beaff06",
};

function pinDistributionChecksum(contents) {
  const match = /^distributionUrl=(.+)$/m.exec(contents);
  if (!match)
    throw new Error("gradle-wrapper.properties has no distributionUrl");
  // .properties 里的冒号是转义的：https\://
  const url = match[1].replace(/\\:/g, ":").trim();
  const sha256 = KNOWN_DISTRIBUTIONS[url];
  if (!sha256)
    throw new Error(
      `No pinned checksum for Gradle distribution ${url}; verify it against services.gradle.org and add it to plugins/with-gradle-distribution-checksum.js`,
    );
  const line = `distributionSha256Sum=${sha256}`;
  if (/^distributionSha256Sum=.*$/m.test(contents))
    return contents.replace(/^distributionSha256Sum=.*$/m, line);
  return contents.replace(
    /^distributionUrl=.*$/m,
    (found) => `${found}\n${line}`,
  );
}

function withGradleDistributionChecksum(config) {
  return withDangerousMod(config, [
    "android",
    (result) => {
      const file = join(
        result.modRequest.platformProjectRoot,
        "gradle/wrapper/gradle-wrapper.properties",
      );
      writeFileSync(file, pinDistributionChecksum(readFileSync(file, "utf8")));
      return result;
    },
  ]);
}

module.exports = withGradleDistributionChecksum;
module.exports.pinDistributionChecksum = pinDistributionChecksum;
module.exports.KNOWN_DISTRIBUTIONS = KNOWN_DISTRIBUTIONS;
