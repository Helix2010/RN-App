import {
  WalletConnectConnector,
  WalletConnectRejectedError,
  WalletConnectUnavailableError,
  parseAccounts,
  type ConnectedSession,
  type SignClientLike,
  type WalletConnectDeps,
} from "./walletconnect-connector";

const ADDRESS = "0x3f4A8C21b7d94E0a1F6c5d2e8b9A7c3D4e5F9a2C";
/** 由服务端下发的链目录；连接器不再自己硬编码 chainId */
const NETWORKS = [
  { id: "bsc" as const, chainId: 56 },
  { id: "eth" as const, chainId: 1 },
];

function session(overrides?: Partial<ConnectedSession>): ConnectedSession {
  return {
    topic: "topic-1",
    namespaces: {
      eip155: {
        accounts: [`eip155:56:${ADDRESS}`, `eip155:1:${ADDRESS}`],
      },
    },
    ...overrides,
  };
}

function setup(options?: {
  uri?: string;
  approval?: () => Promise<ConnectedSession>;
  request?: jest.Mock;
  existing?: ConnectedSession[];
  available?: () => boolean;
}) {
  const request = options?.request ?? jest.fn(async () => "0xsigned");
  const client: SignClientLike = {
    connect: jest.fn(async () => ({
      uri: options?.uri ?? "wc:topic@2?relay-protocol=irn&symKey=abc",
      approval: options?.approval ?? (async () => session()),
    })),
    request: request as unknown as SignClientLike["request"],
    disconnect: jest.fn(async () => {}),
    session: { getAll: () => options?.existing ?? [] },
  };
  const present = jest.fn(async () => {});
  const openWallet = jest.fn(async () => {});
  const deps: WalletConnectDeps = {
    client: async () => client,
    present,
    openWallet,
    networks: () => NETWORKS,
    available: options?.available,
  };
  return {
    connector: new WalletConnectConnector(deps),
    client,
    present,
    openWallet,
    request,
  };
}

describe("parseAccounts", () => {
  it("reads the address and every supported chain from CAIP-10 accounts", () => {
    expect(parseAccounts(session().namespaces, NETWORKS)).toEqual({
      address: ADDRESS,
      chains: ["bsc", "eth"],
    });
  });

  it("ignores unknown namespaces and chains", () => {
    const parsed = parseAccounts(
      {
        eip155: { accounts: [`eip155:999:${ADDRESS}`] },
        solana: { accounts: ["solana:mainnet:abc"] },
      },
      NETWORKS,
    );
    // 地址仍然可用，但没有一条我们支持的链 => 回退到默认链
    expect(parsed).toEqual({ address: ADDRESS, chains: ["bsc"] });
  });

  it("returns null when no account was shared", () => {
    expect(parseAccounts({}, NETWORKS)).toBeNull();
    expect(parseAccounts({ eip155: { accounts: [] } }, NETWORKS)).toBeNull();
  });
});

