import {
  allowlistedAddresses,
  verifyAgainstAllowlist,
} from "./token-allowlist";

const USDT_BSC = "0x55d398326f99059ff775485246999027b3197955";
const USDT_ETH = "0xdAC17F958D2ee523a2206206994597C13D831ec7";

describe("verifyAgainstAllowlist", () => {
  it("endorses a known contract with matching metadata", () => {
    expect(
      verifyAgainstAllowlist({
        chain: "bsc",
        address: USDT_BSC,
        symbol: "USDT",
        decimals: 18,
      }),
    ).toEqual({ status: "verified" });
  });

  it("matches regardless of address casing", () => {
    // 交易所常给全小写地址，链上校验和形式又是混合大小写
    expect(
      verifyAgainstAllowlist({
        chain: "bsc",
        address: USDT_BSC.toUpperCase().replace("0X", "0x"),
        symbol: "USDT",
        decimals: 18,
      }),
    ).toEqual({ status: "verified" });
  });

  it("rejects a listed contract whose decimals do not match", () => {
    // 同一个 USDT 在 BSC 上是 18 位、以太坊上是 6 位。填错差 10^12 倍，
    // 所以这不是"降级为未验证"，而是必须拒绝
    const verdict = verifyAgainstAllowlist({
      chain: "bsc",
      address: USDT_BSC,
      symbol: "USDT",
      decimals: 6,
    });

    expect(verdict.status).toBe("mismatch");
    expect(verdict).toMatchObject({ expected: { decimals: 18 } });
  });

  it("rejects a listed address carrying someone else's symbol", () => {
    expect(
      verifyAgainstAllowlist({
        chain: "bsc",
        address: USDT_BSC,
        symbol: "USDC",
        decimals: 18,
      }),
    ).toMatchObject({ status: "mismatch" });
  });

  it("treats an unknown contract as unlisted rather than rejected", () => {
    // 租户自己的项目币是正常情况：按未验证展示，不是拒绝
    expect(
      verifyAgainstAllowlist({
        chain: "bsc",
        address: "0x1111111111111111111111111111111111111111",
        symbol: "MYCOIN",
        decimals: 18,
      }),
    ).toEqual({ status: "unlisted" });
  });

  it("does not carry an endorsement across chains", () => {
    // 以太坊的 USDT 地址在 BSC 上不是 USDT
    expect(
      verifyAgainstAllowlist({
        chain: "bsc",
        address: USDT_ETH,
        symbol: "USDT",
        decimals: 6,
      }),
    ).toEqual({ status: "unlisted" });
  });

  it("endorses the native token, which has no contract to check", () => {
    expect(
      verifyAgainstAllowlist({
        chain: "base",
        address: "native",
        symbol: "ETH",
        decimals: 18,
      }),
    ).toEqual({ status: "verified" });
  });

  it("endorses nothing on a test chain", () => {
    // 测试链上的代币没有价值，不该有"已验证"背书
    expect(allowlistedAddresses("op-sepolia")).toEqual([]);
    expect(
      verifyAgainstAllowlist({
        chain: "op-sepolia",
        address: USDT_BSC,
        symbol: "USDT",
        decimals: 18,
      }),
    ).toEqual({ status: "unlisted" });
  });

  it("stores every address in lowercase so lookups cannot miss", () => {
    for (const chain of ["bsc", "eth", "base"] as const)
      for (const address of allowlistedAddresses(chain))
        expect(address).toBe(address.toLowerCase());
  });
});
