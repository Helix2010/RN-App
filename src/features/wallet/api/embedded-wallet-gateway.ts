import type {
  ChainId,
  KeyValueStorage,
  TokenRef,
  Tx,
} from "../../../core/gateways/types";
import { CHAINS, NATIVE_TOKEN_ADDRESS } from "../../../core/gateways/types";
import { money, toApproxNumber, type Money } from "../../../core/money/money";
import { EmbeddedSigner } from "../../../core/wallet/signer/embedded-signer";
import type { WalletSigner } from "../../../core/wallet/signer/types";
import type { KeystoreVault } from "../../../core/wallet/vault/keystore-vault";
import {
  trustedTokens,
  verifyAgainstAllowlist,
} from "../../../core/wallet/config/token-allowlist";
import {
  deliveredTokens,
  enabledChains,
  isChainEnabled,
  nativeDisplayDecimals,
} from "../../../core/wallet/config/wallet-runtime-config";
import type { WalletConnectorId } from "../../session/model/session";
import { referencePriceForSymbol } from "../fixtures/wallet";
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

/**
 * 真链上的余额暂时读不到。
 *
 * 必须是一个错误而不是"沿用上一次的值"：这里没有"上一次的值"——能拿到的只有
 * 演示账本里种下的 8120 USDT，把它当余额显示等于在真链上撒谎，而且 React Query
 * 会用这个"成功"结果覆盖掉缓存里上一次真实的链上数据。抛错的话缓存保留、界面
 * 显示"暂时读不到"，重试之后自然恢复。
 */
export class ChainBalanceUnavailableError extends Error {
  constructor(readonly chain: ChainId) {
    super(`balances on ${chain} are unavailable right now`);
    this.name = "ChainBalanceUnavailableError";
  }
}

const REGISTRY_KEY = "foundation.wallet.accounts.v1";

/**
 * 账户在界面上"支持的链"。
 *
 * 内置钱包是一把 EVM 私钥，租户启用哪条链它就能用哪条，所以直接取租户启用的链，
 * 不看注册表里存的那份（那只是创建时的快照，租户改配置后就过期了）。
 * 外部钱包只在它会话里批准过的链上能签，再与租户启用的链取交集。
 */
function accountChains(
  meta: { connector: WalletConnectorId; chains?: ChainId[] } | undefined,
): ChainId[] {
  if (!meta || meta.connector === "embedded") return enabledChains();
  return (meta.chains ?? []).filter(isChainEnabled);
}
const DEFAULT_SIGN_REASON = "Confirm with your wallet";