describe("WalletConnectConnector", () => {
  it("requests the chains and methods it needs, then returns the shared account", async () => {
    const { connector, client, present } = setup();
    const result = await connector.connect("metamask");
    expect(result).toEqual({ address: ADDRESS, chains: ["bsc", "eth"] });

    const namespaces = (client.connect as jest.Mock).mock.calls[0][0]
      .requiredNamespaces.eip155;
    // 链与 chainId 都来自下发的目录
    expect(namespaces.chains).toEqual(["eip155:56", "eip155:1"]);
    expect(namespaces.methods).toContain("personal_sign");
    expect(namespaces.methods).toContain("eth_signTypedData_v4");
    // 用 MetaMask 的深链把用户带过去
    expect(present).toHaveBeenCalledWith(
      expect.objectContaining({
        connector: "metamask",
        deepLink: "metamask://wc?uri=",
      }),
    );
  });

  it("fails cleanly when the wallet shares no account", async () => {
    const { connector } = setup({
      approval: async () => session({ namespaces: {} }),
    });
    await expect(connector.connect("walletconnect")).rejects.toBeInstanceOf(
      WalletConnectRejectedError,
    );
  });

  it("signs a message through the session as hex-encoded personal_sign", async () => {
    const { connector, request, openWallet } = setup();
    await connector.connect("metamask");
    const signature = await connector
      .signer(ADDRESS)
      .signMessage("hello", { reason: "sign in" });
    expect(signature).toBe("0xsigned");
    const call = request.mock.calls[0][0];
    expect(call).toMatchObject({
      topic: "topic-1",
      chainId: "eip155:56",
    });
    expect(call.request.method).toBe("personal_sign");
    // personal_sign 的参数是 [hex(data), address]
    expect(call.request.params).toEqual(["0x68656c6c6f", ADDRESS]);
    expect(openWallet).toHaveBeenCalledWith("metamask");
  });

  it("hex-encodes multi-byte messages by bytes", async () => {
    const { connector, request } = setup();
    await connector.connect("metamask");
    await connector.signer(ADDRESS).signMessage("é", { reason: "r" });
    expect(request.mock.calls[0][0].request.params[0]).toBe("0xc3a9");
  });

  it("sends typed data as eth_signTypedData_v4 with the address first", async () => {
    const { connector, request } = setup();
    await connector.connect("metamask");
    await connector
      .signer(ADDRESS)
      .signTypedData({ name: "F" }, { Order: [] }, { id: 1 }, { reason: "r" });
    const call = request.mock.calls[0][0].request;
    expect(call.method).toBe("eth_signTypedData_v4");
    expect(call.params[0]).toBe(ADDRESS);
    expect(JSON.parse(call.params[1] as string)).toEqual({
      domain: { name: "F" },
      types: { Order: [] },
      message: { id: 1 },
    });
  });

  it("uses the transaction's own chain and hex-encodes amounts", async () => {
    const { connector, request } = setup();
    await connector.connect("metamask");
    await connector.signer(ADDRESS).signTransaction(
      {
        chainId: 8453,
        to: "0x000000000000000000000000000000000000dEaD",
        value: 255n,
        gasLimit: 21000n,
      },
      { reason: "r" },
    );
    const call = request.mock.calls[0][0];
    expect(call.chainId).toBe("eip155:8453");
    expect(call.request.params[0]).toMatchObject({
      from: ADDRESS,
      value: "0xff",
      gas: "0x5208",
    });
  });

  it("turns a wallet refusal into a typed rejection", async () => {
    const request = jest.fn(async () => {
      throw new Error("User rejected the request");
    });
    const { connector } = setup({ request });
    await connector.connect("metamask");
    await expect(
      connector.signer(ADDRESS).signMessage("hi", { reason: "r" }),
    ).rejects.toBeInstanceOf(WalletConnectRejectedError);
  });

  it("reports external wallets as unavailable until the server delivers a project id", async () => {
    let ready = false;
    const { connector } = setup({ available: () => ready });
    const before = await connector.listConnectors();
    expect(before.every((item) => item.installed === false)).toBe(true);
    await expect(connector.connect("metamask")).rejects.toBeInstanceOf(
      WalletConnectUnavailableError,
    );

    ready = true;
    const after = await connector.listConnectors();
    expect(after.every((item) => item.installed === true)).toBe(true);
    await expect(connector.connect("metamask")).resolves.toMatchObject({
      address: ADDRESS,
    });
  });

  it("refuses to build a signer for an address it never connected", () => {
    const { connector } = setup();
    expect(() => connector.signer(ADDRESS)).toThrow("not connected");
  });

  it("disconnects the session and forgets the address", async () => {
    const { connector, client } = setup();
    await connector.connect("metamask");
    await connector.disconnect(ADDRESS);
    expect(client.disconnect).toHaveBeenCalledWith({
      topic: "topic-1",
      reason: { code: 6000, message: "user disconnected" },
    });
    expect(() => connector.signer(ADDRESS)).toThrow("not connected");
    // 再次断开同一个地址不应该炸
    await expect(connector.disconnect(ADDRESS)).resolves.toBeUndefined();
  });

  it("restores sessions that survived a cold start", async () => {
    const { connector } = setup({ existing: [session()] });
    await expect(connector.restore()).resolves.toEqual([
      { address: ADDRESS, chains: ["bsc", "eth"] },
    ]);
    // 恢复后可以直接签名，不用重新扫码
    await expect(
      connector.signer(ADDRESS).signMessage("hi", { reason: "r" }),
    ).resolves.toBe("0xsigned");
  });
});
