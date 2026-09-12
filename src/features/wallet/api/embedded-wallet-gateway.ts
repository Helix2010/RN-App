import type { MnemonicWordCount } from "../../../core/wallet/keygen/mnemonic";
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
import {
  WalletVaultCorruptedError,
  WalletVaultKeyMissingError,
  type KeystoreVault,
} from "../../../core/wallet/vault/keystore-vault";
import {
  trustedTokens,
  verifyAgainstAllowlist,
} from "../../../core/wallet/config/token-allowlist";
import {
  ChainNotEnabledError,
  deliveredTokens,
  enabledChains,
  isChainEnabled,
  isTestnetChain,
  nativeDisplayDecimals,
  onchainSendsEnabled,
} from "../../../core/wallet/config/wallet-runtime-config";
import type { WalletConnectorId } from "../../session/model/session";
import { referencePriceForSymbol } from "../fixtures/wallet";
import type {
  BalanceSnapshot,
  ChainBalanceFailure,
  SendRequest,
  TokenBalance,
  TransferQuote,
  WalletAccount,
  WalletConnector,
  WalletTransfer,
  WalletTransferFeed,
} from "../model/wallet";
import type { WalletIndexPort, WalletIndexResult } from "./http-wallet-index";
import {
  WalletNotProvisionedError,
  WalletProvisioningUnsupportedError,
  WalletRegistryCorruptedError,
  type WalletGateway,
  type WalletStorageRecovery,
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
  constructor(
    readonly chain: ChainId,
    readonly reason: "node" | "catalogue" = "node",
  ) {
    super(`balances on ${chain} are unavailable right now (${reason})`);
    this.name = "ChainBalanceUnavailableError";
  }
}

/** 真链模式下这条链没有可用的 RPC 端点（下发的端点全被 https 断言丢掉）。 */
export class ChainEndpointsUnavailableError extends Error {
  constructor(readonly chain: ChainId) {
    super(`chain ${chain} has no usable rpc endpoint`);
    this.name = "ChainEndpointsUnavailableError";
  }
}

/** 按演示参考价估值；表里没有这个符号就是 null，不写成 0 */
function priced(amount: Money, symbol: string): number | null {
  const price = referencePriceForSymbol(symbol);
  return price === null ? null : toApproxNumber(amount) * price;
}

/**
 * 账户注册表：`{ version: 1, current, meta }`，只有标签 / 连接器 / 当前账户这类元数据，
 * 没有密钥材料。读不出来时抛 `WalletRegistryCorruptedError`，不当空表覆盖；恢复流程
 * 把原文归档到 `REGISTRY_CORRUPT_BACKUP_PREFIX + ISO 时间` 后再清空。
 */
const REGISTRY_KEY = "foundation.wallet.accounts.v1";
export const REGISTRY_CORRUPT_BACKUP_PREFIX = `${REGISTRY_KEY}.corrupt.`;

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
/** 系统认证弹窗文案的内置字典 key（安全评审 N12）；由认证端口翻译，不在这里拼文案 */
const DEFAULT_SIGN_REASON = "wallet.sign.reason";

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
  /** 外部钱包会话里批准的链；内置钱包没有这个概念 */
  chains?: ChainId[];
};

type Registry = {
  version: 1;
  current: string | null;
  meta: Record<string, AccountMeta>;
};

/**
 * 真实链上的转出与余额。租户开了 `onchainSends` 的链一律走它：那条链没有可用端点
 * 就是错误，不会换成 Mock 账本。没开的租户是显式的演示账本状态。
 */
