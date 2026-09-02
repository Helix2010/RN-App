import { getAddress } from "ethers";
import {
  CHAINS,
  type KeyValueStorage,
  type Tx,
} from "../../../core/gateways/types";
import { money, type Money } from "../../../core/money/money";
import type { PredictServiceConfig } from "../../../core/config/bootstrap.schema";
import {
  jwtUsable,
  loginWithSigner,
  refreshToken,
  decodeJwt,
} from "../../../core/predict-platform/auth";
import {
  balanceAllowance,
  obtainClobCredentials,
} from "../../../core/predict-platform/clob-auth";
import {
  isPredictServiceConfigured,
  onPredictServiceChange,
  predictService,
} from "../../../core/predict-platform/config";
import {
  MAX_UINT256,
  conditionalTokens,
  decodeBool,
  decodeUint,
  erc20,
  findUnwrapInitiated,
  usdWrapper,
} from "../../../core/predict-platform/contracts";
import { PredictCredentialStore } from "../../../core/predict-platform/credentials";
import { listUnwrapRequests } from "../../../core/predict-platform/data-service";
import {
  claimFaucet,
  faucetStatus,
  type FaucetStatus,
} from "../../../core/predict-platform/faucet";
import {
  fetchPublicInfo,
  platformContracts,
  type PlatformContracts,
  type PublicInfo,
} from "../../../core/predict-platform/public-info";
import {
  deployedSafe,
  safeNonce,
  submitSafeCreate,
  submitSafeTx,
  waitForRelayed,
} from "../../../core/predict-platform/relayer";
import {
  createProxySignatureParams,
  createProxyTypedData,
  encodeMultiSend,
  safeTxSignatureParams,
  safeTxTypedData,
} from "../../../core/predict-platform/safe";
import type { WalletSigner } from "../../../core/wallet/signer/types";
import { evmChainIdOf } from "../../../core/wallet/config/wallet-runtime-config";
import type { WalletGateway } from "../../wallet/api/gateway";
import type { OnchainTransfers } from "../../wallet/api/onchain-transfers";
import type { PredictTx } from "../model/predict";
import {
  PredictNotEnabledError,
  enablementComplete,
  type DepositAsset,
  type DepositStep,
  type EnablementStep,
  type PendingWithdrawal,
  type PredictAccountBalance,
  type PredictAccountGateway,
  type PredictEnablement,
  type PredictWalletFunds,
  type UnwrapTerms,
} from "./account-gateway";

/**
 * 真实预测平台的账户网关。流程与合约调用与 `docs/design/predict-platform-integration-2026-09-02.md`
 * §2 一致，每一步都是平台 user-dapp 里对应代码的移植：
 * - 登录：EIP-712 LoginMessage → gamma JWT；
 * - Safe：relayer 预测地址 / 部署（CreateProxy）；
 * - CLOB 密钥：ClobAuth → derive / create；
 * - 授权：一笔 MultiSend（USDW.approve × 4 + CTF.setApprovalForAll × 3）；
 * - 转入：EOA 付 gas，approve（按额）+ wrap 到 Safe，或 USDW 直接 transfer；
 * - 转出：SafeTx MultiSend [approve, initiateUnwrap] → 等 unwrapDelay → [claimUnwrap, USDC.transfer(EOA)]。
 *
 * 没有任何一步在失败时换成别的数据：平台没配好、公钥对不上、relayer 拒绝，都原样抛出。
 */

const SIGN_REASON = "predict.sign.reason";
const PENDING_KEY_PREFIX = "foundation.predict.pending-withdrawals.v1";
const JWT_REFRESH_MARGIN_SECONDS = 300;

type Context = {
  service: PredictServiceConfig;
  info: PublicInfo;
  contracts: PlatformContracts;
};

type LocalPending = PendingWithdrawal & { safe: string };

export class HttpPredictAccountGateway implements PredictAccountGateway {
  private context: Context | null = null;
  private readonly credentials: PredictCredentialStore;
  /** 本次会话提交的链上交易：hash → 链 与快照，供 getTx 轮询 */
  private readonly submitted = new Map<
    string,
    { chain: PredictServiceConfig["chain"]; tx: PredictTx }
  >();

