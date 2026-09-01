import type { ChainId } from "../../../core/gateways/types";
import type {
  EvmTransactionRequest,
  SignRequestContext,
  WalletSigner,
} from "../../../core/wallet/signer/types";
import type { WalletConnectorId } from "../../session/model/session";
import type { WalletConnector } from "../model/wallet";
import type { ExternalWalletConnector } from "./embedded-wallet-gateway";

/**
 * 外部钱包（MetaMask / OKX / Trust / 任意 WalletConnect 钱包）。
 *
 * 私钥**永远留在外部钱包里**：本应用只拿到地址，并把签名请求经 WalletConnect
 * 会话转发出去。所以这里没有任何 Vault / 密钥代码。
 *
 * 与 `@walletconnect/sign-client` 的耦合收在 `SignClientLike` 这个窄接口后面，
 * 便于单测注入假实现，也便于以后换 SDK。
 */

export const EVM_CHAIN_IDS: Record<ChainId, number> = {
  eth: 1,
  bsc: 56,
  base: 8453,
};

const CHAIN_BY_EIP155: Record<number, ChainId> = {
  1: "eth",
  56: "bsc",
  8453: "base",
};

/** 各钱包的深链前缀；用户点了哪个就直接唤起对应 App。 */
const WALLET_LINKS: Partial<Record<WalletConnectorId, string>> = {
  metamask: "metamask://wc?uri=",
  okx: "okx://main/wc?uri=",
  trust: "trust://wc?uri=",
};

export type SessionNamespace = {
  accounts: string[];
  chains?: string[];
};

export type ConnectedSession = {
  topic: string;
  namespaces: Record<string, SessionNamespace>;
};

/** `@walletconnect/sign-client` 中我们实际用到的部分。 */
export type SignClientLike = {
  connect: (args: {
    requiredNamespaces: Record<string, unknown>;
    optionalNamespaces?: Record<string, unknown>;
  }) => Promise<{ uri?: string; approval: () => Promise<ConnectedSession> }>;
  request: <T>(args: {
    topic: string;
    chainId: string;
    request: { method: string; params: unknown[] };
  }) => Promise<T>;
  disconnect: (args: {
    topic: string;
    reason: { code: number; message: string };
  }) => Promise<void>;
  session: {
    getAll: () => ConnectedSession[];
  };
};

export type WalletConnectDeps = {
  /** 惰性创建：没有 projectId 时根本不该走到这里 */
  client: () => Promise<SignClientLike>;
  /** 打开外部钱包 App 或展示二维码；返回后等待用户在钱包里批准 */
  present: (input: {
    uri: string;
    connector: WalletConnectorId;
    deepLink?: string;
  }) => Promise<void>;
  chains?: ChainId[];
  /** 唤起外部钱包确认签名（Android 上需要把用户切过去） */
  openWallet?: (connector: WalletConnectorId) => Promise<void>;
  /**
   * 当前是否可用（projectId 由服务端 bootstrap 下发，启动后才知道）。
   * 不可用时 `listConnectors` 会如实把外部钱包标成 installed:false。
   */
  available?: () => boolean;
};

export class WalletConnectUnavailableError extends Error {
  constructor() {
    super("WalletConnect is not configured for this build");
    this.name = "WalletConnectUnavailableError";
  }
}

export class WalletConnectRejectedError extends Error {
  constructor(message = "wallet rejected the request") {
    super(message);
    this.name = "WalletConnectRejectedError";
  }
}

type Connection = {
  topic: string;
  address: string;
  chains: ChainId[];
  connector: WalletConnectorId;
};

export function parseAccounts(
  namespaces: Record<string, SessionNamespace>,
): { address: string; chains: ChainId[] } | null {
  const accounts = namespaces.eip155?.accounts ?? [];
  let address: string | null = null;
  const chains: ChainId[] = [];
  for (const account of accounts) {
    // CAIP-10: eip155:56:0xabc…
    const [namespace, rawChain, rawAddress] = account.split(":");
    if (namespace !== "eip155" || !rawAddress) continue;
    address ??= rawAddress;
    const chain = CHAIN_BY_EIP155[Number(rawChain)];
    if (chain && !chains.includes(chain)) chains.push(chain);
  }
  if (!address) return null;
  return { address, chains: chains.length > 0 ? chains : ["bsc"] };
}

export class WalletConnectConnector implements ExternalWalletConnector {
  private readonly connections = new Map<string, Connection>();

  constructor(private readonly deps: WalletConnectDeps) {}

  async listConnectors(): Promise<WalletConnector[]> {
    // 配了 projectId 才算可用；能否唤起由深链决定，装了才会跳过去
    const installed = this.deps.available?.() ?? true;
    return [
      {
        id: "metamask",
        name: "MetaMask",
        kind: "external",
        installed,
        logoColor: "#F6851B",
      },
      {
        id: "okx",
        name: "OKX Wallet",
        kind: "external",
        installed,
        logoColor: "#000000",
      },
      {
        id: "trust",
        name: "Trust Wallet",
        kind: "external",
        installed,
        logoColor: "#3375BB",
      },
      {
        id: "walletconnect",
        name: "WalletConnect",
        kind: "external",
        installed,
        logoColor: "#3B99FC",
      },
    ];
  }

