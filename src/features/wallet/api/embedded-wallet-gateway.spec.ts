import { tenantWallet } from "../../../test/wallet-config";
import { ChainNotEnabledError } from "../../../core/wallet/config/wallet-runtime-config";
import { verifyMessage } from "ethers";
import { memoryStorage } from "../../../core/gateways/types";
import { deriveAccount } from "../../../core/wallet/keygen/mnemonic";
import { KeystoreVault } from "../../../core/wallet/vault/keystore-vault";
import { memorySecureStore } from "../../../core/wallet/vault/ports";
import { MockWalletGateway } from "./mock-wallet-gateway";
import {
  WalletNotProvisionedError,
  WalletProvisioningUnsupportedError,
} from "./gateway";
import {
  EmbeddedWalletGateway,
  TokenMetadataMismatchError,
  type ExternalWalletConnector,
  type OnchainTransferPort,
} from "./embedded-wallet-gateway";
import type { ChainId } from "../../../core/gateways/types";
import { money } from "../../../core/money/money";
import type { WalletSigner } from "../../../core/wallet/signer/types";
import {
  applyDeliveredWalletConfig,
  resetDeliveredWalletConfig,
  type DeliveredToken,
} from "../../../core/wallet/config/wallet-runtime-config";
import type { SendRequest, TokenBalance } from "../model/wallet";

const snapshot = (items: TokenBalance[]) => ({ items, unavailable: [] });

const PHRASE =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const ADDRESS = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";
const EXTERNAL = "0x3f4A8C21b7d94E0a1F6c5d2e8b9A7c3D4e5F9a2C";

function fakeOnchain(available: ChainId[]) {
  const sent: { request: SendRequest; signer: WalletSigner }[] = [];
  const port: OnchainTransferPort = {
    available: (chain) => available.includes(chain),
    send: async (request, signer) => {
      sent.push({ request, signer });
      return {
        id: "0xonchain",
        kind: "send",
        status: "submitted",
        hash: "0xonchain",
        token: request.token,
        amount: request.amount,
        counterparty: request.to,
        updatedAt: "2026-01-01T00:00:00.000Z",
      };
    },
    quote: async () => ({
      fee: money(21_000n, 18, "BNB"),
      maxAmount: null,
    }),
    getTransaction: async (id) =>
      id === "0xonchain"
        ? {
            id,
            status: "confirmed" as const,
            updatedAt: "2026-01-01T00:00:00.000Z",
          }
        : null,
    listTransfers: () => [],
    nativeBalance: async () => 0n,
    tokenBalances: async () => new Map(),
  };
  return { port, sent };
}

function sendRequest(chain: ChainId): SendRequest {
  return {
    from: ADDRESS,
    to: "0x000000000000000000000000000000000000dEaD",
    token: {
      chain,
      address: "native",
      symbol: "BNB",
      name: "BNB",
      decimals: 18,
      displayDecimals: 4,
      logoColor: "#F0B90B",
      verified: true,
    },
    amount: money(1n, 18, "BNB"),
  };
}

function setup(options?: {
  external?: ExternalWalletConnector;
  onchain?: OnchainTransferPort;
}) {
  const storage = memoryStorage();
  const vault = new KeystoreVault({
    storage: memoryStorage(),
    secureStore: memorySecureStore(),
    authenticate: async () => "success",
  });
  const chainData = new MockWalletGateway(memoryStorage());
  const seeded: string[] = [];
  const gateway = new EmbeddedWalletGateway({
    vault,
    chainData,
    storage,
    external: options?.external,
    onchain: options?.onchain,
    seedDemoBalances: async (address) => {
      seeded.push(address);
    },
  });
  return { gateway, vault, chainData, seeded };
}

/** 界面拿"当前账户"就是这么拿的：listAccounts 里带 current 标记的那一条。 */
async function currentOf(gateway: EmbeddedWalletGateway) {
  const accounts = await gateway.listAccounts();
  return accounts.find((account) => account.current) ?? null;
}

