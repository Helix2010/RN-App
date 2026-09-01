import { Transaction } from "ethers";
import type { SignRequestContext, WalletSigner } from "../wallet/signer/types";
import {
  assertLocallySignable,
  assertSubmittable,
} from "../wallet/signer/transaction-guard";
import { ChainClient } from "./chain-client";
import { RpcError, RpcUnavailableError } from "./rpc-client";

/**
 * 节点说"这笔它已经知道了"的几种说法。第一个端点超时后换节点重发同一份 raw，
 * 第二个节点就会这么答——这是成功，不是失败。
 */
const ALREADY_KNOWN =
  /already known|known transaction|already exists|nonce too low|already imported/i;

/**
 * 一笔链上转出的完整编排：预检 → 构造 → 校验 → 签名提交 → nonce 记账。
 *
 * 三条刻意的设计：
 *
 * 1. **同一地址串行**。两笔并发会拿到同一个 nonce，后一笔要么替换前一笔、要么
 *    一直卡着。排队比事后解释便宜。
 * 2. **余额自己比，不靠节点报错**。`eth_estimateGas` 在余额不足时 revert，报文是
 *    `execution reverted: BEP20: transfer amount exceeds balance` 这种合约内部话，
 *    不能给用户看。所以先比余额，给出人话，够了才去估 gas。
 * 3. **手续费只为本地签名准备**。外部钱包自己算 nonce 和 gas（`managesOwnFees`），
 *    替它准备既浪费三次 RPC，也可能和它自己的取值冲突。
 */

/** `native` 是原生币的哨兵值，和 TokenRef 里的约定一致。 */
const NATIVE = "native";

/**
 * 一笔转账能用的 gas 上限。
 *
 * 原生币转账固定 21000，普通 ERC-20 约 35k～65k，带手续费 / 反射逻辑的代币也在
 * 200k 以内。估算值超过这个数，说明合约在 `transfer` 里做了不该做的事——恶意代币
 * 可以把 transfer 写成烧光调用方提供的全部 gas，用户的原生币就全成了手续费。
 * 这个上限和手续费红线是两道不同的防线：一道管单价，一道管用量。
 */
const TRANSFER_GAS_CEILING = 500_000n;

/**
 * 签名时的手续费比用户在确认页看到的报价高出太多。
 *
 * 确认页的报价和真正签名用的费用是两次独立询链——节点可以在报价时报低、签名时
 * 报高，用户看到 0.0001 却签了 0.5。所以调用方把用户看到的数带进来，超出容差
 * 就拒绝，让用户重新确认。
 */
export class FeeChangedError extends Error {
  constructor(
    readonly quoted: bigint,
    readonly actual: bigint,
  ) {
    super(`fee rose from ${quoted} to ${actual} since it was quoted`);
    this.name = "FeeChangedError";
  }
}

/** 签名费允许比报价高出的比例（1/4）：正常波动以内，超出就要用户重新看一眼。 */
const FEE_DRIFT_TOLERANCE = { numerator: 5n, denominator: 4n };

/** 合约在转账里消耗的 gas 异常。这不是网络问题，重试不会好。 */
export class TransferGasAnomalyError extends Error {
  constructor(
    readonly tokenSymbol: string,
    readonly estimated: bigint,
  ) {
    super(`transfer of ${tokenSymbol} would need ${estimated} gas`);
    this.name = "TransferGasAnomalyError";
  }
}

export class InsufficientBalanceError extends Error {
  constructor(
    readonly symbol: string,
    readonly required: bigint,
    readonly available: bigint,
  ) {
    super(`insufficient ${symbol}`);
    this.name = "InsufficientBalanceError";
  }
}

/**
 * 有代币但没有原生币付手续费。
 *
 * 单独一个类型是因为它是这类 App 最高频的用户困惑："我有 USDT，为什么转不了"。
 * UI 必须能把它和"余额不足"分开讲。
 */
export class InsufficientGasError extends Error {
  constructor(
    readonly nativeSymbol: string,
    readonly required: bigint,
    readonly available: bigint,
  ) {
    super(`insufficient ${nativeSymbol} for gas`);
    this.name = "InsufficientGasError";
  }
}

