import { Transaction } from "ethers";
import type { SignRequestContext, WalletSigner } from "../wallet/signer/types";
import {
  assertLocallySignable,
  assertSubmittable,
} from "../wallet/signer/transaction-guard";
import { broadcastResolved } from "./broadcast";
import type { ChainClient } from "./chain-client";
import { RpcError } from "./rpc-client";
import { InsufficientGasError } from "./transfer-service";

/**
 * 一笔任意合约调用的编排：估 gas → 查原生币够不够手续费 → 签名提交 → nonce 记账。
 *
 * 与 `TransferService` 同一套纪律（同地址串行、余额自己比、手续费只为本地签名准备），
 * 差别只在这里不知道调用的语义：代币余额够不够由业务层判断，这里只保证付得起手续费。
 * 用途：预测平台的转入（approve + wrap）等合约交互。
 */

/**
 * 单笔调用的 gas 上限。approve 约 5 万，wrap（转入金库 + 铸币）十几万；超过这个数
 * 说明合约在做不该做的事，用户的原生币会全成手续费。
 */
const CALL_GAS_CEILING = 1_000_000n;

export class CallGasAnomalyError extends Error {
  constructor(
    readonly label: string,
    readonly estimated: bigint,
  ) {
    super(`${label} would need ${estimated} gas`);
    this.name = "CallGasAnomalyError";
  }
}

export type ContractCall = {
  from: string;
  to: string;
  chainId: number;
  data: string;
  value?: bigint;
  /** 手续费提示与错误里用的原生币符号 */
  nativeSymbol: string;
  /** 出错时给人看的名字，如 "approve USDC" */
  label: string;
};

export type SubmittedCall = { hash: string; nonce?: number };

export class ContractCallService {
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(private readonly deps: { chain: ChainClient; reason: string }) {}

  async submit(
    call: ContractCall,
    signer: WalletSigner,
  ): Promise<SubmittedCall> {
    return this.serialize(call.from, () => this.run(call, signer));
  }

  /** 这笔调用要花多少原生币做手续费。 */
  async estimateFee(call: ContractCall): Promise<bigint> {
    const gas = await this.quoteGas(call);
    return gas.gasLimit * gas.maxFeePerGas;
  }

  private serialize<T>(address: string, task: () => Promise<T>): Promise<T> {
    const key = address.toLowerCase();
    const previous = this.queues.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(task);
    this.queues.set(
      key,
      next.catch(() => undefined),
    );
    return next;
  }

  private async quoteGas(call: ContractCall) {
    const [gasLimit, fee] = await Promise.all([
      this.deps.chain.estimateGas({
        from: call.from,
        to: call.to,
        value: call.value,
        data: call.data,
      }),
      this.deps.chain.getFeeData(),
    ]);
    if (gasLimit > CALL_GAS_CEILING)
      throw new CallGasAnomalyError(call.label, gasLimit);
    return { gasLimit, ...fee };
  }

  private async run(
    call: ContractCall,
    signer: WalletSigner,
  ): Promise<SubmittedCall> {
    const context: SignRequestContext = { reason: this.deps.reason };
    const target = { to: call.to, value: call.value ?? 0n, data: call.data };
    if (signer.managesOwnFees) {
      assertSubmittable({ chainId: call.chainId, from: call.from, ...target });
      const hash = await signer.submitTransaction(
        { chainId: call.chainId, from: call.from, ...target },
        context,
        async () => {
          throw new Error("external wallet broadcasts on its own");
        },
      );
      return { hash };
    }
    const native = await this.deps.chain.getNativeBalance(call.from);
    const gas = await this.quoteGas(call);
    const feeCost = gas.gasLimit * gas.maxFeePerGas;
    const required = feeCost + (call.value ?? 0n);
    if (native < required)
      throw new InsufficientGasError(call.nativeSymbol, required, native);
    const nonce = await this.deps.chain.getNextNonce(call.from);
    const transaction = {
      chainId: call.chainId,
      from: call.from,
      ...target,
      nonce,
      gasLimit: gas.gasLimit,
      maxFeePerGas: gas.maxFeePerGas,
      maxPriorityFeePerGas: gas.maxPriorityFeePerGas,
    };
    assertLocallySignable(transaction);
    const hash = await signer.submitTransaction(
      transaction,
      context,
      async (raw) => {
        const expected = Transaction.from(raw).hash;
        if (!expected)
          throw new RpcError("signed transaction has no hash", undefined);
        await broadcastResolved(this.deps.chain, raw, expected);
        return expected;
      },
    );
    this.deps.chain.noteNonceUsed(call.from, nonce);
    return { hash, nonce };
  }
}
