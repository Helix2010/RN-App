import type {
  Chain,
  ChainId,
  KeyValueStorage,
  TokenRef,
  Tx,
} from "../../../core/gateways/types";
import type { Money } from "../../../core/money/money";
import { EmbeddedSigner } from "../../../core/wallet/signer/embedded-signer";
import type { WalletSigner } from "../../../core/wallet/signer/types";
import type { KeystoreVault } from "../../../core/wallet/vault/keystore-vault";
import {
  trustedTokens,
  verifyAgainstAllowlist,
} from "../../../core/wallet/config/token-allowlist";
import type { WalletConnectorId } from "../../session/model/session";
import type {
  SendRequest,
  TokenBalance,
  TransferQuote,
  WalletAccount,
  WalletConnector,
  WalletTransfer,
} from "../model/wallet";
import {
  WalletNotProvisionedError,
  WalletProvisioningUnsupportedError,
  type WalletGateway,
} from "./gateway";

/**
 * 代币的下发元数据与客户端已知事实不符。
 *
 * 单独一个类型是因为它必须和"余额不足"彻底分开：这是配置错误或篡改的信号，
 * 用户重试多少次都不会好，界面要如实说"这个代币的信息核对不上"。
 */
export class TokenMetadataMismatchError extends Error {
  constructor(readonly symbol: string) {
    super(`token metadata does not match the known contract: ${symbol}`);
    this.name = "TokenMetadataMismatchError";
  }
}

const REGISTRY_KEY = "foundation.wallet.accounts.v1";
const DEFAULT_CHAINS: ChainId[] = ["bsc", "eth", "base"];
const DEFAULT_SIGN_REASON = "Confirm with your wallet";

/** 链上数据来源。一期是 Mock 账本；接真链后换成 RPC / 索引器实现。 */
type WalletChainData = Pick<
  WalletGateway,
  | "listChains"
  | "listConnectors"
  | "getBalances"
  | "adjustBalance"
  | "send"
  | "getTransaction"
  | "listTransfers"
>;

/** 外部钱包（WalletConnect）连接器。P3 提供实现；未注入时外部连接器不可用。 */
export type ExternalWalletConnector = {
  connect: (connector: WalletConnectorId) => Promise<{
    address: string;
    chains: ChainId[];
    label?: string;
  }>;
  disconnect: (address: string) => Promise<void>;
  signer: (address: string) => WalletSigner;
  listConnectors?: () => Promise<WalletConnector[]>;
  /**
   * 恢复冷启动后仍有效的外部钱包会话。registry 会持久化外部账户，但连接器的
   * 内存连接不会，不恢复就会在签名时报"未连接"。
   */
  restore?: () => Promise<{ address: string }[]>;
};

type AccountMeta = {
  /** EIP-55 校验和形式；registry 的键用小写地址，展示用这个字段 */
  address: string;
  label: string;
  connector: WalletConnectorId;
  chains: ChainId[];
};

type Registry = {
  version: 1;
  current: string | null;
  meta: Record<string, AccountMeta>;
};

/**
 * 真实链上的转出。注入了并且那条链有 RPC 端点时才用它，否则回落到 Mock 账本——
 * 服务端有没有下发端点本身就是灰度开关。
 */
export type OnchainTransferPort = {
  available: (chain: ChainId) => boolean;
  send: (request: SendRequest, signer: WalletSigner) => Promise<WalletTransfer>;
  quote: (request: SendRequest) => Promise<TransferQuote>;
  listTransfers: (address: string) => WalletTransfer[];
  getTransaction: (id: string) => Promise<Tx | null>;
};

type EmbeddedWalletGatewayDeps = {
  vault: KeystoreVault;
  chainData: WalletChainData;
  storage: KeyValueStorage;
  external?: ExternalWalletConnector;
  onchain?: OnchainTransferPort;
  /**
   * 仅用于演示：给新开通的地址铺一份 Mock 余额，让 Mock 业务面还能被浏览。
   * 真实链数据接入后应直接删掉这个注入。
   */
  seedDemoBalances?: (address: string) => Promise<void>;
};

/**
 * 真实的自托管钱包网关：账户来自 `KeystoreVault`，签名来自 `EmbeddedSigner`，
 * 外部钱包（若已注入连接器）走 WalletConnect。链上数据仍委托给 `chainData`
 * —— 一期业务数据按产品决策保持 Mock，本网关只把**密钥与签名变成真的**。
 */
export class EmbeddedWalletGateway implements WalletGateway {
  constructor(private readonly deps: EmbeddedWalletGatewayDeps) {}

  // ---- 账户 ----