/** 链上数据来源。一期是 Mock 账本；接真链后换成 RPC / 索引器实现。 */
type WalletChainData = Pick<
  WalletGateway,
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
  nativeBalance: (chain: ChainId, address: string) => Promise<bigint>;
  /**
   * 一批 ERC-20 合约在这个地址上的余额，键是**小写**合约地址。
   * 单个合约查不到时它不在结果里（而不是 0），调用方按缺失处理。
   */
  tokenBalances: (
    chain: ChainId,
    address: string,
    contracts: string[],
  ) => Promise<Map<string, bigint>>;
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
        chains: accountChains(meta),
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
        chains: accountChains(meta),
        current: sameAddress(registry.current, address),
        // 外部钱包的备份由其自身负责
        backedUp: true,
      }));
    return [...embedded, ...external];
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
      chains: existing?.chains ?? enabledChains(),
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
    // 租户关掉的链一条都不显示。它没有端点，不拦的话会落到演示账本，
    // 和真链余额并排——"关掉"就变成了"变成假的"
    if (chain && !isChainEnabled(chain)) return [];
    const enabled = new Set(enabledChains());
    const balances = (
      await this.deps.chainData.getBalances(address, chain)
    ).filter((item) => enabled.has(item.token.chain));
    // 代币目录（含 verified 标记）由服务端下发，服务端被攻破时它可以把攻击者的
    // 合约标成"已验证"。所以 verified 只能由客户端那份表授予，元数据不符的丢掉。
    const withTokens = await this.withOnchainTokens(
      address,
      chain,
      trustedTokens(balances),
    );
    return this.withOnchainNative(address, chain, withTokens);
  }

  /**
   * 转出走真链的链，代币（ERC-20）余额也来自真链，而且**目录只认服务端下发的**。
   *
   * 这条链上演示账本里的代币一律移除：真链上显示一个演示币，用户会拿着并不
   * 存在的 500 USDT 去转出，然后被链上预检的"余额不足"顶回来——界面自相矛盾。
   * 下发里有而账本没有的补一条，单价按演示价格表按 symbol 匹配（价格源另议），
   * 匹配不到按 0；两边都有的，金额换成链上的，24h 涨跌沿用账本。
   * 整批查不到时沿用账本的值并留痕，和原生币一致——别把余额显示成 0。
   */
  private async withOnchainTokens(
    address: string,
    chain: ChainId | undefined,
    list: TokenBalance[],
  ): Promise<TokenBalance[]> {
    const onchain = this.deps.onchain;
    if (!onchain) return list;
    let result = [...list];
    const chains = chain ? [chain] : enabledChains();
    for (const id of chains) {
      if (!onchain.available(id)) continue;
      // 下发的目录同样要过白名单：verified 只能由客户端授予，decimals 不符的丢掉
      const catalogue = trustedTokens(
        deliveredTokens(id)
          .filter((token) => token.address !== NATIVE_TOKEN_ADDRESS)
          .map((token) => ({ token: { ...token, verified: false } })),
      ).map((item) => item.token);
      if (catalogue.length === 0)
        // 老服务端、或服务端读库失败省略了 tokens：真链上会只剩原生币，要留痕
        console.warn(`[wallet] ${id} 走真链但目录里没有代币，列表只剩原生币`);
      let fetched: Map<string, bigint>;
      try {
        fetched = await onchain.tokenBalances(
          id,
          address,
          catalogue.map((token) => token.address),
        );
      } catch (error) {
        console.warn(`[wallet] ${id} 代币余额查询失败`, error);
        throw new ChainBalanceUnavailableError(id);
      }
      // 真链上不该显示演示币；原生币由 withOnchainNative 单独处理
      result = result.filter(
        (item) =>
          item.token.chain !== id ||
          item.token.address === NATIVE_TOKEN_ADDRESS,
      );
      for (const token of catalogue) {
        const raw = fetched.get(token.address.toLowerCase());
        if (raw === undefined) {
          // Multicall 里单条失败：不显示。演示账本里的数不是"旧值"，显示 0 也是撒谎
          console.warn(
            `[wallet] ${id} 上 ${token.symbol} 的余额查不到，暂不显示`,
          );
          continue;
        }
        const amount = money(raw, token.decimals, token.symbol);
        result.push({
          token,
          amount,
          // 参考价只给白名单内的币：任何合约都能把 symbol() 写成 ETH，
          // 按符号取价会让一个假币按 4500 美元估值，进而影响大额验证阈值与总额
          usdValue: token.verified
            ? toApproxNumber(amount) * referencePriceForSymbol(token.symbol)
            : 0,
          change24hPct: 0,
        });
      }
    }
    return result;
  }

  /**
   * 转出走真链的链，原生币余额也必须来自真链。
   *
   * 代币（ERC-20）还要等服务端的代币目录，但原生币没有这个依赖。不接的话，
   * 用户真转出了一笔，"资产"页刷出来的数字纹丝不动——他会以为钱没转出去。
   * 价格暂时沿用账本里隐含的单价（金额是真的，单价是演示的，比两者都假强）；
   * 账本里没有这条链的原生币时补一条，单价按 0——测试链的币本来就没有价值。
   */
  private async withOnchainNative(
    address: string,
    chain: ChainId | undefined,
    list: TokenBalance[],
  ): Promise<TokenBalance[]> {
    const onchain = this.deps.onchain;
    if (!onchain) return list;
    const result = [...list];
    const chains = chain ? [chain] : enabledChains();
    for (const id of chains) {
      if (!onchain.available(id)) continue;
      let raw: bigint;
      try {
        raw = await onchain.nativeBalance(id, address);
      } catch (error) {
        // 真链上没有"原值"可沿用——账本里那个是演示数字。抛错让缓存保留上一次真实值
        console.warn(`[wallet] ${id} 原生币余额查询失败`, error);
        throw new ChainBalanceUnavailableError(id);
      }
      const native = CHAINS[id];
      const amount = money(raw, native.nativeDecimals, native.nativeSymbol);
      // 真链上展示精度以下发目录为准，演示夹具里的那份只服务于演示账本
      const displayDecimals = nativeDisplayDecimals(id);
      const index = result.findIndex(
        (item) =>
          item.token.chain === id &&
          item.token.address === NATIVE_TOKEN_ADDRESS,
      );
      if (index >= 0) {
        const previous = result[index] as TokenBalance;
        const held = toApproxNumber(previous.amount);
        const price = held > 0 ? previous.usdValue / held : 0;
        result[index] = {
          ...previous,
          token: { ...previous.token, displayDecimals },
          amount,
          usdValue: toApproxNumber(amount) * price,
        };
      } else {
        result.push({
          token: {
            chain: id,
            address: NATIVE_TOKEN_ADDRESS,
            symbol: native.nativeSymbol,
            name: native.nativeSymbol,
            decimals: native.nativeDecimals,
            displayDecimals,
            logoColor: native.color,
            verified: true,
          },
          amount,
          usdValue: 0,
          change24hPct: 0,
        });
      }
    }
    return result;
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

  sendsOnchain(chain: ChainId): boolean {
    return this.deps.onchain?.available(chain) ?? false;
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
      chains: extra?.chains ?? registry.meta[key]?.chains ?? enabledChains(),
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
