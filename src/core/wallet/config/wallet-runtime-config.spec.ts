import { tenantNetwork, tenantWallet } from "../../../test/wallet-config";
import {
  ChainNotEnabledError,
  applyDeliveredWalletConfig,
  deliveredTokens,
  enabledChains,
  evmChainIdOf,
  explorerAddressUrl,
  isChainEnabled,
  isTestnetChain,
  isWalletConnectConfigured,
  nativeDisplayDecimals,
  onchainSendsEnabled,
  onWalletConfigChange,
  resetDeliveredWalletConfig,
  rpcUrlsFor,
  walletConnectProjectId,
  walletNetworks,
  type DeliveredToken,
} from "./wallet-runtime-config";

const ADDRESS = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";
const USDT_BSC = "0x55d398326f99059fF775485246999027B3197955";

function native(chain: "bsc" | "eth", displayDecimals = 4): DeliveredToken {
  const symbol = chain === "bsc" ? "BNB" : "ETH";
  return {
    chain,
    address: "native",
    symbol,
    name: symbol,
    decimals: 18,
    displayDecimals,
    logoColor: "#000000",
  };
}

const usdt: DeliveredToken = {
  chain: "bsc",
  address: USDT_BSC,
  symbol: "USDT",
  name: "Tether USD",
  decimals: 18,
  displayDecimals: 2,
  logoColor: "#26A17B",
};

beforeEach(() => resetDeliveredWalletConfig());

describe("wallet runtime config before anything is delivered", () => {
  it("has no chains, no endpoints and no WalletConnect", () => {
    // 没有租户就没有链：不存在"默认三条主网"这种东西
    expect(enabledChains()).toEqual([]);
    expect(walletNetworks()).toEqual([]);
    expect(isChainEnabled("bsc")).toBe(false);
    expect(isWalletConnectConfigured()).toBe(false);
    expect(walletConnectProjectId()).toBeNull();
    expect(onchainSendsEnabled()).toBe(false);
    expect(deliveredTokens("bsc")).toEqual([]);
  });

  it("refuses to answer for a chain that is not enabled", () => {
    // 问一条没启用的链是调用方的 bug，不是要兜住的状态
    expect(() => rpcUrlsFor("bsc")).toThrow(ChainNotEnabledError);
    expect(() => explorerAddressUrl("eth", ADDRESS)).toThrow(
      ChainNotEnabledError,
    );
    expect(() => nativeDisplayDecimals("bsc")).toThrow(/no native entry/);
  });

  it("knows the protocol facts without any delivery", () => {
    // chainId 与"是不是测试链"属于协议，不属于配置
    expect(evmChainIdOf("base")).toBe(8453);
    expect(isTestnetChain("op-sepolia")).toBe(true);
    expect(isTestnetChain("eth")).toBe(false);
  });
});

describe("delivered wallet config", () => {
  it("treats a blank project id as not configured", () => {
    applyDeliveredWalletConfig(
      tenantWallet({ chains: ["bsc"], walletConnectProjectId: "  abc  " }),
    );
    expect(walletConnectProjectId()).toBe("abc");

    applyDeliveredWalletConfig(
      tenantWallet({ chains: ["bsc"], walletConnectProjectId: "" }),
    );
    expect(isWalletConnectConfigured()).toBe(false);
  });

  it("uses exactly the delivered chains, endpoints and explorer", () => {
    applyDeliveredWalletConfig({
      ...tenantWallet({ chains: ["bsc"] }),
      networks: [
        {
          ...tenantNetwork("bsc", ["https://rpc.tenant.example/bsc"]),
          explorerUrl: "https://scan.tenant.example",
        },
      ],
    });

    expect(enabledChains()).toEqual(["bsc"]);
    expect(rpcUrlsFor("bsc")).toEqual(["https://rpc.tenant.example/bsc"]);
    expect(explorerAddressUrl("bsc", ADDRESS)).toBe(
      `https://scan.tenant.example/address/${ADDRESS}`,
    );
    // 没下发的链就是没启用
    expect(isChainEnabled("eth")).toBe(false);
    expect(() => rpcUrlsFor("eth")).toThrow(ChainNotEnabledError);
  });

  it("follows the delivered networks, so a chain the tenant turned off disappears", () => {
    applyDeliveredWalletConfig(tenantWallet({ chains: ["eth", "op-sepolia"] }));

    expect(enabledChains()).toEqual(["eth", "op-sepolia"]);
    expect(isChainEnabled("bsc")).toBe(false);
  });

  it("refuses a chain whose delivered chainId contradicts the protocol", () => {
    // chainId 是重放保护的输入，被篡改就能在另一条链上重放签名
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    applyDeliveredWalletConfig({
      ...tenantWallet({ chains: ["bsc", "eth"] }),
      networks: [{ ...tenantNetwork("bsc"), chainId: 1 }, tenantNetwork("eth")],
    });

    expect(enabledChains()).toEqual(["eth"]);
    expect(() => rpcUrlsFor("bsc")).toThrow(ChainNotEnabledError);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("chainId 1"));
    warn.mockRestore();
  });

  it("refuses a chain whose delivered testnet flag contradicts the protocol", () => {
    // 把测试链标成主网，用户会把测试币当真资产
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    applyDeliveredWalletConfig({
      ...tenantWallet({ chains: ["op-sepolia"] }),
      networks: [{ ...tenantNetwork("op-sepolia"), testnet: false }],
    });

    expect(enabledChains()).toEqual([]);
    warn.mockRestore();
  });

  it("notifies subscribers only when something actually changed", () => {
    const listener = jest.fn();
    onWalletConfigChange(listener);

    applyDeliveredWalletConfig(
      tenantWallet({ chains: ["bsc"], walletConnectProjectId: "a" }),
    );
    applyDeliveredWalletConfig(
      tenantWallet({ chains: ["bsc"], walletConnectProjectId: "a" }),
    );
    expect(listener).toHaveBeenCalledTimes(1);

    applyDeliveredWalletConfig(
      tenantWallet({ chains: ["bsc"], walletConnectProjectId: "b" }),
    );
    expect(listener).toHaveBeenCalledTimes(2);

    applyDeliveredWalletConfig(
      tenantWallet({ chains: ["bsc", "eth"], walletConnectProjectId: "b" }),
    );
    expect(listener).toHaveBeenCalledTimes(3);

    applyDeliveredWalletConfig(
      tenantWallet({
        chains: ["bsc", "eth"],
        walletConnectProjectId: "b",
        onchainSends: true,
      }),
    );
    expect(listener).toHaveBeenCalledTimes(4);
  });
});