export type TransferRequest = {
  from: string;
  to: string;
  chainId: number;
  /** 合约地址，原生币传 `native` */
  tokenAddress: string;
  tokenSymbol: string;
  nativeSymbol: string;
  /** 最小单位（wei / token 的最小精度） */
  amount: bigint;
  /**
   * 用户在确认页看到并接受的手续费（wei）。本地签名时实际费用不得明显超过它。
   * 外部钱包自己展示费用，不需要这个字段。
   */
  maxFeeWei?: bigint;
};

export type SubmittedTransfer = {
  hash: string;
  /** 本地签名时用掉的 nonce；外部钱包返回 undefined（它自己决定） */
  nonce?: number;
};

type TransferDeps = {
  chain: ChainClient;
  /** 展示在系统验证弹窗 / 外部钱包里的说明，已 i18n */
  reason: string;
};

export class TransferService {
  /** 每个地址一条队列：同时只允许一笔在途，避免 nonce 相撞 */
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(private readonly deps: TransferDeps) {}

  /**
   * @param signer 由调用方按账户解析后传入——同一个服务实例会服务多个账户，
   *   而外部钱包的签名器解析本身可能要先恢复连接，不适合固定在构造时。
   */
  async submit(
    request: TransferRequest,
    signer: WalletSigner,
  ): Promise<SubmittedTransfer> {
    return this.serialize(request.from, () => this.run(request, signer));
  }

  /** 估算这笔转账要花多少原生币做手续费，供 UI 在输入阶段就提示。 */
  async estimateFee(request: TransferRequest): Promise<bigint> {
    const { gasLimit, maxFeePerGas } = await this.quoteGas(request);
    return gasLimit * maxFeePerGas;
  }

  /**
   * 原生币"全部转出"的上限：余额减去手续费。
   * 不减就是必然失败，而用户会反复重试。
   */
  async maxNativeAmount(request: TransferRequest): Promise<bigint> {
    const balance = await this.deps.chain.getNativeBalance(request.from);
    const fee = await this.estimateFee({ ...request, amount: 1n });
    return balance > fee ? balance - fee : 0n;
  }

  private serialize<T>(address: string, task: () => Promise<T>): Promise<T> {
    const key = address.toLowerCase();
    const previous = this.queues.get(key) ?? Promise.resolve();
    // 前一笔失败不该堵住后一笔，所以 catch 掉再接
    const next = previous.catch(() => undefined).then(task);
    this.queues.set(
      key,
      next.catch(() => undefined),
    );
    return next;
  }

  private isNative(request: TransferRequest): boolean {
    return request.tokenAddress === NATIVE;
  }

  private callData(request: TransferRequest): {
    to: string;
    value?: bigint;
    data?: string;
  } {
    if (this.isNative(request))
      return { to: request.to, value: request.amount };
    return {
      // ERC-20 转账是调合约，收款地址在 calldata 里
      to: request.tokenAddress,
      value: 0n,
      data: ChainClient.transferData(request.to, request.amount),
    };
  }

  private async quoteGas(request: TransferRequest): Promise<{
    gasLimit: bigint;
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
  }> {
    const target = this.callData(request);
    const [gasLimit, fee] = await Promise.all([
      this.deps.chain.estimateGas({
        from: request.from,
        to: target.to,
        value: target.value,
        data: target.data,
      }),
      this.deps.chain.getFeeData(),
    ]);
    if (gasLimit > TRANSFER_GAS_CEILING)
      throw new TransferGasAnomalyError(request.tokenSymbol, gasLimit);
    return { gasLimit, ...fee };
  }

  /**
   * 余额预检分两步，中间夹着 gas 估算：
   * 1. 先比"有没有这么多币"——这一步不需要 gas，而且必须在 `eth_estimateGas`
   *    之前做：余额不足时节点会 revert，报文是合约内部话，给不了用户人话；
   * 2. 估完 gas 再比"付不付得起手续费"。
   */
  private async assertHoldsAmount(
    request: TransferRequest,
  ): Promise<{ native: bigint }> {
    const native = await this.deps.chain.getNativeBalance(request.from);
    if (this.isNative(request)) {
      if (native < request.amount)
        throw new InsufficientBalanceError(
          request.tokenSymbol,
          request.amount,
          native,
        );
      return { native };
    }
    const balances = await this.deps.chain.getTokenBalances(request.from, [
      request.tokenAddress,
    ]);
    const held = balances.get(request.tokenAddress.toLowerCase()) ?? 0n;
    if (held < request.amount)
      throw new InsufficientBalanceError(
        request.tokenSymbol,
        request.amount,
        held,
      );
    return { native };
  }

