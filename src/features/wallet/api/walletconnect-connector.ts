import type { ChainId } from "../../../core/gateways/types";
import type {
  EvmTransactionRequest,
  SignRequestContext,
  WalletSigner,
} from "../../../core/wallet/signer/types";
import type { WalletConnectorId } from "../../session/model/session";
import type { WalletConnector } from "../model/wallet";
import type { ExternalWalletConnector } from "./embedded-wallet-gateway";
import { assertSubmittable } from "../../../core/wallet/signer/transaction-guard";
import { pairingLinks } from "./wallet-deep-links";

/**
 * 外部钱包（MetaMask / OKX / Trust / 任意 WalletConnect 钱包）。
 *
 * 私钥**永远留在外部钱包里**：本应用只拿到地址，并把签名请求经 WalletConnect
 * 会话转发出去。所以这里没有任何 Vault / 密钥代码。
 *
 * 与 `@walletconnect/sign-client` 的耦合收在 `SignClientLike` 这个窄接口后面，
 * 便于单测注入假实现，也便于以后换 SDK。
 */

type SessionNamespace = {
  accounts: string[];
  chains?: string[];
};

export type ConnectedSession = {
  topic: string;
  namespaces: Record<string, SessionNamespace>;
  /** 对端钱包的自述身份，冷启动恢复时用来认出是哪个钱包 */
  peer?: { metadata?: { name?: string } };
};

/** `@walletconnect/sign-client` 中我们实际用到的部分。 */
export type SignClientLike = {
  connect: (args: {
    requiredNamespaces?: Record<string, unknown>;
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
    /** 候选深链（已带 `wc?uri=`）；OKX 有两个 App，按顺序试 */
    deepLinks: string[];
  }) => Promise<void>;
  /**
   * 服务端下发的链目录（id + EIP-155 chainId）。**不要在这里硬编码 chainId** ——
   * 服务端已经是它的唯一真相源，两份映射一旦不一致，签名会打到错误的链上。
   */
  networks: () => { id: ChainId; chainId: number }[];
  /** 唤起外部钱包确认签名（Android 上需要把用户切过去） */
  openWallet?: (connector: WalletConnectorId) => Promise<void>;
  /**
   * 当前是否可用（projectId 由服务端 bootstrap 下发，启动后才知道）。
   * 不可用时 `listConnectors` 把外部钱包标成 configured:false，UI 会置灰。
   */
  available?: () => boolean;
  /**
   * 这个钱包 App 装了没。**只影响提示文案**：没装也允许点，走二维码。
   * 探测本身依赖 AndroidManifest 的 queries 声明，探不到就当没装。
   */
  installed?: (connector: WalletConnectorId) => Promise<boolean>;
  /** 等待用户在钱包里批准的超时（毫秒）；到点抛 timeout，UI 才能给出反馈 */
  approvalTimeoutMs?: number;
  /** 签名 / 发交易请求的超时；不传用默认 */
  requestTimeoutMs?: number;
};

export class WalletConnectUnavailableError extends Error {
  constructor() {
    super("WalletConnect is not configured for this build");
    this.name = "WalletConnectUnavailableError";
  }
}