  async listAccounts(): Promise<WalletAccount[]> {
    const [entries, registry] = await Promise.all([
      this.deps.vault.list(),
      this.readRegistry(),
    ]);
    const embedded = entries.map((entry, index) => {
      const meta = registry.meta[entry.address.toLowerCase()];
      return {
        address: entry.address,
        label: meta?.label ?? `Wallet ${index + 1}`,
        connector: "embedded" as WalletConnectorId,
        chains: meta?.chains ?? DEFAULT_CHAINS,
        current: sameAddress(registry.current, entry.address),
        backedUp: entry.backedUpAt !== null,
      } satisfies WalletAccount;
    });
    const external = Object.entries(registry.meta)
      .filter(([, meta]) => meta.connector !== "embedded")
      .map(([address, meta]) => ({
        address: meta.address ?? address,
        label: meta.label,
        connector: meta.connector,
        chains: meta.chains,
        current: sameAddress(registry.current, address),
        // 外部钱包的备份由其自身负责
        backedUp: true,
      }));
    return [...embedded, ...external];
  }

  async currentAccount(): Promise<WalletAccount | null> {
    const accounts = await this.listAccounts();
    return accounts.find((account) => account.current) ?? null;
  }

  async connect(connector: WalletConnectorId): Promise<WalletAccount> {
    if (connector === "embedded") {
      const entries = await this.deps.vault.list();
      if (entries.length === 0) throw new WalletNotProvisionedError();
      const registry = await this.readRegistry();
      const preferred =
        entries.find((entry) => sameAddress(registry.current, entry.address)) ??
        entries[0]!;
      return this.select(preferred.address, "embedded");
    }
    const external = this.deps.external;
    if (!external) throw new WalletProvisioningUnsupportedError(connector);
    const connected = await external.connect(connector);
    return this.select(connected.address, connector, {
      label: connected.label,
      chains: connected.chains,
    });
  }

  /**
   * 断开 = 从本应用移除该账户的选中状态 / 外部连接。
   * **不会删除自托管钱包的密钥** —— 删除密钥必须走单独的、带确认的流程。
   */
  async disconnect(address: string): Promise<void> {
    const registry = await this.readRegistry();
    const key = address.toLowerCase();
    const meta = registry.meta[key];
    if (meta && meta.connector !== "embedded") {
      await this.deps.external?.disconnect(address);
      delete registry.meta[key];
    }
    if (sameAddress(registry.current, address)) {
      const remaining = (await this.deps.vault.list()).find(
        (entry) => !sameAddress(entry.address, address),
      );
      registry.current = remaining?.address ?? null;
    }
    await this.writeRegistry(registry);
  }

  async switchAccount(address: string): Promise<WalletAccount> {
    const accounts = await this.listAccounts();
    const target = accounts.find((account) =>
      sameAddress(account.address, address),
    );
    if (!target) throw new Error("account not found");
    return this.select(target.address, target.connector);
  }

  async rename(address: string, label: string): Promise<void> {
    const registry = await this.readRegistry();
    const key = address.toLowerCase();
    const existing = registry.meta[key];
    registry.meta[key] = {
      address: existing?.address ?? address,
      label,
      connector: existing?.connector ?? "embedded",
      chains: existing?.chains ?? DEFAULT_CHAINS,
    };
    await this.writeRegistry(registry);
  }

  async markBackedUp(address: string): Promise<void> {
    await this.deps.vault.markBackedUp(address);
  }

  // ---- 开通与导入 ----

  async createWallet(): Promise<{ account: WalletAccount; mnemonic: string }> {
    const { entry, mnemonic } = await this.deps.vault.createWallet();
    const account = await this.select(entry.address, "embedded");
    return { account, mnemonic };
  }

  async importMnemonic(phrase: string, index = 0): Promise<WalletAccount> {
    const entry = await this.deps.vault.importMnemonic(phrase, index);
    return this.select(entry.address, "embedded");
  }

  async importPrivateKey(privateKey: string): Promise<WalletAccount> {
    const entry = await this.deps.vault.importPrivateKey(privateKey);
    return this.select(entry.address, "embedded");
  }

  async revealMnemonic(address: string, reason: string): Promise<string> {
    return this.deps.vault.revealMnemonic(address, reason);
  }

  // ---- 签名 ----

  async signMessage(
    address: string,
    message: string,
    options?: { reason?: string },
  ): Promise<string> {
    const signer = await this.signerFor(address);
    return signer.signMessage(message, {
      reason: options?.reason ?? DEFAULT_SIGN_REASON,
    });
  }

  private async signerFor(address: string): Promise<WalletSigner> {
    if (await this.deps.vault.has(address))
      return new EmbeddedSigner(address, this.deps.vault);
    const registry = await this.readRegistry();
    const meta = registry.meta[address.toLowerCase()];
    const external = this.deps.external;
    if (!meta || meta.connector === "embedded" || !external)
      throw new Error("no signer is available for this account");
    try {
      return external.signer(address);
    } catch {
      // 冷启动后内存里没有连接：先恢复一次再试，否则用户每次重启都要重新扫码
      await external.restore?.();
      return external.signer(address);
    }
  }