  async connect(connector: WalletConnectorId): Promise<{
    address: string;
    chains: ChainId[];
    label?: string;
  }> {
    if (this.deps.available && !this.deps.available())
      throw new WalletConnectUnavailableError();
    const client = await this.deps.client();
    const chains = this.deps.chains ?? (["bsc", "eth", "base"] as ChainId[]);
    const { uri, approval } = await client.connect({
      requiredNamespaces: {
        eip155: {
          chains: chains.map((chain) => `eip155:${EVM_CHAIN_IDS[chain]}`),
          methods: [
            "personal_sign",
            "eth_signTypedData_v4",
            "eth_sendTransaction",
            "eth_signTransaction",
          ],
          events: ["chainChanged", "accountsChanged"],
        },
      },
    });
    if (uri) {
      await this.deps.present({
        uri,
        connector,
        deepLink: WALLET_LINKS[connector],
      });
    }
    const session = await approval();
    const parsed = parseAccounts(session.namespaces);
    if (!parsed) throw new WalletConnectRejectedError("no account was shared");
    this.connections.set(parsed.address.toLowerCase(), {
      topic: session.topic,
      address: parsed.address,
      chains: parsed.chains,
      connector,
    });
    return { address: parsed.address, chains: parsed.chains };
  }

  async disconnect(address: string): Promise<void> {
    const connection = this.connections.get(address.toLowerCase());
    if (!connection) return;
    this.connections.delete(address.toLowerCase());
    const client = await this.deps.client();
    await client.disconnect({
      topic: connection.topic,
      reason: { code: 6000, message: "user disconnected" },
    });
  }

  signer(address: string): WalletSigner {
    const connection = this.connections.get(address.toLowerCase());
    if (!connection)
      throw new WalletConnectRejectedError("wallet is not connected");
    return new WalletConnectSigner(connection, this.deps);
  }

  /** 冷启动后恢复已有会话，避免用户每次都要重新扫码。 */
  async restore(): Promise<{ address: string; chains: ChainId[] }[]> {
    const client = await this.deps.client();
    const restored: { address: string; chains: ChainId[] }[] = [];
    for (const session of client.session.getAll()) {
      const parsed = parseAccounts(session.namespaces);
      if (!parsed) continue;
      this.connections.set(parsed.address.toLowerCase(), {
        topic: session.topic,
        address: parsed.address,
        chains: parsed.chains,
        connector: "walletconnect",
      });
      restored.push(parsed);
    }
    return restored;
  }
}

class WalletConnectSigner implements WalletSigner {
  constructor(
    private readonly connection: Connection,
    private readonly deps: WalletConnectDeps,
  ) {}

  get address(): string {
    return this.connection.address;
  }

  private chainRef(chainId?: number): string {
    const fallback = EVM_CHAIN_IDS[this.connection.chains[0] ?? "bsc"];
    return `eip155:${chainId ?? fallback}`;
  }

  private async send<T>(
    method: string,
    params: unknown[],
    chainId?: number,
  ): Promise<T> {
    const client = await this.deps.client();
    // Android 上请求发出后必须把用户切到钱包 App，否则他看不到确认页
    await this.deps.openWallet?.(this.connection.connector);
    try {
      return await client.request<T>({
        topic: this.connection.topic,
        chainId: this.chainRef(chainId),
        request: { method, params },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (/reject|denied|cancel/i.test(message))
        throw new WalletConnectRejectedError(message);
      throw error;
    }
  }

  async signMessage(
    message: string,
    _context: SignRequestContext,
  ): Promise<string> {
    void _context;
    // personal_sign 的参数顺序是 [data, address]，data 必须是 hex
    return this.send<string>("personal_sign", [
      utf8ToHex(message),
      this.connection.address,
    ]);
  }

  async signTypedData(
    domain: Record<string, unknown>,
    types: Record<string, unknown>,
    value: Record<string, unknown>,
    _context: SignRequestContext,
  ): Promise<string> {
    void _context;
    const payload = JSON.stringify({ domain, types, message: value });
    return this.send<string>("eth_signTypedData_v4", [
      this.connection.address,
      payload,
    ]);
  }

  async signTransaction(
    transaction: EvmTransactionRequest,
    _context: SignRequestContext,
  ): Promise<string> {
    void _context;
    return this.send<string>(
      "eth_signTransaction",
      [
        {
          from: transaction.from ?? this.connection.address,
          to: transaction.to,
          value: transaction.value ? toHex(transaction.value) : undefined,
          data: transaction.data,
          gas: transaction.gasLimit ? toHex(transaction.gasLimit) : undefined,
        },
      ],
      transaction.chainId,
    );
  }
}

function toHex(value: bigint): string {
  return `0x${value.toString(16)}`;
}

function utf8ToHex(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let hex = "0x";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}