function fakeExternal(): ExternalWalletConnector {
  return {
    connect: jest.fn(async () => ({
      address: EXTERNAL,
      chains: ["bsc" as const],
      label: "kenneth.eth",
    })),
    disconnect: jest.fn(async () => {}),
    restore: jest.fn(async () => [{ address: EXTERNAL }]),
    listConnectors: async () => [
      {
        id: "walletconnect" as const,
        name: "WalletConnect",
        kind: "external" as const,
        configured: true,
        installed: true,
        logoColor: "#3B99FC",
      },
    ],
    signer: jest.fn((address: string) => ({
      address,
      managesOwnFees: true,
      signMessage: async () => "0xexternal",
      signTypedData: async () => "0xexternal",
      submitTransaction: async () => "0xexternal",
    })),
  };
}

/** 网关返回按链分好的快照；大多数用例只关心拿到的余额条目 */
async function balances(
  gateway: EmbeddedWalletGateway,
  address: string,
  chain?: ChainId,
): Promise<TokenBalance[]> {
  return (await gateway.getBalances(address, chain)).items;
}

/** 测试租户：三条主网、演示账本、目录里只有原生币。要别的组合在用例里重新下发。 */
beforeEach(() => applyDeliveredWalletConfig(tenantWallet()));

describe("EmbeddedWalletGateway", () => {
  it("has no accounts and refuses to connect before a wallet is provisioned", async () => {
    const { gateway } = setup();
    expect(await gateway.listAccounts()).toEqual([]);
    expect(await currentOf(gateway)).toBeNull();
    await expect(gateway.connect("embedded")).rejects.toBeInstanceOf(
      WalletNotProvisionedError,
    );
  });

  it("creates a wallet, selects it, and reports it as not backed up", async () => {
    const { gateway, seeded } = setup();
    const { account, mnemonic } = await gateway.createWallet();
    expect(mnemonic.split(" ")).toHaveLength(12);
    expect(account).toMatchObject({
      connector: "embedded",
      current: true,
      backedUp: false,
    });
    expect(account.address).toBe(deriveAccount(mnemonic, 0).address);
    expect(seeded).toEqual([account.address]);

    await gateway.markBackedUp(account.address);
    expect((await currentOf(gateway))?.backedUp).toBe(true);
  });

  it("imports a mnemonic and signs a message that recovers to that address", async () => {
    const { gateway } = setup();
    const account = await gateway.importMnemonic(PHRASE);
    expect(account.address).toBe(ADDRESS);

    const message = "sign in to example.com";
    const signature = await gateway.signMessage(ADDRESS, message);
    expect(verifyMessage(message, signature)).toBe(ADDRESS);
  });

  it("imports a private key and can reconnect to it later", async () => {
    const { gateway } = setup();
    const key = deriveAccount(PHRASE, 5).privateKey;
    const account = await gateway.importPrivateKey(key);
    expect(account.current).toBe(true);
    // 私钥导入的账户没有助记词可导出
    await expect(
      gateway.revealMnemonic(account.address, "reveal"),
    ).rejects.toThrow("without a mnemonic");

    const reconnected = await gateway.connect("embedded");
    expect(reconnected.address).toBe(account.address);
  });

  it("passes the caller's reason through to the signer", async () => {
    const { gateway, vault } = setup();
    await gateway.importMnemonic(PHRASE);
    const spy = jest.spyOn(vault, "withPrivateKey");
    await gateway.signMessage(ADDRESS, "hi", { reason: "确认登录" });
    expect(spy).toHaveBeenCalledWith(ADDRESS, "确认登录", expect.any(Function));
  });

  it("keeps keys when an embedded account is disconnected", async () => {
    const { gateway, vault } = setup();
    const { account } = await gateway.createWallet();
    await gateway.disconnect(account.address);
    // 断开只是取消选中；密钥仍在 Vault 里，否则用户资产就没了
    expect(await vault.has(account.address)).toBe(true);
    expect(await gateway.listAccounts()).toHaveLength(1);
    expect(await currentOf(gateway)).toBeNull();
  });

  it("switches between several wallets and remembers the choice", async () => {
    const { gateway } = setup();
    const first = await gateway.importMnemonic(PHRASE, 0);
    const second = await gateway.importMnemonic(PHRASE, 1);
    expect(second.current).toBe(true);

    const switched = await gateway.switchAccount(first.address);
    expect(switched.current).toBe(true);
    const accounts = await gateway.listAccounts();
    expect(accounts).toHaveLength(2);
    expect(accounts.filter((item) => item.current)).toHaveLength(1);
    expect((await currentOf(gateway))?.address).toBe(first.address);
  });

  it("reveals the mnemonic of a created wallet", async () => {
    const { gateway } = setup();
    const { account, mnemonic } = await gateway.createWallet();
    await expect(
      gateway.revealMnemonic(account.address, "reveal"),
    ).resolves.toBe(mnemonic);
  });

  it("renames accounts and keeps labels across reads", async () => {
    const { gateway } = setup();
    const { account } = await gateway.createWallet();
    await gateway.rename(account.address, "日常钱包");
    expect((await currentOf(gateway))?.label).toBe("日常钱包");
  });

  it("keeps the built-in wallet in the connector list alongside external ones", async () => {
    const external = fakeExternal();
    const { gateway } = setup({ external });
    const connectors = await gateway.listConnectors();
    // 外部连接器只负责外部钱包，不能把内置钱包项吞掉
    expect(connectors.filter((item) => item.kind === "embedded")).toHaveLength(
      1,
    );
    expect(
      connectors.filter((item) => item.kind === "external").length,
    ).toBeGreaterThan(0);
  });

  it("marks external connectors unavailable when no connector is wired", async () => {
    const { gateway } = setup();
    const connectors = await gateway.listConnectors();
    expect(connectors.filter((item) => item.kind === "embedded")).toHaveLength(
      1,
    );
    expect(connectors.filter((item) => item.kind === "external")).not.toEqual(
      [],
    );
    for (const connector of connectors)
      if (connector.kind === "external")
        expect(connector.installed).toBe(false);
    await expect(gateway.connect("metamask")).rejects.toBeInstanceOf(
      WalletProvisioningUnsupportedError,
    );
  });

  it("connects an external wallet and routes signing to it", async () => {
    const external = fakeExternal();
    const { gateway, vault } = setup({ external });
    const account = await gateway.connect("walletconnect");
    expect(account).toMatchObject({
      address: EXTERNAL,
      label: "kenneth.eth",
      connector: "walletconnect",
      current: true,
      backedUp: true,
    });
    expect(await vault.has(EXTERNAL)).toBe(false);
    await expect(gateway.signMessage(EXTERNAL, "hi")).resolves.toBe(
      "0xexternal",
    );
    expect(external.signer).toHaveBeenCalledWith(EXTERNAL);
  });

  it("forgets an external wallet on disconnect", async () => {
    const external = fakeExternal();
    const { gateway } = setup({ external });
    await gateway.connect("walletconnect");
    await gateway.disconnect(EXTERNAL);
    expect(external.disconnect).toHaveBeenCalledWith(EXTERNAL);
    expect(await gateway.listAccounts()).toHaveLength(0);
  });

  it("lists embedded and external accounts side by side", async () => {
    const external = fakeExternal();
    const { gateway } = setup({ external });
    await gateway.importMnemonic(PHRASE);
    await gateway.connect("walletconnect");
    const accounts = await gateway.listAccounts();
    expect(accounts.map((item) => item.connector).sort()).toEqual([
      "embedded",
      "walletconnect",
    ]);
    expect(accounts.filter((item) => item.current)).toHaveLength(1);
  });

  it("restores a cold-started external session instead of failing to sign", async () => {
    const external = fakeExternal();
    // 模拟冷启动：registry 里还有外部账户，但连接器内存里没有连接
    let connected = false;
    external.signer = jest.fn((address: string) => {
      if (!connected) throw new Error("wallet is not connected");
      return {
        address,
        managesOwnFees: true,
        signMessage: async () => "0xrestored",
        signTypedData: async () => "0xrestored",
        submitTransaction: async () => "0xrestored",
      };
    });
    external.restore = jest.fn(async () => {
      connected = true;
      return [{ address: EXTERNAL }];
    });
    const { gateway } = setup({ external });
    await gateway.connect("walletconnect");

    await expect(gateway.signMessage(EXTERNAL, "hi")).resolves.toBe(
      "0xrestored",
    );
    expect(external.restore).toHaveBeenCalled();
  });

  it("refuses to sign for an account it does not know", async () => {
    const { gateway } = setup();
    await expect(gateway.signMessage(EXTERNAL, "hi")).rejects.toThrow(
      "no signer is available",
    );
  });

  it("delegates chain data to the injected source", async () => {
    const { gateway, chainData } = setup();
    const spy = jest.spyOn(chainData, "getBalances");
    const { account } = await gateway.createWallet();
    await balances(gateway, account.address);
    expect(spy).toHaveBeenCalledWith(account.address, undefined);
  });
});