  constructor(
    private readonly deps: {
      wallet: WalletGateway;
      onchain: OnchainTransfers;
      credentials: PredictCredentialStore;
      storage: KeyValueStorage;
      now?: () => number;
      sleep?: (ms: number) => Promise<void>;
    },
  ) {
    this.credentials = deps.credentials;
    // 平台关联变了（换域名 / scopeId / 链，或关闭）：旧平台的凭证一律作废
    onPredictServiceChange((next, previous) => {
      this.context = null;
      if (previous !== null) void this.credentials.clearAll();
      void next;
    });
  }

  // ---- 平台上下文 ----

  private async contextFor(): Promise<Context> {
    const service = predictService();
    if (
      this.context &&
      this.context.service.domain === service.domain &&
      this.context.service.scopeId === service.scopeId &&
      this.context.service.chain === service.chain
    )
      return this.context;
    const info = await fetchPublicInfo(service);
    const next = { service, info, contracts: platformContracts(info) };
    this.context = next;
    return next;
  }

  private nowSeconds(): number {
    return Math.floor((this.deps.now?.() ?? Date.now()) / 1000);
  }

  private usdw(ctx: Context, raw: bigint | string): Money {
    return money(raw, ctx.contracts.usdwDecimals, "USDW");
  }

  private usdc(ctx: Context, raw: bigint | string): Money {
    return money(raw, ctx.contracts.usdcDecimals, "USDC");
  }

  // ---- 凭证 ----

  /** 可用的 JWT：能刷就刷，不能就要求重新登录（需要签名器）。 */
  private async ensureJwt(
    ctx: Context,
    address: string,
    signer?: WalletSigner,
  ): Promise<string> {
    const stored = await this.credentials.load(ctx.service, address);
    const now = this.nowSeconds();
    if (
      stored.jwt &&
      jwtUsable(
        stored.jwt,
        address,
        ctx.service.scopeId,
        now,
        JWT_REFRESH_MARGIN_SECONDS,
      )
    )
      return stored.jwt;
    if (stored.jwt) {
      const claims = decodeJwt(stored.jwt);
      // 还没过期只是余量不够：先刷新；刷新失败再走登录
      if (
        claims &&
        claims.exp > now &&
        claims.sub.toLowerCase() === address.toLowerCase()
      ) {
        try {
          const refreshed = await refreshToken(ctx.service, stored.jwt);
          await this.credentials.save(ctx.service, address, { jwt: refreshed });
          return refreshed;
        } catch {
          // 走下面的重新登录
        }
      }
    }
    if (!signer)
      throw new PredictNotEnabledError(await this.enablement(address));
    const jwt = await loginWithSigner(ctx.service, signer, {
      reason: SIGN_REASON,
    });
    await this.credentials.save(ctx.service, address, { jwt });
    return jwt;
  }

  private async safeFor(
    ctx: Context,
    address: string,
    jwt: string,
  ): Promise<{ address: string; deployed: boolean }> {
    const result = await deployedSafe(
      { service: ctx.service, token: jwt },
      address,
    );
    await this.credentials.save(ctx.service, address, { safe: result.address });
    return result;
  }

  private async approvalsPresent(ctx: Context, safe: string): Promise<boolean> {
    const { usdw, ctf, ctfExchange, negRiskAdapter, negRiskExchange } =
      ctx.contracts;
    const chain = ctx.service.chain;
    const spenders = [ctf, ctfExchange, negRiskAdapter, negRiskExchange];
    const operators = [ctfExchange, negRiskAdapter, negRiskExchange];
    const allowances = await Promise.all(
      spenders.map((spender) =>
        this.deps.onchain.readContract(
          chain,
          usdw,
          erc20.encodeFunctionData("allowance", [safe, spender]),
        ),
      ),
    );
    if (!allowances.every((raw) => decodeUint(raw) > 0n)) return false;
    const approvals = await Promise.all(
      operators.map((operator) =>
        this.deps.onchain.readContract(
          chain,
          ctf,
          conditionalTokens.encodeFunctionData("isApprovedForAll", [
            safe,
            operator,
          ]),
        ),
      ),
    );
    return approvals.every(decodeBool);
  }

  // ---- 启用 ----

  async enablement(address: string): Promise<PredictEnablement> {
    if (!isPredictServiceConfigured())
      return {
        configured: false,
        loggedIn: false,
        safe: null,
        clobKey: false,
        approved: false,
      };
    const ctx = await this.contextFor();
    const stored = await this.credentials.load(ctx.service, address);
    const loggedIn = Boolean(
      stored.jwt &&
      jwtUsable(stored.jwt, address, ctx.service.scopeId, this.nowSeconds(), 0),
    );
    let safe: PredictEnablement["safe"] = null;
    if (loggedIn && stored.jwt)
      safe = await this.safeFor(ctx, address, stored.jwt);
    const approved = safe?.deployed
      ? await this.approvalsPresent(ctx, safe.address)
      : false;
    return {
      configured: true,
      loggedIn,
      safe,
      clobKey: Boolean(stored.clob),
      approved,
    };
  }

