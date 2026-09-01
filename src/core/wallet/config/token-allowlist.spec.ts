import {
  allowlistedAddresses,
  trustedTokens,
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

describe("trustedTokens", () => {
  function balance(overrides: {
    address: string;
    symbol: string;
    decimals: number;
    verified: boolean;
  }) {
    return {
      token: {
        chain: "bsc" as const,
        address: overrides.address,
        symbol: overrides.symbol,
        name: overrides.symbol,
        decimals: overrides.decimals,
        logoColor: "#26A17B",
        verified: overrides.verified,
      },
      amount: {
        raw: "1",
        decimals: overrides.decimals,
        symbol: overrides.symbol,
      },
      usdValue: 1,
      change24hPct: 0,
    };
  }

  it("never lets a delivered verified flag stand on its own", () => {
    // 服务端被攻破时它可以把攻击者的合约标成"已验证"
    const [token] = trustedTokens([
      balance({
        address: "0x000000000000000000000000000000000000beef",
        symbol: "USDT",
        decimals: 18,
        verified: true,
      }),
    ]);

    expect(token?.token.verified).toBe(false);
  });

  it("grants verified only from its own table", () => {
    const [token] = trustedTokens([
      balance({
        address: "0x55d398326f99059ff775485246999027b3197955",
        symbol: "USDT",
        decimals: 18,
        verified: false,
      }),
    ]);

    expect(token?.token.verified).toBe(true);
  });

  it("drops a known contract whose decimals were changed", () => {
    // decimals 错会让显示金额差 10ⁿ 倍；显示一个错的数字比不显示更危险
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const result = trustedTokens([
      balance({
        address: "0x55d398326f99059ff775485246999027b3197955",
        symbol: "USDT",
        decimals: 6,
        verified: false,
      }),
    ]);

    expect(result).toHaveLength(0);
    // 静默丢弃是最坏的选项
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("keeps the native coin, which has no contract to vouch for", () => {
    const [token] = trustedTokens([
      balance({
        address: "native",
        symbol: "BNB",
        decimals: 18,
        verified: false,
      }),
    ]);

    expect(token?.token.verified).toBe(true);
  });
});
