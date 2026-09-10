/* global describe, it, expect */

const {
  KNOWN_DISTRIBUTIONS,
  pinDistributionChecksum,
} = require("./with-gradle-distribution-checksum");

const PROPERTIES = `distributionBase=GRADLE_USER_HOME
distributionPath=wrapper/dists
distributionUrl=https\\://services.gradle.org/distributions/gradle-9.3.1-bin.zip
networkTimeout=10000
validateDistributionUrl=true
`;

describe("gradle distribution checksum plugin", () => {
  it("pins the known checksum next to distributionUrl", () => {
    const result = pinDistributionChecksum(PROPERTIES);
    const expected =
      KNOWN_DISTRIBUTIONS[
        "https://services.gradle.org/distributions/gradle-9.3.1-bin.zip"
      ];
    expect(result).toContain(`distributionSha256Sum=${expected}`);
    expect(result.indexOf("distributionSha256Sum")).toBeGreaterThan(
      result.indexOf("distributionUrl"),
    );
  });

  it("is idempotent and replaces a stale checksum", () => {
    const once = pinDistributionChecksum(PROPERTIES);
    expect(pinDistributionChecksum(once)).toBe(once);
    const stale = once.replace(
      /distributionSha256Sum=.*/,
      "distributionSha256Sum=deadbeef",
    );
    expect(pinDistributionChecksum(stale)).toBe(once);
  });

  it("fails on an unknown distribution instead of guessing", () => {
    expect(() =>
      pinDistributionChecksum(
        PROPERTIES.replace("gradle-9.3.1-bin.zip", "gradle-9.9.9-bin.zip"),
      ),
    ).toThrow(/No pinned checksum/);
  });
});
