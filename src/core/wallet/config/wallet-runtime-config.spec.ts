import {
  applyDeliveredWalletConfig,
  explorerAddressUrl,
  isWalletConnectConfigured,
  onWalletConfigChange,
  resetDeliveredWalletConfig,
  rpcUrlsFor,
  walletConnectProjectId,
  walletNetworks,
} from "./wallet-runtime-config";

const ADDRESS = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";

describe("wallet runtime config", () => {
  beforeEach(() => resetDeliveredWalletConfig());

  it("reports WalletConnect unavailable until the server delivers a project id", () => {
    expect(isWalletConnectConfigured()).toBe(false);
    expect(walletConnectProjectId()).toBeNull();

    applyDeliveredWalletConfig({
      walletConnectProjectId: "  abc  ",
      chains: ["bsc"],
    });
    expect(walletConnectProjectId()).toBe("abc");
    expect(isWalletConnectConfigured()).toBe(true);

    // 空字符串等于没配，不能算可用
    applyDeliveredWalletConfig({ walletConnectProjectId: "", chains: ["bsc"] });
    expect(isWalletConnectConfigured()).toBe(false);
  });

  it("falls back to platform chain metadata before anything is delivered", () => {
    expect(walletNetworks().map((network) => network.id)).toEqual([
      "bsc",
      "eth",
      "base",
    ]);
    expect(
      walletNetworks().find((network) => network.id === "base")?.chainId,
    ).toBe(8453);
    // 没下发 RPC 时必须是空的：不该猜端点
    expect(rpcUrlsFor("bsc")).toEqual([]);
    expect(explorerAddressUrl("eth", ADDRESS)).toBe(
      `https://etherscan.io/address/${ADDRESS}`,
    );
  });

  it("uses the delivered endpoints", () => {
    applyDeliveredWalletConfig({
      walletConnectProjectId: "pid",
      networks: [
        {
          id: "bsc",
          chainId: 56,
          rpcUrls: ["https://rpc.tenant.example/bsc"],
          explorerUrl: "https://explorer.tenant.example",
          testnet: false,
        },
      ],
    });
    expect(walletNetworks().map((network) => network.id)).toEqual(["bsc"]);
    expect(rpcUrlsFor("bsc")).toEqual(["https://rpc.tenant.example/bsc"]);
    expect(explorerAddressUrl("bsc", ADDRESS)).toBe(
      `https://explorer.tenant.example/address/${ADDRESS}`,
    );
  });

  it("derives networks from chains when an older server omits them", () => {
    applyDeliveredWalletConfig({
      walletConnectProjectId: "pid",
      chains: ["eth", "base"],
    });
    expect(walletNetworks().map((network) => network.id)).toEqual([
      "eth",
      "base",
    ]);
    expect(walletNetworks().find((network) => network.id === "eth")).toEqual({
      id: "eth",
      chainId: 1,
      rpcUrls: [],
      explorerUrl: "https://etherscan.io",
      testnet: false,
    });
  });

  it("keeps the testnet flag for a delivered test chain", () => {
    applyDeliveredWalletConfig({
      walletConnectProjectId: "pid",
      chains: ["bsc", "op-sepolia"],
    });

    expect(walletNetworks().find((n) => n.id === "op-sepolia")).toEqual({
      id: "op-sepolia",
      chainId: 11155420,
      rpcUrls: [],
      explorerUrl: "https://sepolia-optimism.etherscan.io",
      // 老服务端不下发 testnet 时，客户端也要认得出这是测试链
      testnet: true,
    });
    expect(walletNetworks().find((n) => n.id === "bsc")?.testnet).toBe(false);
  });

  it("notifies subscribers only when something actually changed", () => {
    const listener = jest.fn();
    const unsubscribe = onWalletConfigChange(listener);
    applyDeliveredWalletConfig({
      walletConnectProjectId: "pid",
      chains: ["bsc"],
    });
    expect(listener).toHaveBeenCalledTimes(1);

    applyDeliveredWalletConfig({
      walletConnectProjectId: "pid",
      chains: ["bsc"],
    });
    expect(listener).toHaveBeenCalledTimes(1);

    applyDeliveredWalletConfig({
      walletConnectProjectId: "other",
      chains: ["bsc"],
    });
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    applyDeliveredWalletConfig({
      walletConnectProjectId: "third",
      chains: ["bsc"],
    });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("keeps an unknown chain usable with platform defaults", () => {
    applyDeliveredWalletConfig({
      walletConnectProjectId: "pid",
      networks: [
        {
          id: "bsc",
          chainId: 56,
          rpcUrls: [],
          explorerUrl: "https://bscscan.com",
          testnet: false,
        },
      ],
    });
    // base 没在下发列表里，仍要能拿到可用的展示地址而不是崩掉
    expect(explorerAddressUrl("base", ADDRESS)).toBe(
      `https://basescan.org/address/${ADDRESS}`,
    );
  });
});