class WalletConnectTimeoutError extends Error {
  constructor() {
    // message 里必须带 timeout：上层按它区分"用户拒绝"和"等太久"
    super("wallet approval timeout");
    this.name = "WalletConnectTimeoutError";
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
  networks: { id: ChainId; chainId: number }[],
): { address: string; chains: ChainId[] } | null {
  const accounts = namespaces.eip155?.accounts ?? [];
  let address: string | null = null;
  const chains: ChainId[] = [];
  for (const account of accounts) {
    // CAIP-10: eip155:56:0xabc…
    const [namespace, rawChain, rawAddress] = account.split(":");
    if (namespace !== "eip155" || !rawAddress) continue;
    address ??= rawAddress;
    const chain = networks.find(
      (network) => network.chainId === Number(rawChain),
    )?.id;
    if (chain && !chains.includes(chain)) chains.push(chain);
  }
  if (!address) return null;
  const fallback = networks[0]?.id ?? "bsc";
  return { address, chains: chains.length > 0 ? chains : [fallback] };
}

/** 从会话对端的自述名字认出钱包；认不出返回 null（走通用 WalletConnect）。 */
function connectorOf(session: ConnectedSession): WalletConnectorId | null {
  const name = session.peer?.metadata?.name?.toLowerCase() ?? "";
  if (name.includes("metamask")) return "metamask";
  if (name.includes("okx") || name.includes("okex")) return "okx";
  if (name.includes("trust")) return "trust";
  return null;
}

const DEFAULT_APPROVAL_TIMEOUT_MS = 120_000;
/** 签名 / 发交易请求的超时。比配对长：用户可能要在钱包里看清楚再点。 */
const DEFAULT_REQUEST_TIMEOUT_MS = 180_000;

export class WalletConnectConnector implements ExternalWalletConnector {
  private readonly connections = new Map<string, Connection>();
  /** 正在等批准的那次连接；用户关掉二维码时用它中断 */
  private pendingReject: ((error: Error) => void) | null = null;
  /** 二维码刚弹出来就被关掉时，连接还没走到等待批准那一步，用标记补上 */
  private cancelRequested = false;

  constructor(private readonly deps: WalletConnectDeps) {}

  async listConnectors(): Promise<WalletConnector[]> {
    // configured：租户配了 projectId 才能连（没配就置灰）
    // installed：这个钱包 App 装了没，只用于文案——没装也能点，走二维码
    const configured = this.deps.available?.() ?? true;
    const catalog: { id: WalletConnectorId; name: string; color: string }[] = [
      { id: "metamask", name: "MetaMask", color: "#F6851B" },
      { id: "okx", name: "OKX Wallet", color: "#000000" },
      { id: "trust", name: "Trust Wallet", color: "#3375BB" },
    ];
    const installed = await Promise.all(
      catalog.map((item) =>
        configured && this.deps.installed
          ? this.deps.installed(item.id).catch(() => false)
          : Promise.resolve(false),
      ),
    );
    return [
      ...catalog.map((item, index) => ({
        id: item.id,
        name: item.name,
        kind: "external" as const,
        configured,
        installed: installed[index] ?? false,
        logoColor: item.color,
      })),
      {
        id: "walletconnect" as WalletConnectorId,
        name: "WalletConnect",
        kind: "external" as const,
        configured,
        // 扫码连接不需要本机装任何钱包
        installed: configured,
        logoColor: "#3B99FC",
      },
    ];
  }