export type OnchainTransferPort = {
  available: (chain: ChainId) => boolean;
  send: (request: SendRequest, signer: WalletSigner) => Promise<WalletTransfer>;
  quote: (request: SendRequest) => Promise<TransferQuote>;
  listTransfers: (address: string) => Promise<WalletTransfer[]>;
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
  /** 平台收款索引；未注入时记录只有本机账本，界面不显示索引状态 */
  index?: WalletIndexPort;
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
      // 有账户但密钥库里的 WK 丢了 / 对不上：现在就报，不要等到签名那一步才发现
      await this.deps.vault.verifyWrapKey();
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
      chains: existing?.chains,
    };
    await this.writeRegistry(registry);
  }

  async markBackedUp(address: string): Promise<void> {
    await this.deps.vault.markBackedUp(address);
  }

  // ---- 开通与导入 ----

  // 注册表在 vault 写入**之前**读一次：注册表坏了就在这里失败，不会留下一条已经写进
  // vault、却从未向用户展示过助记词的孤儿条目（评审 2.4）。
  isPassphraseProtected(): Promise<boolean> {
    return this.deps.vault.isPassphraseProtected();
  }

  enablePassphrase(passphrase: string, reason: string): Promise<void> {
    return this.deps.vault.enablePassphrase(passphrase, reason);
  }

  async createWallet(options?: {
    reason?: string;
    words?: MnemonicWordCount;
  }): Promise<{ account: WalletAccount; mnemonic: string }> {
    await this.readRegistry();
    const { entry, mnemonic } = await this.deps.vault.createWallet(
      options?.reason,
      options?.words,
    );
    const account = await this.select(entry.address, "embedded");
    return { account, mnemonic };
  }

  async importMnemonic(
    phrase: string,
    index = 0,
    options?: { reason?: string },
  ): Promise<WalletAccount> {
    await this.readRegistry();
    const entry = await this.deps.vault.importMnemonic(
      phrase,
      index,
      options?.reason,
    );
    return this.select(entry.address, "embedded");
  }

  async importPrivateKey(
    privateKey: string,
    options?: { reason?: string },
  ): Promise<WalletAccount> {
    await this.readRegistry();
    const entry = await this.deps.vault.importPrivateKey(
      privateKey,
      options?.reason,
    );
    return this.select(entry.address, "embedded");
  }

  async recoverStorage(reason: string): Promise<WalletStorageRecovery> {
    let registryArchived = false;
    const rawRegistry = await this.deps.storage.getItem(REGISTRY_KEY);
    if (rawRegistry !== null && parseRegistry(rawRegistry) === null) {
      await this.deps.storage.setItem(
        `${REGISTRY_CORRUPT_BACKUP_PREFIX}${new Date().toISOString()}`,
        rawRegistry,
      );
      await this.deps.storage.removeItem(REGISTRY_KEY);
      registryArchived = true;
    }
    let vaultBroken = false;
    try {
      await this.deps.vault.verifyWrapKey();
      // 老文件没有 wkCheck，verifyWrapKey 看不出 WK 被换过：真的解一条（会弹一次认证）。
      // 解得开就补写 wkCheck，之后不再需要这一步。
      await this.deps.vault.verifyLegacyWrapKey(reason);
    } catch (error) {
      if (
        !(error instanceof WalletVaultCorruptedError) &&
        !(error instanceof WalletVaultKeyMissingError)
      )
        throw error;
      vaultBroken = true;
    }
    // 健康的 vault 一律不动：恢复面板只有在存储确实坏了时才会出现，但这里再守一次
    const vaultArchived = vaultBroken
      ? (await this.deps.vault.archiveAndReset(reason)) !== null
      : false;
    return { vaultArchived, registryArchived };
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

  async signerFor(address: string): Promise<WalletSigner> {
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

  /**
   * 余额按链分别查、分别失败：一条链的节点没响应，只有这条链进 `unavailable`，
   * 其他链的真实余额照常返回。整批抛错会让一条链的故障把用户所有资产都遮住。
   */
  async getBalances(
    address: string,
    chain?: ChainId,
  ): Promise<BalanceSnapshot> {
    // 问一条未启用的链是调用方的 bug，和链层其他入口一样直接抛错
    if (chain && !isChainEnabled(chain)) throw new ChainNotEnabledError(chain);
    const chains = chain ? [chain] : enabledChains();
    const enabled = new Set(chains);
    // 代币目录（含 verified 标记）由服务端下发，服务端被攻破时它可以把攻击者的
    // 合约标成"已验证"。所以 verified 只能由客户端那份表授予，元数据不符的丢掉。
    const ledger = trustedTokens(
      (await this.deps.chainData.getBalances(address, chain)).items.filter(
        (item) => enabled.has(item.token.chain),
      ),
    );
    const items: TokenBalance[] = [];
    const unavailable: ChainBalanceFailure[] = [];
    for (const id of chains) {
      const demo = ledger.filter((item) => item.token.chain === id);
      try {
        items.push(...(await this.chainBalances(id, address, demo)));
      } catch (error) {
        if (error instanceof ChainEndpointsUnavailableError) {
          unavailable.push({ chain: id, reason: "endpoints" });
          continue;
        }
        if (error instanceof ChainBalanceUnavailableError) {
          unavailable.push({ chain: id, reason: error.reason });
          continue;
        }
        throw error;
      }
    }
    return { items, unavailable };
  }

  /**
   * 一条链的余额。
   *
   * 演示账本状态（租户没开 onchainSends）直接返回账本里的条目。真链模式下：
   * - 没有可用端点是错误，不能换成演示数字；
   * - 代币（ERC-20）余额来自真链，而且**目录只认服务端下发的**：账本里的演示币一律
   *   移除——真链上显示一个演示币，用户会拿着并不存在的 500 USDT 去转出；
   * - 原生币余额来自真链，展示精度按目录；单价沿用账本隐含的单价（金额是真的，
   *   单价是演示的，比两者都假强），账本没有这条链的原生币时补一条、单价按 0；
   * - 任一步查不到都抛 ChainBalanceUnavailableError，由上层记为这条链不可用。
   */
  private async chainBalances(
    id: ChainId,
    address: string,
    demo: TokenBalance[],
  ): Promise<TokenBalance[]> {
    const onchain = this.deps.onchain;
    if (!onchain) return demo;
    if (!onchain.available(id)) {
      if (onchainSendsEnabled()) throw new ChainEndpointsUnavailableError(id);
      return demo;
    }
    // 下发的目录同样要过白名单：verified 只能由客户端授予，decimals 不符的丢掉
    const catalogue = trustedTokens(
      deliveredTokens(id)
        .filter((token) => token.address !== NATIVE_TOKEN_ADDRESS)
        .map((token) => ({ token: { ...token, verified: false } })),
    ).map((item) => item.token);
    let fetched: Map<string, bigint>;
    let nativeRaw: bigint;
    try {
      [fetched, nativeRaw] = await Promise.all([
        onchain.tokenBalances(
          id,
          address,
          catalogue.map((token) => token.address),
        ),
        onchain.nativeBalance(id, address),
      ]);
    } catch (error) {
      console.warn(`[wallet] ${id} 余额查询失败`, error);
      throw new ChainBalanceUnavailableError(id);
    }
    // 真链上不该显示演示币；原生币下面单独处理
    const result = demo.filter(
      (item) => item.token.address === NATIVE_TOKEN_ADDRESS,
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
        usdValue: token.verified ? priced(amount, token.symbol) : null,
        change24hPct: 0,
      });
    }
    const native = CHAINS[id];
    const amount = money(nativeRaw, native.nativeDecimals, native.nativeSymbol);
    // 真链上展示精度以下发目录为准。目录缺这条链的原生币条目是数据问题，只让这条链
    // 不可用，不能连累别的链
    let displayDecimals: number;
    try {
      displayDecimals = nativeDisplayDecimals(id);
    } catch (error) {
      console.warn(`[wallet] ${id} 的代币目录没有原生币条目`, error);
      throw new ChainBalanceUnavailableError(id, "catalogue");
    }
    // 原生币的估值和代币走同一张参考价表；测试链的币没有价值，是真的 0
    const usdValue = isTestnetChain(id)
      ? 0
      : priced(amount, native.nativeSymbol);
    const index = result.findIndex(
      (item) => item.token.address === NATIVE_TOKEN_ADDRESS,
    );
    if (index >= 0) {
      const previous = result[index] as TokenBalance;
      result[index] = {
        ...previous,
        token: { ...previous.token, displayDecimals },
        amount,
        usdValue,
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
        usdValue,
        change24hPct: 0,
      });
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
    if (onchain?.available(request.token.chain))
      return onchain.send(request, await this.signerFor(request.from));
    // 真链模式下没有端点就是错误：不猜端点，更不能悄悄改走演示账本
    if (onchainSendsEnabled())
      throw new ChainEndpointsUnavailableError(request.token.chain);
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
    return (await this.transferFeed(address)).items;
  }

  /**
   * 记录 = 平台索引 ∪ 本机账本（设计 wallet-receive-index-2026-09-06 §4.13）。
   *
   * 按 (链, 交易哈希) 去重，服务端为准：本机的转出一旦被索引到就用服务端那行，
   * 没被索引到的（进行中、失败、索引落后或这条链没开索引）保留本机行。
   * 索引服务没答上时不吞：本机记录照常返回，`indexError` 让界面说明服务端记录可能缺失。
   */
  async transferFeed(address: string): Promise<WalletTransferFeed> {
    // 链上转账只在本机账本里，Mock 账本不认识；不合并的话用户转完账回列表会发现记录没了
    const onchain = (await this.deps.onchain?.listTransfers(address)) ?? [];
    const ledger = await this.deps.chainData.listTransfers(address);
    const local = [...onchain, ...ledger];
    // 和余额一致：租户关掉的链，它上面的记录也不显示
    const enabledOnly = (item: WalletTransfer) =>
      isChainEnabled(item.token.chain);
    if (!this.deps.index)
      return { items: local.filter(enabledOnly), index: {}, hidden: 0 };
    let remote: WalletIndexResult;
    try {
      remote = await this.deps.index.list(address);
    } catch (error) {
      console.warn("[wallet] 收款索引查询失败", error);
      return {
        items: local.filter(enabledOnly),
        index: {},
        indexError: error instanceof Error ? error.message : String(error),
        hidden: 0,
      };
    }
    // 服务端目录的 verified 不采纳，decimals 与白名单不符的丢掉并计入 hidden
    const indexed = trustedTokens(remote.items);
    const known = new Set(
      indexed
        .filter((item) => item.kind === "send" && item.hash)
        .map((item) => transferKey(item)),
    );
    const kept = local.filter(
      (item) =>
        !(item.kind === "send" && item.hash && known.has(transferKey(item))),
    );
    return {
      items: [...indexed, ...kept].filter(enabledOnly),
      index: remote.index,
      hidden: remote.hidden + (remote.items.length - indexed.length),
    };
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
      chains: extra?.chains ?? registry.meta[key]?.chains,
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
    if (raw === null) return { version: 1, current: null, meta: {} };
    const parsed = parseRegistry(raw);
    if (parsed === null) throw new WalletRegistryCorruptedError();
    return parsed;
  }

  private async writeRegistry(registry: Registry): Promise<void> {
    await this.deps.storage.setItem(REGISTRY_KEY, JSON.stringify(registry));
  }
}

function parseRegistry(raw: string): Registry | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const registry = parsed as Partial<Registry>;
  if (registry.version !== 1) return null;
  if (typeof registry.meta !== "object" || registry.meta === null) return null;
  if (registry.current !== null && typeof registry.current !== "string")
    return null;
  return {
    version: 1,
    current: registry.current ?? null,
    meta: registry.meta,
  };
}

function transferKey(item: WalletTransfer): string {
  return `${item.token.chain}|${(item.hash ?? "").toLowerCase()}`;
}

function sameAddress(left: string | null, right: string): boolean {
  return left !== null && left.toLowerCase() === right.toLowerCase();
}