  private assertCoversFee(
    request: TransferRequest,
    native: bigint,
    feeCost: bigint,
  ): void {
    if (this.isNative(request)) {
      // 原生币转账：金额和手续费出自同一个余额
      const required = request.amount + feeCost;
      if (native < required)
        throw new InsufficientBalanceError(
          request.tokenSymbol,
          required,
          native,
        );
      return;
    }
    if (native < feeCost)
      throw new InsufficientGasError(request.nativeSymbol, feeCost, native);
  }

  /**
   * 广播，并把"结果不明"变成"确定"。
   *
   * 端点 A 收下了却没在超时前回话，客户端换到端点 B 重发同一份 raw，B 答
   * "already known"；或者所有端点都超时。这两种情况下交易很可能已经在链上，
   * 报成失败会诱导用户重试——第二笔就真的发出去了。所以结果不明时问一句节点
   * 认不认识这个 hash，认识就是成功。
   */
  private async broadcastResolved(
    raw: string,
    expected: string,
  ): Promise<void> {
    try {
      const reported = await this.deps.chain.broadcast(raw);
      if (reported?.toLowerCase() !== expected.toLowerCase())
        console.warn(
          `[chain] 节点返回的 txHash 与本地计算不一致，以本地为准：${reported}`,
        );
      return;
    } catch (error) {
      const ambiguous =
        error instanceof RpcUnavailableError ||
        (error instanceof RpcError && ALREADY_KNOWN.test(error.detail ?? ""));
      if (!ambiguous) throw error;
      const known = await this.deps.chain
        .hasTransaction(expected)
        .catch(() => false);
      if (!known) throw error;
      console.warn("[chain] 广播结果不明，但节点已认识这笔交易，按已提交处理");
    }
  }

  private async run(
    request: TransferRequest,
    signer: WalletSigner,
  ): Promise<SubmittedTransfer> {
    const target = this.callData(request);
    const context: SignRequestContext = { reason: this.deps.reason };

    if (signer.managesOwnFees) {
      // 钱包自己算 nonce 与手续费；我们只交出意图。
      // chainId / 收款地址的体检在编排层也做一次，不依赖每个签名器实现自觉
      assertSubmittable({
        chainId: request.chainId,
        from: request.from,
        ...target,
      });
      const hash = await signer.submitTransaction(
        { chainId: request.chainId, from: request.from, ...target },
        context,
        async () => {
          throw new Error("external wallet broadcasts on its own");
        },
      );
      return { hash };
    }

    const { native } = await this.assertHoldsAmount(request);
    const gas = await this.quoteGas(request);
    const feeCost = gas.gasLimit * gas.maxFeePerGas;
    if (
      request.maxFeeWei !== undefined &&
      feeCost * FEE_DRIFT_TOLERANCE.denominator >
        request.maxFeeWei * FEE_DRIFT_TOLERANCE.numerator
    )
      throw new FeeChangedError(request.maxFeeWei, feeCost);
    this.assertCoversFee(request, native, feeCost);
    const nonce = await this.deps.chain.getNextNonce(request.from);
    const transaction = {
      chainId: request.chainId,
      from: request.from,
      ...target,
      nonce,
      gasLimit: gas.gasLimit,
      maxFeePerGas: gas.maxFeePerGas,
      maxPriorityFeePerGas: gas.maxPriorityFeePerGas,
    };
    // 最后一道：ethers 缺字段不报错，会签出 nonce=0 的废交易
    assertLocallySignable(transaction);
    const hash = await signer.submitTransaction(
      transaction,
      context,
      async (raw) => {
        // txHash 由签名后的原文决定，本地就能算出来，不必信节点的回答。
        // 节点返回另一笔交易的 hash 时，界面会去追踪一笔不是我们的交易。
        const expected = Transaction.from(raw).hash;
        if (!expected)
          throw new RpcError("signed transaction has no hash", undefined);
        await this.broadcastResolved(raw, expected);
        return expected;
      },
    );
    // 广播成功才占用这个 nonce；失败时留给下一笔重用
    this.deps.chain.noteNonceUsed(request.from, nonce);
    return { hash, nonce };
  }
}