  /**
   * 等用户在钱包里批准。必须有超时：SDK 的 approval() 在用户直接杀掉钱包 App
   * 时永远不 resolve，UI 就会一直转圈，看着像卡死。
   */
  private async awaitApproval(
    approval: () => Promise<ConnectedSession>,
  ): Promise<ConnectedSession> {
    if (this.cancelRequested)
      throw new WalletConnectRejectedError("user cancelled the pairing");
    const timeoutMs =
      this.deps.approvalTimeoutMs ?? DEFAULT_APPROVAL_TIMEOUT_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        approval(),
        new Promise<never>((_resolve, reject) => {
          this.pendingReject = reject;
          timer = setTimeout(
            () => reject(new WalletConnectTimeoutError()),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      this.pendingReject = null;
    }
  }

  async connect(connector: WalletConnectorId): Promise<{
    address: string;
    chains: ChainId[];
    label?: string;
  }> {
    if (this.deps.available && !this.deps.available())
      throw new WalletConnectUnavailableError();
    this.cancelRequested = false;
    const client = await this.deps.client();
    const networks = this.deps.networks();
    const { uri, approval } = await client.connect({
      // 用 optionalNamespaces：requiredNamespaces 里的方法是"钱包必须支持"，
      // 声明了 MetaMask 不支持的 eth_signTransaction 反而可能被拒绝配对。
      // SDK 2.24 已经把 requiredNamespaces 自动转成 optional，这里顺着它写清。
      optionalNamespaces: {
        eip155: {
          chains: networks.map((network) => `eip155:${network.chainId}`),
          methods: [
            "personal_sign",
            "eth_signTypedData_v4",
            "eth_sendTransaction",
          ],
          events: ["chainChanged", "accountsChanged"],
        },
      },
    });
    if (uri) {
      await this.deps.present({
        uri,
        connector,
        deepLinks: pairingLinks(connector),
      });
    }
    const session = await this.awaitApproval(approval);
    const parsed = parseAccounts(session.namespaces, networks);
    if (!parsed) throw new WalletConnectRejectedError("no account was shared");
    this.connections.set(parsed.address.toLowerCase(), {
      topic: session.topic,
      address: parsed.address,
      chains: parsed.chains,
      connector,
    });
    return { address: parsed.address, chains: parsed.chains };
  }

  /** 放弃正在等待的连接（用户关掉了二维码 / 返回了）。 */
  cancelConnect(): void {
    this.cancelRequested = true;
    this.pendingReject?.(
      // message 带 reject：上层按它归类成"用户取消"而不是"失败"
      new WalletConnectRejectedError("user cancelled the pairing"),
    );
    this.pendingReject = null;
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
    const networks = this.deps.networks();
    for (const session of client.session.getAll()) {
      const parsed = parseAccounts(session.namespaces, networks);
      if (!parsed) continue;
      this.connections.set(parsed.address.toLowerCase(), {
        topic: session.topic,
        address: parsed.address,
        chains: parsed.chains,
        // 记住当初是哪个钱包：签名时要按它唤起，写死 walletconnect 就永远不跳
        connector: connectorOf(session) ?? "walletconnect",
      });
      restored.push(parsed);
    }
    return restored;
  }
}

class WalletConnectSigner implements WalletSigner {
  /** 钱包 App 自己算 nonce 与手续费，我们不该猜 */
  readonly managesOwnFees = true;

  constructor(
    private readonly connection: Connection,
    private readonly deps: WalletConnectDeps,
  ) {}

  get address(): string {
    return this.connection.address;
  }

  private chainRef(chainId?: number): string {
    if (chainId !== undefined) return `eip155:${chainId}`;
    const networks = this.deps.networks();
    const preferred = this.connection.chains[0];
    const fallback =
      networks.find((network) => network.id === preferred)?.chainId ??
      networks[0]?.chainId;
    return `eip155:${fallback ?? 56}`;
  }

  private async send<T>(
    method: string,
    params: unknown[],
    chainId?: number,
  ): Promise<T> {
    const client = await this.deps.client();
    // Android 上请求发出后必须把用户切到钱包 App，否则他看不到确认页
    await this.deps.openWallet?.(this.connection.connector);
    // 必须有超时：用户直接杀掉钱包 App 时 request() 永远不 resolve，而确认页在
    // 签名期间是锁死的（不能关、不能返回），没有超时就等于把用户关在里面
    const timeoutMs = this.deps.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        client.request<T>({
          topic: this.connection.topic,
          chainId: this.chainRef(chainId),
          request: { method, params },
        }),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new WalletConnectTimeoutError()),
            timeoutMs,
          );
        }),
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (/reject|denied|cancel/i.test(message))
        throw new WalletConnectRejectedError(message);
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
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

  async submitTransaction(
    transaction: EvmTransactionRequest,
    _context: SignRequestContext,
    _broadcast: (signedTransaction: string) => Promise<string>,
  ): Promise<string> {
    void _context;
    // 外部钱包自己签名并广播，所以用不上 broadcast：请求的返回值就是 txHash。
    // 这里也不传 nonce / 手续费——钱包自己算的比我们准，猜错反而会让它拒签。
    void _broadcast;
    assertSubmittable(transaction);
    return this.send<string>(
      "eth_sendTransaction",
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