describe("EmbeddedWalletGateway on-chain routing", () => {
  it("sends on-chain for a chain that has endpoints, with a signer for that account", async () => {
    const { port, sent } = fakeOnchain(["bsc"]);
    const { gateway, chainData } = setup({ onchain: port });
    const ledger = jest.spyOn(chainData, "send");
    const { account } = await gateway.createWallet();

    const record = await gateway.send({
      ...sendRequest("bsc"),
      from: account.address,
    });

    expect(record.hash).toBe("0xonchain");
    // 签名器必须是这个账户的：拿错账户签出来的交易发不出去
    expect(sent[0]?.signer.address.toLowerCase()).toBe(
      account.address.toLowerCase(),
    );
    expect(ledger).not.toHaveBeenCalled();
  });

  it("falls back to the mock ledger for a chain with no endpoints", async () => {
    // 不猜端点，也不让用户以为转了真钱
    const { port, sent } = fakeOnchain(["bsc"]);
    const { gateway, chainData } = setup({ onchain: port });
    const ledger = jest.spyOn(chainData, "send");
    const { account } = await gateway.createWallet();

    // Mock 账本里这个新账户没有 ETH，会拒绝——这正好说明这笔走的是账本
    await gateway
      .send({ ...sendRequest("eth"), from: account.address })
      .catch(() => undefined);

    expect(sent).toHaveLength(0);
    expect(ledger).toHaveBeenCalled();
  });

  it("asks the chain about a hash it submitted, and the ledger about everything else", async () => {
    const { port } = fakeOnchain(["bsc"]);
    const { gateway, chainData } = setup({ onchain: port });
    const ledger = jest.spyOn(chainData, "getTransaction");

    expect((await gateway.getTransaction("0xonchain"))?.status).toBe(
      "confirmed",
    );
    expect(ledger).not.toHaveBeenCalled();

    await gateway.getTransaction("tx_1");
    expect(ledger).toHaveBeenCalledWith("tx_1");
  });

  it("tells the UI which chains really send on-chain", () => {
    const { port } = fakeOnchain(["bsc"]);
    const { gateway } = setup({ onchain: port });
    expect(gateway.sendsOnchain("bsc")).toBe(true);
    expect(gateway.sendsOnchain("eth")).toBe(false);
    expect(setup().gateway.sendsOnchain("bsc")).toBe(false);
  });

  it("quotes a fee only for chains that are actually on-chain", async () => {
    const { port } = fakeOnchain(["bsc"]);
    const { gateway } = setup({ onchain: port });

    expect(await gateway.quoteTransfer(sendRequest("bsc"))).not.toBeNull();
    // Mock 账本给不出手续费，如实返回 null，界面显示"暂不可估"
    expect(await gateway.quoteTransfer(sendRequest("eth"))).toBeNull();
  });

  it("merges on-chain sends into the history the ledger does not know about", async () => {
    const { port } = fakeOnchain(["bsc"]);
    const onchainRecord = {
      id: "0xonchain",
      kind: "send" as const,
      status: "submitted" as const,
      hash: "0xonchain",
      token: sendRequest("bsc").token,
      amount: money(1n, 18, "BNB"),
      counterparty: "0x000000000000000000000000000000000000dEaD",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    port.listTransfers = () => [onchainRecord];
    const { gateway } = setup({ onchain: port });
    const { account } = await gateway.createWallet();

    // 不合并的话，用户转完账回到列表会以为这笔没发生
    expect(await gateway.listTransfers(account.address)).toContainEqual(
      onchainRecord,
    );
  });

  it("keeps using the mock ledger when no on-chain port is wired at all", async () => {
    const { gateway } = setup();
    const { account } = await gateway.createWallet();
    await expect(gateway.quoteTransfer(sendRequest("bsc"))).resolves.toBeNull();
    expect(await gateway.listTransfers(account.address)).toEqual([]);
  });
});

describe("EmbeddedWalletGateway token trust", () => {
  const FAKE_USDT = "0x000000000000000000000000000000000000beef";
  const REAL_USDT = "0x55d398326f99059ff775485246999027b3197955";

  it("strips a verified flag the chain data claimed for an unknown contract", async () => {
    const { gateway, chainData } = setup();
    jest.spyOn(chainData, "getBalances").mockResolvedValue(
      snapshot([
        {
          token: {
            chain: "bsc",
            address: FAKE_USDT,
            symbol: "USDT",
            name: "USDT",
            decimals: 18,
            displayDecimals: 2,
            logoColor: "#26A17B",
            verified: true,
          },
          amount: money(1n, 18, "USDT"),
          usdValue: 1,
          change24hPct: 0,
        },
      ]),
    );

    const [held] = await balances(gateway, ADDRESS);

    // 下发的 verified 一律不采纳，只有客户端那份表能授予
    expect(held?.token.verified).toBe(false);
  });

  it("refuses to send a token whose decimals contradict the known contract", async () => {
    // 金额会差 10ⁿ 倍，必须挡在签名之前
    const { port } = fakeOnchain(["bsc"]);
    const { gateway } = setup({ onchain: port });
    const { account } = await gateway.createWallet();

    await expect(
      gateway.send({
        ...sendRequest("bsc"),
        from: account.address,
        token: {
          chain: "bsc",
          address: REAL_USDT,
          symbol: "USDT",
          name: "USDT",
          decimals: 6,
          displayDecimals: 2,
          logoColor: "#26A17B",
          verified: true,
        },
      }),
    ).rejects.toBeInstanceOf(TokenMetadataMismatchError);
  });
});

describe("EmbeddedWalletGateway native balances", () => {
  afterEach(() => resetDeliveredWalletConfig());

  it("replaces the demo native balance with the chain's answer where sends are real", async () => {
    // 转出扣的是真钱，余额却停在演示数字上，用户会以为钱没转出去
    const { port } = fakeOnchain(["bsc"]);
    port.nativeBalance = async () => 5n * 10n ** 17n; // 0.5 BNB
    const { gateway, chainData } = setup({ onchain: port });
    jest.spyOn(chainData, "getBalances").mockResolvedValue(
      snapshot([
        {
          token: { ...sendRequest("bsc").token },
          amount: money(2n * 10n ** 18n, 18, "BNB"),
          usdValue: 1_200,
          change24hPct: 0,
        },
      ]),
    );

    const [bnb] = await balances(gateway, ADDRESS, "bsc");

    expect(bnb?.amount.raw).toBe((5n * 10n ** 17n).toString());
    // 单价沿用账本隐含的 600：金额是真的，单价是演示的，比两者都假强
    expect(bnb?.usdValue).toBeCloseTo(300);
  });

  it("leaves chains without endpoints on the demo ledger", async () => {
    const { port } = fakeOnchain(["bsc"]);
    port.nativeBalance = jest.fn(async () => 1n);
    const { gateway, chainData } = setup({ onchain: port });
    jest.spyOn(chainData, "getBalances").mockResolvedValue(
      snapshot([
        {
          token: { ...sendRequest("eth").token, symbol: "ETH", chain: "eth" },
          amount: money(3n, 18, "ETH"),
          usdValue: 0,
          change24hPct: 0,
        },
      ]),
    );

    const [eth] = await balances(gateway, ADDRESS, "eth");

    expect(eth?.amount.raw).toBe("3");
    expect(port.nativeBalance).not.toHaveBeenCalled();
  });

  it("adds a native entry for a real chain the demo ledger knows nothing about", async () => {
    // 测试链默认不在启用列表里（回落值是三条主网），要像租户那样显式启用
    applyDeliveredWalletConfig(tenantWallet({ chains: ["bsc", "op-sepolia"] }));
    // 测试链在演示账本里没有条目；没有这一条，真链能力在发送页根本不可达
    const { port } = fakeOnchain(["op-sepolia"]);
    port.nativeBalance = async () => 10n ** 18n;
    const { gateway, chainData } = setup({ onchain: port });
    jest.spyOn(chainData, "getBalances").mockResolvedValue(snapshot([]));

    const list = await balances(gateway, ADDRESS, "op-sepolia");

    expect(list).toHaveLength(1);
    expect(list[0]?.token).toMatchObject({
      chain: "op-sepolia",
      address: "native",
      symbol: "ETH",
    });
    // 测试链的币没有价值
    expect(list[0]?.usdValue).toBe(0);
  });

  it("fails loudly when the node cannot be reached, instead of showing the demo figure", async () => {
    // 这里没有"上一次的值"——账本里那个 7 是演示数字。抛错让 React Query 保留
    // 缓存里上一次真实的链上数据；成功返回演示数字会把它覆盖掉
    const { port } = fakeOnchain(["bsc"]);
    port.nativeBalance = async () => {
      throw new Error("node down");
    };
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const { gateway, chainData } = setup({ onchain: port });
    jest.spyOn(chainData, "getBalances").mockResolvedValue(
      snapshot([
        {
          token: { ...sendRequest("bsc").token },
          amount: money(7n, 18, "BNB"),
          usdValue: 0,
          change24hPct: 0,
        },
      ]),
    );

    // 这条链进 unavailable，而不是整批抛错让别的链也没了余额
    const result = await gateway.getBalances(ADDRESS, "bsc");
    expect(result.items).toEqual([]);
    expect(result.unavailable).toEqual([{ chain: "bsc", reason: "node" }]);
    warn.mockRestore();
  });
});

describe("EmbeddedWalletGateway token balances", () => {
  const USDT_BSC = "0x55d398326f99059fF775485246999027B3197955";
  const PEPE_BSC = "0x25d887ce7a35172c62febfd67a1856f20faebb00";
  const UNI_ETH = "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984";
  const usdtDelivered: DeliveredToken = {
    chain: "bsc",
    address: USDT_BSC,
    symbol: "USDT",
    name: "Tether USD",
    decimals: 18,
    displayDecimals: 2,
    logoColor: "#26A17B",
  };

  function deliver(tokens: DeliveredToken[]) {
    applyDeliveredWalletConfig(
      tenantWallet({ chains: ["bsc", "eth"], tokens }),
    );
  }

  /** 演示账本里的一条：地址全小写，和夹具一致。 */
  function demo(chain: ChainId, address: string, symbol: string): TokenBalance {
    return {
      token: {
        chain,
        address,
        symbol,
        name: symbol,
        decimals: 18,
        displayDecimals: 4,
        logoColor: "#000000",
        verified: true,
      },
      amount: money(10n ** 18n, 18, symbol),
      usdValue: 1,
      change24hPct: 2.5,
    };
  }

  const symbols = (list: TokenBalance[]) =>
    list.map((item) => item.token.symbol).sort();

  afterEach(() => resetDeliveredWalletConfig());

  it("replaces the demo tokens with the delivered catalogue's on-chain balances where sends are real", async () => {
    // 真链上显示一个演示币，用户会拿着并不存在的 500 USDT 去转出，然后被"余额不足"顶回来
    deliver([usdtDelivered]);
    const { port } = fakeOnchain(["bsc"]);
    port.tokenBalances = jest.fn(
      async () => new Map([[USDT_BSC.toLowerCase(), 7n * 10n ** 18n]]),
    );
    const { gateway, chainData } = setup({ onchain: port });
    jest
      .spyOn(chainData, "getBalances")
      .mockResolvedValue(
        snapshot([demo("bsc", "native", "BNB"), demo("bsc", PEPE_BSC, "PEPE")]),
      );

    const list = await balances(gateway, ADDRESS, "bsc");

    // 只问下发目录里的合约；演示币 PEPE 在真链上不再出现，原生币仍在
    expect(port.tokenBalances).toHaveBeenCalledWith("bsc", ADDRESS, [USDT_BSC]);
    expect(symbols(list)).toEqual(["BNB", "USDT"]);
    const usdt = list.find((item) => item.token.symbol === "USDT");
    expect(usdt?.amount.raw).toBe((7n * 10n ** 18n).toString());
    // 单价按演示价格表按 symbol 匹配（USDT = 1）
    expect(usdt?.usdValue).toBeCloseTo(7);
    // verified 仍只由客户端白名单授予；展示精度来自下发
    expect(usdt?.token).toMatchObject({ verified: true, displayDecimals: 2 });
  });

  it("fails loudly when the token query fails, never falling back to the demo ledger", async () => {
    // 演示账本里给每个新地址都种了 8120 USDT；公共节点限流一次就显示这个数，
    // 正是"真链上显示演示币"。抛错让缓存里上一次真实数据留下
    deliver([usdtDelivered]);
    const { port } = fakeOnchain(["bsc"]);
    port.tokenBalances = async () => {
      throw new Error("node down");
    };
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const { gateway, chainData } = setup({ onchain: port });
    jest
      .spyOn(chainData, "getBalances")
      .mockResolvedValue(snapshot([demo("bsc", PEPE_BSC, "PEPE")]));

    // 这条链进 unavailable，而不是整批抛错让别的链也没了余额
    const result = await gateway.getBalances(ADDRESS, "bsc");
    expect(result.items).toEqual([]);
    expect(result.unavailable).toEqual([{ chain: "bsc", reason: "node" }]);
    warn.mockRestore();
  });

  it("omits a token whose single balance call failed instead of showing a demo figure", async () => {
    deliver([usdtDelivered]);
    const { port } = fakeOnchain(["bsc"]);
    port.tokenBalances = async () => new Map(); // Multicall 单条失败：没有这个键
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const { gateway, chainData } = setup({ onchain: port });
    jest
      .spyOn(chainData, "getBalances")
      .mockResolvedValue(snapshot([demo("bsc", USDT_BSC, "USDT")]));

    const list = await balances(gateway, ADDRESS, "bsc");

    expect(list.find((item) => item.token.symbol === "USDT")).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("shows only the native coin when the catalogue lists nothing else on the chain", async () => {
    // 目录里只有原生币是合法配置：不是"目录缺失"，也不需要留痕
    deliver([]);
    const { port } = fakeOnchain(["bsc"]);
    port.nativeBalance = async () => 10n ** 18n;
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const { gateway, chainData } = setup({ onchain: port });
    jest
      .spyOn(chainData, "getBalances")
      .mockResolvedValue(
        snapshot([demo("bsc", USDT_BSC.toLowerCase(), "USDT")]),
      );

    const list = await balances(gateway, ADDRESS, "bsc");

    expect(symbols(list)).toEqual(["BNB"]);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("prices only allowlisted tokens, so a contract calling itself ETH is worth nothing", async () => {
    // 任何合约都能把 symbol() 写成 ETH；按符号取价会影响大额验证阈值与总额
    deliver([
      {
        chain: "bsc",
        address: "0x000000000000000000000000000000000000bEEF",
        symbol: "ETH",
        name: "Fake ETH",
        decimals: 18,
        displayDecimals: 4,
        logoColor: "#627EEA",
      },
    ]);
    const { port } = fakeOnchain(["bsc"]);
    port.tokenBalances = async () =>
      new Map([["0x000000000000000000000000000000000000beef", 10n ** 18n]]);
    const { gateway, chainData } = setup({ onchain: port });
    jest.spyOn(chainData, "getBalances").mockResolvedValue(snapshot([]));

    const list = await balances(gateway, ADDRESS, "bsc");

    const fake = list.find((item) => item.token.address.endsWith("bEEF"));
    expect(fake?.amount.raw).toBe((10n ** 18n).toString());
    expect(fake?.usdValue).toBe(0);
  });

  it("leaves chains without endpoints on the demo ledger", async () => {
    deliver([
      usdtDelivered,
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
    const { port } = fakeOnchain(["bsc"]);
    port.tokenBalances = jest.fn(async () => new Map());
    const { gateway, chainData } = setup({ onchain: port });
    jest
      .spyOn(chainData, "getBalances")
      .mockResolvedValue(snapshot([demo("eth", UNI_ETH, "UNI")]));

    const list = await balances(gateway, ADDRESS, "eth");

    expect(symbols(list)).toEqual(["UNI"]);
    expect(port.tokenBalances).not.toHaveBeenCalled();
  });

  it("shows only the native coin on a real chain whose catalogue is empty", async () => {
    // 老服务端没下发目录：真链上也不能拿演示币充数
    deliver([]);
    const { port } = fakeOnchain(["bsc"]);
    port.tokenBalances = jest.fn(async () => new Map());
    const { gateway, chainData } = setup({ onchain: port });
    jest
      .spyOn(chainData, "getBalances")
      .mockResolvedValue(
        snapshot([demo("bsc", "native", "BNB"), demo("bsc", PEPE_BSC, "PEPE")]),
      );

    const list = await balances(gateway, ADDRESS, "bsc");

    expect(symbols(list)).toEqual(["BNB"]);
  });

  it("adds a delivered token the demo ledger never had, at the chain's balance", async () => {
    deliver([usdtDelivered]);
    const { port } = fakeOnchain(["bsc"]);
    port.tokenBalances = async () => new Map([[USDT_BSC.toLowerCase(), 0n]]);
    const { gateway, chainData } = setup({ onchain: port });
    jest.spyOn(chainData, "getBalances").mockResolvedValue(snapshot([]));

    const list = await balances(gateway, ADDRESS, "bsc");

    // 余额为 0 也要在列表里：目录是租户配的，不显示等于把币藏起来
    const usdt = list.find((item) => item.token.symbol === "USDT");
    expect(usdt?.amount.raw).toBe("0");
    expect(usdt?.usdValue).toBe(0);
  });
});

describe("EmbeddedWalletGateway chain switch", () => {
  afterEach(() => resetDeliveredWalletConfig());

  function enable(chains: ChainId[]) {
    applyDeliveredWalletConfig(tenantWallet({ chains }));
  }

  function demoNative(chain: ChainId, symbol: string): TokenBalance {
    return {
      token: {
        chain,
        address: "native",
        symbol,
        name: symbol,
        decimals: 18,
        displayDecimals: 4,
        logoColor: "#000000",
        verified: true,
      },
      amount: money(10n ** 18n, 18, symbol),
      usdValue: 1,
      change24hPct: 0,
    };
  }

  it("hides every balance on a chain the tenant turned off, instead of showing its demo ledger", async () => {
    // 关掉的链没有端点，不拦的话会落到演示账本，和真链余额并排显示
    enable(["eth"]);
    const { gateway, chainData } = setup();
    jest
      .spyOn(chainData, "getBalances")
      .mockResolvedValue(
        snapshot([demoNative("bsc", "BNB"), demoNative("eth", "ETH")]),
      );

    const all = await balances(gateway, ADDRESS);

    expect(all.map((item) => item.token.chain)).toEqual(["eth"]);
    // 直接问一条关掉的链是调用方的 bug：抛错，不给一个"空"的成功
    await expect(balances(gateway, ADDRESS, "bsc")).rejects.toBeInstanceOf(
      ChainNotEnabledError,
    );
  });

  it("reports the tenant's current chains for the built-in wallet, not the snapshot taken at creation", async () => {
    enable(["bsc", "eth", "base"]);
    const { gateway } = setup();
    await gateway.createWallet();

    enable(["op-sepolia"]);
    const [account] = await gateway.listAccounts();

    // 一把 EVM 私钥在每条启用的链上都能用；注册表里存的那份只是创建时的快照
    expect(account?.chains).toEqual(["op-sepolia"]);
  });

  it("keeps only the enabled chains among those an external wallet approved", async () => {
    // 外部钱包只在会话里批准的链上能签（这里是 bsc），再与租户启用的链取交集
    enable(["eth"]);
    const { gateway } = setup({ external: fakeExternal() });
    const connected = await gateway.connect("walletconnect");
    expect(connected.chains).toEqual([]);

    enable(["bsc", "eth"]);
    const [account] = await gateway.listAccounts();
    expect(account?.chains).toEqual(["bsc"]);
  });
});