  async enable(
    address: string,
    onStep?: (step: EnablementStep) => void,
  ): Promise<PredictEnablement> {
    const ctx = await this.contextFor();
    const signer = await this.deps.wallet.signerFor(address);
    const chainId = evmChainIdOf(ctx.service.chain);

    onStep?.("login");
    const jwt = await this.ensureJwt(ctx, address, signer);
    const auth = { service: ctx.service, token: jwt };

    onStep?.("deploySafe");
    let safe = await this.safeFor(ctx, address, jwt);
    if (!safe.deployed) {
      const typed = createProxyTypedData(
        chainId,
        ctx.contracts.safeFactory,
        ctx.service.scopeId,
      );
      const signature = await signer.signTypedData(
        typed.domain,
        typed.types,
        typed.value,
        { reason: SIGN_REASON },
      );
      const id = await submitSafeCreate(auth, {
        from: address,
        factory: ctx.contracts.safeFactory,
        proxyWallet: safe.address,
        signature,
        signatureParams: createProxySignatureParams(ctx.service.scopeId),
      });
      await waitForRelayed(auth, id, { sleep: this.deps.sleep });
      safe = await this.safeFor(ctx, address, jwt);
      if (!safe.deployed)
        throw new Error(
          "the relayer reported the Safe as mined but it is still not deployed",
        );
    }

    onStep?.("clobKey");
    const stored = await this.credentials.load(ctx.service, address);
    if (!stored.clob) {
      const clob = await obtainClobCredentials(ctx.service, signer, {
        reason: SIGN_REASON,
      });
      await this.credentials.save(ctx.service, address, { clob });
    }

    onStep?.("approve");
    if (!(await this.approvalsPresent(ctx, safe.address))) {
      const {
        usdw,
        ctf,
        ctfExchange,
        negRiskAdapter,
        negRiskExchange,
        multiSend,
      } = ctx.contracts;
      const data = encodeMultiSend([
        ...[ctf, ctfExchange, negRiskAdapter, negRiskExchange].map(
          (spender) => ({
            to: usdw,
            data: erc20.encodeFunctionData("approve", [spender, MAX_UINT256]),
          }),
        ),
        ...[ctfExchange, negRiskAdapter, negRiskExchange].map((operator) => ({
          to: ctf,
          data: conditionalTokens.encodeFunctionData("setApprovalForAll", [
            operator,
            true,
          ]),
        })),
      ]);
      await this.relaySafeTx(
        ctx,
        auth,
        signer,
        safe.address,
        multiSend,
        data,
        "approval",
      );
    }
    return this.enablement(address);
  }

  /** 签一笔 SafeTx（MultiSend，delegatecall）并经 relayer 执行到终态；返回链上 txHash。 */
  private async relaySafeTx(
    ctx: Context,
    auth: { service: PredictServiceConfig; token: string },
    signer: WalletSigner,
    safe: string,
    to: string,
    data: string,
    metadata: string,
  ): Promise<string> {
    const nonce = await safeNonce(auth, safe);
    const typed = safeTxTypedData(evmChainIdOf(ctx.service.chain), safe, {
      to,
      data,
      operation: 1,
      nonce,
    });
    const signature = await signer.signTypedData(
      typed.domain,
      typed.types,
      typed.value,
      { reason: SIGN_REASON },
    );
    const id = await submitSafeTx(auth, {
      from: signer.address,
      to,
      proxyWallet: safe,
      data,
      nonce,
      signature,
      signatureParams: safeTxSignatureParams(1),
      metadata,
    });
    const record = await waitForRelayed(auth, id, { sleep: this.deps.sleep });
    if (!record.transactionHash)
      throw new Error(`relayed transaction ${id} has no transaction hash`);
    return record.transactionHash;
  }

