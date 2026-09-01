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

  it("refuses a chain whose delivered chainId contradicts the protocol", () => {
    // chainId 是 EIP-155 重放保护的输入。被篡改成另一条链的 id，用户签出的
    // 交易就能在那条链上重放——所以宁可丢掉这条链，也不能拿它去签名。
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    applyDeliveredWalletConfig({
      walletConnectProjectId: "pid",
      networks: [
        {
          id: "bsc",
          chainId: 1,
          rpcUrls: ["https://rpc.attacker.example"],
          explorerUrl: "https://bscscan.com",
          testnet: false,
        },
        {
          id: "eth",
          chainId: 1,
          rpcUrls: ["https://ethereum-rpc.publicnode.com"],
          explorerUrl: "https://etherscan.io",
          testnet: false,
        },
      ],
    });

    expect(walletNetworks().map((network) => network.id)).toEqual(["eth"]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
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

describe("delivered rpc endpoints", () => {
  it("drops a cleartext endpoint and keeps the https ones", () => {
    // 明文 RPC 不只泄露地址和余额：中间人还能伪造余额与回执，
    // 让界面显示一笔从未发生的转账已确认
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    applyDeliveredWalletConfig({
      walletConnectProjectId: "p",
      networks: [
        {
          id: "bsc",
          chainId: 56,
          rpcUrls: ["http://cheap.example", "https://good.example"],
          explorerUrl: "https://bscscan.com",
          testnet: false,
        },
      ],
    });

    expect(rpcUrlsFor("bsc")).toEqual(["https://good.example"]);
    // 静默丢弃是最坏的选项
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("leaves a chain with no usable endpoint rather than falling back to a public node", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    applyDeliveredWalletConfig({
      walletConnectProjectId: "p",
      networks: [
        {
          id: "bsc",
          chainId: 56,
          rpcUrls: ["http://cheap.example"],
          explorerUrl: "https://bscscan.com",
          testnet: false,
        },
      ],
    });

    // 空端点是一个已定义的安全状态：那条链的链上功能不可用
    expect(rpcUrlsFor("bsc")).toEqual([]);
    warn.mockRestore();
  });
});