describe("delivered rpc endpoints", () => {
  it("drops a cleartext endpoint and keeps the https ones", () => {
    // 明文 RPC 可被中间人伪造余额与回执
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    applyDeliveredWalletConfig(
      tenantWallet({
        chains: ["bsc"],
        rpc: { bsc: ["http://rpc.example", "https://rpc.example"] },
      }),
    );

    expect(rpcUrlsFor("bsc")).toEqual(["https://rpc.example"]);
    warn.mockRestore();
  });

  it("leaves a chain with no usable endpoint rather than guessing a public node", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    applyDeliveredWalletConfig(
      tenantWallet({ chains: ["bsc"], rpc: { bsc: ["http://rpc.example"] } }),
    );

    expect(isChainEnabled("bsc")).toBe(true);
    expect(rpcUrlsFor("bsc")).toEqual([]);
    warn.mockRestore();
  });
});

describe("onchainSendsEnabled", () => {
  it("is exactly the delivered switch", () => {
    applyDeliveredWalletConfig(tenantWallet({ chains: ["bsc"] }));
    expect(onchainSendsEnabled()).toBe(false);
    applyDeliveredWalletConfig(
      tenantWallet({ chains: ["bsc"], onchainSends: true }),
    );
    expect(onchainSendsEnabled()).toBe(true);
  });
});

describe("delivered token catalogue", () => {
  it("keeps entries per chain and reads the native display precision from the catalogue", () => {
    applyDeliveredWalletConfig({
      ...tenantWallet({ chains: ["bsc", "eth"] }),
      tokens: [native("bsc", 3), usdt, native("eth", 5)],
    });

    expect(deliveredTokens("bsc").map((token) => token.symbol)).toEqual([
      "BNB",
      "USDT",
    ]);
    expect(nativeDisplayDecimals("bsc")).toBe(3);
    expect(nativeDisplayDecimals("eth")).toBe(5);
  });

  it("fails loudly when an enabled chain has no native entry", () => {
    // 服务端保证启用的链一定有原生币条目；没有就是数据坏了，不能猜一个位数
    applyDeliveredWalletConfig({
      ...tenantWallet({ chains: ["bsc"] }),
      tokens: [usdt],
    });
    expect(() => nativeDisplayDecimals("bsc")).toThrow(/no native entry/);
  });

  it("rejects an entry whose display precision exceeds the on-chain precision", () => {
    // 服务端写入时就拒绝这种数据；出现在下发里只能是被改坏了——拒绝，不修
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    applyDeliveredWalletConfig(
      tenantWallet({
        chains: ["bsc"],
        tokens: [native("bsc"), { ...usdt, decimals: 6, displayDecimals: 8 }],
      }),
    );

    expect(deliveredTokens("bsc").map((token) => token.symbol)).toEqual([
      "BNB",
    ]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("USDT"));
    warn.mockRestore();
  });

  it("rejects an entry whose address is neither native nor a valid address", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    applyDeliveredWalletConfig(
      tenantWallet({
        chains: ["bsc"],
        tokens: [native("bsc"), { ...usdt, address: "0x1234" }],
      }),
    );

    expect(deliveredTokens("bsc")).toHaveLength(1);
    warn.mockRestore();
  });

  it("rejects a duplicate (chain, address) entry regardless of case", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    applyDeliveredWalletConfig(
      tenantWallet({
        chains: ["bsc"],
        tokens: [
          usdt,
          { ...usdt, address: USDT_BSC.toLowerCase(), displayDecimals: 6 },
        ],
      }),
    );

    const usdts = deliveredTokens("bsc").filter(
      (token) => token.symbol === "USDT",
    );
    expect(usdts).toHaveLength(1);
    expect(usdts[0]?.displayDecimals).toBe(2);
    warn.mockRestore();
  });

  it("stores contract addresses in EIP-55 form, whatever case the server sent", () => {
    applyDeliveredWalletConfig(
      tenantWallet({
        chains: ["bsc"],
        tokens: [{ ...usdt, address: USDT_BSC.toLowerCase() }],
      }),
    );

    expect(
      deliveredTokens("bsc").find((token) => token.symbol === "USDT")?.address,
    ).toBe(USDT_BSC);
  });

  it("does not rebuild the WalletConnect client when only the catalogue changed", () => {
    const listener = jest.fn();
    applyDeliveredWalletConfig(tenantWallet({ chains: ["bsc"] }));
    onWalletConfigChange(listener);

    applyDeliveredWalletConfig(
      tenantWallet({ chains: ["bsc"], tokens: [usdt] }),
    );

    expect(listener).not.toHaveBeenCalled();
  });
});