  private async enabledContext(address: string): Promise<{
    ctx: Context;
    jwt: string;
    safe: string;
    clob: NonNullable<
      Awaited<ReturnType<PredictCredentialStore["load"]>>["clob"]
    >;
  }> {
    const ctx = await this.contextFor();
    const status = await this.enablement(address);
    if (!enablementComplete(status) || !status.safe)
      throw new PredictNotEnabledError(status);
    const stored = await this.credentials.load(ctx.service, address);
    if (!stored.jwt || !stored.clob) throw new PredictNotEnabledError(status);
    const jwt = await this.ensureJwt(ctx, address);
    return { ctx, jwt, safe: status.safe.address, clob: stored.clob };
  }

  // ---- 余额 ----

  async getBalance(address: string): Promise<PredictAccountBalance> {
    const { ctx, safe, clob } = await this.enabledContext(address);
    const [raw, clobBalance] = await Promise.all([
      this.deps.onchain.readContract(
        ctx.service.chain,
        ctx.contracts.usdw,
        erc20.encodeFunctionData("balanceOf", [safe]),
      ),
      balanceAllowance(ctx.service, clob, address),
    ]);
    return {
      chain: ctx.service.chain,
      safe,
      safeBalance: this.usdw(ctx, decodeUint(raw)),
      available: this.usdw(ctx, clobBalance.available),
      lockedInOrders: this.usdw(ctx, clobBalance.locked),
    };
  }

  async walletFunds(address: string): Promise<PredictWalletFunds> {
    const ctx = await this.contextFor();
    const chain = ctx.service.chain;
    const [tokens, native] = await Promise.all([
      this.deps.onchain.tokenBalances(chain, address, [
        ctx.contracts.usdcUnderlying,
        ctx.contracts.usdw,
      ]),
      this.deps.onchain.nativeBalance(chain, address),
    ]);
    const native_ = CHAINS[chain];
    return {
      chain,
      usdc: this.usdc(
        ctx,
        tokens.get(ctx.contracts.usdcUnderlying.toLowerCase()) ?? 0n,
      ),
      usdw: this.usdw(ctx, tokens.get(ctx.contracts.usdw.toLowerCase()) ?? 0n),
      native: money(native, native_.nativeDecimals, native_.nativeSymbol),
    };
  }

  async unwrapTerms(): Promise<UnwrapTerms> {
    const ctx = await this.contextFor();
    const wrapper = ctx.contracts.usdwWrapper;
    const [delay, min] = await Promise.all([
      this.deps.onchain.readContract(
        ctx.service.chain,
        wrapper,
        usdWrapper.encodeFunctionData("unwrapDelay", []),
      ),
      this.deps.onchain.readContract(
        ctx.service.chain,
        wrapper,
        usdWrapper.encodeFunctionData("minUnwrapUsdw", []),
      ),
    ]);
    return {
      delaySeconds: Number(decodeUint(delay)),
      minAmount: this.usdw(ctx, decodeUint(min)),
    };
  }

  // ---- 转入（EOA 付 gas） ----

  private depositCalls(
    ctx: Context,
    address: string,
    safe: string,
    input: { asset: DepositAsset; amount: Money },
  ) {
    const amount = BigInt(input.amount.raw);
    if (input.asset === "USDW")
      return [
        {
          step: "transfer" as const,
          to: ctx.contracts.usdw,
          data: erc20.encodeFunctionData("transfer", [safe, amount]),
          label: "transfer USDW",
        },
      ];
    return [
      {
        // 按本次金额授权，不给 wrapper 无上限额度
        step: "approve" as const,
        to: ctx.contracts.usdcUnderlying,
        data: erc20.encodeFunctionData("approve", [
          ctx.contracts.usdwWrapper,
          amount,
        ]),
        label: "approve USDC",
      },
      {
        step: "wrap" as const,
        to: ctx.contracts.usdwWrapper,
        data: usdWrapper.encodeFunctionData("wrap", [
          ctx.contracts.usdcUnderlying,
          amount,
          safe,
        ]),
        label: "wrap USDC",
      },
    ].map((call) => ({ ...call, from: address }));
  }

  async quoteDeposit(
    address: string,
    input: { asset: DepositAsset; amount: Money },
  ): Promise<Money> {
    const { ctx, safe } = await this.enabledContext(address);
    const chain = ctx.service.chain;
    // wrap 在 approve 之前估算会 revert（额度不足）；用 approve 的费用 × 步数给一个诚实的上界
    const calls = this.depositCalls(ctx, address, safe, input);
    const first = calls[0];
    if (!first) throw new Error("deposit has no calls");
    const fee = await this.deps.onchain.estimateCall(chain, {
      from: address,
      to: first.to,
      data: first.data,
      label: first.label,
    });
    const native = CHAINS[chain];
    return money(
      fee * BigInt(calls.length),
      native.nativeDecimals,
      native.nativeSymbol,
    );
  }

