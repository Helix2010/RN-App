/* global describe, it, expect */

const { removeJitpack } = require("./with-pinned-maven-repositories");

// jitpack 按 GitHub 坐标现编现发，内容可以随作者的仓库变化，而它排在 google() 与
// mavenCentral() 之后——任何解析不到的坐标都会落到它身上。
describe("removeJitpack", () => {
  const gradle = `allprojects {
  repositories {
    google()
    mavenCentral()
    maven { url 'https://www.jitpack.io' }
  }
}
`;

  it("drops the repository and leaves the trusted ones alone", () => {
    const result = removeJitpack(gradle);
    expect(result).not.toMatch(/jitpack/);
    expect(result).toMatch(/google\(\)/);
    expect(result).toMatch(/mavenCentral\(\)/);
  });

  it("matches the spellings the template actually uses", () => {
    for (const line of [
      `    maven { url 'https://www.jitpack.io' }`,
      `    maven { url "https://jitpack.io" }`,
      `  maven{url 'https://jitpack.io'}`,
    ]) {
      expect(removeJitpack(`repositories {\n${line}\n}\n`)).not.toMatch(
        /jitpack/,
      );
    }
  });

  it("is a no-op when the repository is already gone", () => {
    const without = "repositories {\n  google()\n}\n";
    expect(removeJitpack(without)).toBe(without);
  });
});
