import {
  onchainSendsEnabled,
  applyDeliveredWalletConfig,
  deliveredTokens,
  explorerAddressUrl,
  isWalletConnectConfigured,
  nativeDisplayDecimals,
  onWalletConfigChange,
  resetDeliveredWalletConfig,
  rpcUrlsFor,
  walletConnectProjectId,
  walletNetworks,
  type DeliveredToken,
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

describe("onchainSendsEnabled", () => {
  it("is off until the server delivers an explicit opt-in", () => {
    expect(onchainSendsEnabled()).toBe(false);
    applyDeliveredWalletConfig({ walletConnectProjectId: "p" });
    expect(onchainSendsEnabled()).toBe(false);
    applyDeliveredWalletConfig({
      walletConnectProjectId: "p",
      onchainSends: true,
    });
    expect(onchainSendsEnabled()).toBe(true);
  });
});

describe("delivered token catalogue", () => {
  const USDT = "0x55d398326f99059fF775485246999027B3197955";
  const usdt: DeliveredToken = {
    chain: "bsc",
    address: USDT,
    symbol: "USDT",
    name: "Tether USD",
    decimals: 18,
    displayDecimals: 2,
    logoColor: "#26A17B",
  };
  const deliver = (tokens: DeliveredToken[]) =>
    applyDeliveredWalletConfig({ walletConnectProjectId: "p", tokens });

  beforeEach(() => resetDeliveredWalletConfig());

  it("is empty until the server delivers one", () => {
    expect(deliveredTokens("bsc")).toEqual([]);
    applyDeliveredWalletConfig({ walletConnectProjectId: "p" });
    expect(deliveredTokens("bsc")).toEqual([]);
    // 原生币的展示精度有平台兜底：手续费显示不能没有位数
    expect(nativeDisplayDecimals("bsc")).toBe(4);
  });

  it("keeps entries per chain and reads the native display precision from the catalogue", () => {
    deliver([
      {
        chain: "bsc",
        address: "native",
        symbol: "BNB",
        name: "BNB",
        decimals: 18,
        displayDecimals: 6,
        logoColor: "#F0B90B",
      },
      usdt,
      {
        chain: "eth",
        address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        symbol: "USDC",
        name: "USD Coin",
        decimals: 6,
        displayDecimals: 2,
        logoColor: "#2775CA",
      },
    ]);

    expect(deliveredTokens("bsc").map((token) => token.symbol)).toEqual([
      "BNB",
      "USDT",
    ]);
    expect(deliveredTokens("eth").map((token) => token.symbol)).toEqual([
      "USDC",
    ]);
    expect(nativeDisplayDecimals("bsc")).toBe(6);
    expect(nativeDisplayDecimals("eth")).toBe(4);
  });

  it("clamps a display precision that exceeds the on-chain precision", () => {
    // 超过链上精度的位数是不存在的数字；截掉比拒绝整条更合适
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    deliver([{ ...usdt, decimals: 6, displayDecimals: 8 }]);

    expect(deliveredTokens("bsc")[0]?.displayDecimals).toBe(6);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("drops an entry whose address is neither native nor a valid address, and warns", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    deliver([
      // 大小写混合但校验和不对：几乎总是抄错了一个字符
      { ...usdt, address: "0x55d398326f99059ff775485246999027B3197955" },
      { ...usdt, address: "usdt" },
      usdt,
    ]);

    expect(deliveredTokens("bsc").map((token) => token.address)).toEqual([
      USDT,
    ]);
    // 静默丢弃是最坏的选项
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("keeps the first of duplicate (chain, address) entries regardless of case", () => {
    deliver([
      usdt,
      { ...usdt, address: USDT.toLowerCase(), displayDecimals: 4 },
    ]);

    expect(deliveredTokens("bsc")).toHaveLength(1);
    expect(deliveredTokens("bsc")[0]?.displayDecimals).toBe(2);
  });

  it("fills an empty logo colour with the chain colour", () => {
    // 它直接落到 backgroundColor 上，空串没有意义
    deliver([{ ...usdt, logoColor: "" }]);
    expect(deliveredTokens("bsc")[0]?.logoColor).toBe("#F0B90B");
  });

  it("notifies subscribers when only the catalogue changed", () => {
    const listener = jest.fn();
    const unsubscribe = onWalletConfigChange(listener);
    deliver([usdt]);
    expect(listener).toHaveBeenCalledTimes(1);
    deliver([usdt]);
    expect(listener).toHaveBeenCalledTimes(1);
    deliver([{ ...usdt, displayDecimals: 4 }]);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
});