  async deposit(
    address: string,
    input: { asset: DepositAsset; amount: Money },
    onStep?: (step: DepositStep) => void,
  ): Promise<PredictTx> {
    const { ctx, safe } = await this.enabledContext(address);
    const signer = await this.deps.wallet.signerFor(address);
    const chain = ctx.service.chain;
    let lastHash = "";
    const calls = this.depositCalls(ctx, address, safe, input);
    for (const [index, call] of calls.entries()) {
      onStep?.(call.step);
      const { hash } = await this.deps.onchain.callContract(
        chain,
        { from: address, to: call.to, data: call.data, label: call.label },
        signer,
      );
      lastHash = hash;
      // 中间步骤（approve）要等上链，否则 wrap 会因额度未生效而 revert
      if (index < calls.length - 1)
        await this.waitReceipt(chain, hash, call.label);
    }
    const tx: PredictTx = {
      id: lastHash,
      kind: "deposit",
      status: "submitted",
      hash: lastHash,
      updatedAt: new Date(this.deps.now?.() ?? Date.now()).toISOString(),
    };
    this.submitted.set(lastHash, { chain, tx });
    return tx;
  }

  private async waitReceipt(
    chain: PredictServiceConfig["chain"],
    hash: string,
    label: string,
  ): Promise<void> {
    const sleep =
      this.deps.sleep ??
      ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const receipt = await this.deps.onchain.receiptOf(chain, hash);
      if (receipt?.status === "success") return;
      if (receipt?.status === "reverted")
        throw new Error(`${label} reverted on chain (${hash})`);
      await sleep(3_000);
    }
    throw new Error(`${label} is still pending on chain (${hash})`);
  }

  // ---- 转出（两阶段，relayer 免 gas） ----

  private pendingKey(safe: string): string {
    return `${PENDING_KEY_PREFIX}.${safe.toLowerCase()}`;
  }

  private async localPending(safe: string): Promise<LocalPending[]> {
    const raw = await this.deps.storage.getItem(this.pendingKey(safe));
    if (!raw) return [];
    try {
      return JSON.parse(raw) as LocalPending[];
    } catch {
      return [];
    }
  }

  private async saveLocalPending(
    safe: string,
    items: LocalPending[],
  ): Promise<void> {
    await this.deps.storage.setItem(
      this.pendingKey(safe),
      JSON.stringify(items),
    );
  }

  async withdraw(address: string, amount: Money): Promise<PendingWithdrawal> {
    const { ctx, jwt, safe } = await this.enabledContext(address);
    const terms = await this.unwrapTerms();
    if (BigInt(amount.raw) < BigInt(terms.minAmount.raw))
      throw new Error(
        `withdrawals below ${terms.minAmount.raw} raw USDW are rejected by the wrapper`,
      );
    const signer = await this.deps.wallet.signerFor(address);
    const {
      usdw,
      usdwWrapper: wrapper,
      usdcUnderlying,
      multiSend,
    } = ctx.contracts;
    const raw = BigInt(amount.raw);
    const data = encodeMultiSend([
      { to: usdw, data: erc20.encodeFunctionData("approve", [wrapper, raw]) },
      {
        to: wrapper,
        data: usdWrapper.encodeFunctionData("initiateUnwrap", [
          raw,
          usdcUnderlying,
        ]),
      },
    ]);
    const hash = await this.relaySafeTx(
      ctx,
      { service: ctx.service, token: jwt },
      signer,
      safe,
      multiSend,
      data,
      "initiate-unwrap",
    );
    const logs = await this.deps.onchain.receiptLogs(ctx.service.chain, hash);
    const event = logs ? findUnwrapInitiated(logs, wrapper) : null;
    if (!event)
      throw new Error(
        `initiate-unwrap ${hash} is mined but emitted no UnwrapInitiated event`,
      );
    const pending: LocalPending = {
      requestId: event.requestId.toString(),
      amount: this.usdw(ctx, event.usdwAmount),
      assetAmount: this.usdc(ctx, event.assetAmount),
      claimableAt: new Date(event.claimableAt * 1000).toISOString(),
      initTxHash: hash,
      source: "local",
      safe,
    };
    const local = await this.localPending(safe);
    await this.saveLocalPending(safe, [
      ...local.filter((item) => item.requestId !== pending.requestId),
      pending,
    ]);
    return pending;
  }

  async listPendingWithdrawals(address: string): Promise<PendingWithdrawal[]> {
    const { ctx, safe } = await this.enabledContext(address);
    const [platform, local] = await Promise.all([
      listUnwrapRequests(ctx.service, safe),
      this.localPending(safe),
    ]);
    // 子图已索引的以平台为准；本机记录只补子图还没追上的那几笔，追上了就删
    const platformIds = new Set(platform.map((item) => item.requestId));
    const remaining = local.filter((item) => !platformIds.has(item.requestId));
    if (remaining.length !== local.length)
      await this.saveLocalPending(safe, remaining);
    const fromPlatform: PendingWithdrawal[] = platform
      .filter((item) => !item.claimed)
      .map((item) => ({
        requestId: item.requestId,
        amount: this.usdw(ctx, item.usdwAmount),
        assetAmount: this.usdc(ctx, item.assetAmount),
        claimableAt: new Date(Number(item.claimableAt) * 1000).toISOString(),
        initTxHash: item.initTxHash,
        source: "platform",
      }));
    return [...fromPlatform, ...remaining].sort((a, b) =>
      a.claimableAt.localeCompare(b.claimableAt),
    );
  }

  async claimWithdrawal(
    address: string,
    requestId: string,
  ): Promise<PredictTx> {
    const { ctx, jwt, safe } = await this.enabledContext(address);
    const pending = (await this.listPendingWithdrawals(address)).find(
      (item) => item.requestId === requestId,
    );
    if (!pending) throw new Error(`withdrawal ${requestId} is not pending`);
    if (
      new Date(pending.claimableAt).getTime() >
      (this.deps.now?.() ?? Date.now())
    )
      throw new Error(
        `withdrawal ${requestId} is not claimable before ${pending.claimableAt}`,
      );
    const signer = await this.deps.wallet.signerFor(address);
    const { usdwWrapper: wrapper, usdcUnderlying, multiSend } = ctx.contracts;
    const data = encodeMultiSend([
      {
        to: wrapper,
        data: usdWrapper.encodeFunctionData("claimUnwrap", [BigInt(requestId)]),
      },
      // 领回来的 USDC 先到 Safe，再转回登录的 EOA（网页版同样固定回 EOA）
      {
        to: usdcUnderlying,
        data: erc20.encodeFunctionData("transfer", [
          getAddress(address),
          BigInt(pending.assetAmount.raw),
        ]),
      },
    ]);
    const hash = await this.relaySafeTx(
      ctx,
      { service: ctx.service, token: jwt },
      signer,
      safe,
      multiSend,
      data,
      "claim-unwrap",
    );
    const local = await this.localPending(safe);
    await this.saveLocalPending(
      safe,
      local.filter((item) => item.requestId !== requestId),
    );
    const tx: PredictTx = {
      id: hash,
      kind: "withdraw",
      status: "confirmed",
      hash,
      updatedAt: new Date(this.deps.now?.() ?? Date.now()).toISOString(),
    };
    this.submitted.set(hash, { chain: ctx.service.chain, tx });
    return tx;
  }

  async getTx(id: string): Promise<PredictTx | null> {
    const known = this.submitted.get(id);
    if (!known) return null;
    if (known.tx.status === "confirmed" || known.tx.status === "failed")
      return known.tx;
    const receipt = await this.deps.onchain.receiptOf(known.chain, id);
    const status: Tx["status"] = !receipt
      ? "confirming"
      : receipt.status === "success"
        ? "confirmed"
        : "failed";
    const next: PredictTx = {
      ...known.tx,
      status,
      reasonKey: status === "failed" ? "tx.reverted" : undefined,
      updatedAt: new Date(this.deps.now?.() ?? Date.now()).toISOString(),
    };
    this.submitted.set(id, { ...known, tx: next });
    return next;
  }

  // ---- faucet ----

  async faucetStatus(address: string): Promise<FaucetStatus> {
    const ctx = await this.contextFor();
    const jwt = await this.ensureJwt(ctx, address);
    return faucetStatus(ctx.service, jwt);
  }

  async claimFaucet(address: string): Promise<void> {
    const ctx = await this.contextFor();
    const jwt = await this.ensureJwt(ctx, address);
    await claimFaucet(ctx.service, jwt);
  }

  async forgetCredentials(address: string): Promise<void> {
    if (!isPredictServiceConfigured()) return;
    await this.credentials.clear(predictService(), address);
  }
}