  // ---- 链上数据（委托） ----

  listChains(): Promise<Chain[]> {
    return this.deps.chainData.listChains();
  }

  async listConnectors(): Promise<WalletConnector[]> {
    const base = await this.deps.chainData.listConnectors();
    // 内置钱包始终来自基础列表；外部钱包的可用性交给外部连接器判断
    // （它知道服务端有没有下发 WalletConnect projectId）。
    const embedded = base.filter((item) => item.kind === "embedded");
    const external = this.deps.external?.listConnectors
      ? await this.deps.external.listConnectors()
      : base
          .filter((item) => item.kind === "external")
          // 没有外部连接器实现时如实标记不可用，而不是让用户点了没反应
          .map((item) => ({ ...item, configured: false, installed: false }));
    return [...embedded, ...external];
  }

  async getBalances(address: string, chain?: ChainId): Promise<TokenBalance[]> {
    const balances = await this.deps.chainData.getBalances(address, chain);
    // 代币目录（含 verified 标记）由服务端下发，服务端被攻破时它可以把攻击者的
    // 合约标成"已验证"。所以 verified 只能由客户端那份表授予，元数据不符的丢掉。
    return trustedTokens(balances);
  }

  adjustBalance(address: string, token: TokenRef, delta: Money): Promise<void> {
    return this.deps.chainData.adjustBalance(address, token, delta);
  }

  async send(request: SendRequest): Promise<WalletTransfer> {
    // 纵深防御：余额列表已经滤过一遍，但代币也可能从别处进来（深链、将来的
    // 目录推送）。decimals 不符时这笔转出的金额会差 10ⁿ 倍，必须挡在签名之前。
    const verdict = verifyAgainstAllowlist(request.token);
    if (verdict.status === "mismatch")
      throw new TokenMetadataMismatchError(request.token.symbol);
    const onchain = this.deps.onchain;
    // 那条链没下发 RPC 就走 Mock：不猜端点，也不让用户以为转了真钱
    if (onchain?.available(request.token.chain))
      return onchain.send(request, await this.signerFor(request.from));
    return this.deps.chainData.send(request);
  }

  async getTransaction(id: string): Promise<Tx | null> {
    // 链上交易的 id 是 txHash，只有 onchain 那边认得；查不到再问 Mock
    const onchain = await this.deps.onchain?.getTransaction(id);
    if (onchain) return onchain;
    return this.deps.chainData.getTransaction(id);
  }

  async quoteTransfer(request: SendRequest): Promise<TransferQuote | null> {
    const onchain = this.deps.onchain;
    if (!onchain?.available(request.token.chain)) return null;
    return onchain.quote(request);
  }

  async listTransfers(address: string): Promise<WalletTransfer[]> {
    // 链上转账只在内存里，Mock 账本不认识；不合并的话用户转完账回列表会发现记录没了
    const onchain = this.deps.onchain?.listTransfers(address) ?? [];
    const ledger = await this.deps.chainData.listTransfers(address);
    return [...onchain, ...ledger];
  }

  // ---- 内部 ----

  private async select(
    address: string,
    connector: WalletConnectorId,
    extra?: { label?: string; chains?: ChainId[] },
  ): Promise<WalletAccount> {
    const registry = await this.readRegistry();
    const key = address.toLowerCase();
    const isNew = registry.meta[key] === undefined;
    const count = Object.keys(registry.meta).length;
    registry.meta[key] = {
      address,
      label: extra?.label ?? registry.meta[key]?.label ?? `Wallet ${count + 1}`,
      connector,
      chains: extra?.chains ?? registry.meta[key]?.chains ?? DEFAULT_CHAINS,
    };
    registry.current = address;
    await this.writeRegistry(registry);
    if (isNew) await this.deps.seedDemoBalances?.(address);
    const accounts = await this.listAccounts();
    const account = accounts.find((item) => sameAddress(item.address, address));
    if (!account) throw new Error("account not found after selection");
    return account;
  }

  private async readRegistry(): Promise<Registry> {
    const raw = await this.deps.storage.getItem(REGISTRY_KEY);
    if (!raw) return { version: 1, current: null, meta: {} };
    try {
      const parsed = JSON.parse(raw) as Registry;
      if (parsed?.version !== 1 || typeof parsed.meta !== "object")
        return { version: 1, current: null, meta: {} };
      return { ...parsed, meta: parsed.meta ?? {} };
    } catch {
      return { version: 1, current: null, meta: {} };
    }
  }

  private async writeRegistry(registry: Registry): Promise<void> {
    await this.deps.storage.setItem(REGISTRY_KEY, JSON.stringify(registry));
  }
}

function sameAddress(left: string | null, right: string): boolean {
  return left !== null && left.toLowerCase() === right.toLowerCase();
}
