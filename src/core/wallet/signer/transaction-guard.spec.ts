import {
  maxFeePerGasCeiling,
  UnsignableTransactionError,
  assertLocallySignable,
  assertSubmittable,
} from "./transaction-guard";
import type { EvmTransactionRequest } from "./types";
import { Interface } from "ethers";
import { ZERO_ADDRESS } from "./calldata";
import { evmChainIdOf } from "../config/wallet-runtime-config";
import type { ChainId } from "../../gateways/types";

const erc20 = new Interface([
  "function approve(address spender, uint256 value)",
  "function transfer(address to, uint256 value)",
]);

// Record<ChainId, true> 让"往 ChainId 联合里加一条链却忘了在这里列出来"
// 直接变成类型错误，而不是一条悄悄退回默认红线的链
const SUPPORTED_CHAINS: Record<ChainId, true> = {
  bsc: true,
  eth: true,
  base: true,
  "op-sepolia": true,
  monad: true,
};
const CHAIN_IDS = (Object.keys(SUPPORTED_CHAINS) as ChainId[]).map(
  evmChainIdOf,
);

const TO = "0x000000000000000000000000000000000000dEaD";

function complete(
  overrides: Partial<EvmTransactionRequest> = {},
): EvmTransactionRequest {
  return {
    chainId: 56,
    to: TO,
    value: 1_000_000_000_000_000n,
    nonce: 7,
    gasLimit: 21_000n,
    maxFeePerGas: 3_000_000_000n,
    maxPriorityFeePerGas: 1_000_000_000n,
    ...overrides,
  };
}

describe("assertLocallySignable", () => {
  it("accepts a fully specified EIP-1559 transaction", () => {
    expect(() => assertLocallySignable(complete())).not.toThrow();
  });

  it("refuses a missing nonce instead of letting ethers default it to 0", () => {
    // 这是这个模块存在的理由：ethers 缺 nonce 不报错，会签出 nonce=0 的交易，
    // 那可能重放一笔很久以前的交易
    const { nonce: _nonce, ...withoutNonce } = complete();
    void _nonce;

    expect(() => assertLocallySignable(withoutNonce)).toThrow(
      UnsignableTransactionError,
    );
    expect(() => assertLocallySignable(withoutNonce)).toThrow(/nonce/);
  });

  it("refuses a missing gasLimit", () => {
    const { gasLimit: _gasLimit, ...rest } = complete();
    void _gasLimit;
    expect(() => assertLocallySignable(rest)).toThrow(/gasLimit/);
  });

  it("refuses missing fee fields", () => {
    const { maxFeePerGas: _fee, ...noFee } = complete();
    void _fee;
    expect(() => assertLocallySignable(noFee)).toThrow(/maxFeePerGas/);

    const { maxPriorityFeePerGas: _tip, ...noTip } = complete();
    void _tip;
    expect(() => assertLocallySignable(noTip)).toThrow(/maxPriorityFeePerGas/);
  });

  it("refuses a priority fee above the max fee", () => {
    expect(() =>
      assertLocallySignable(complete({ maxPriorityFeePerGas: 4_000_000_000n })),
    ).toThrow(/不能大于/);
  });

  it("refuses an absurd fee that would burn the whole balance", () => {
    // 10001 Gwei：以太坊历史峰值都没到这个量级，只可能是算错或被篡改
    expect(() =>
      assertLocallySignable(
        complete({ maxFeePerGas: 10_001n * 1_000_000_000n }),
      ),
    ).toThrow(/手续费高得不合理/);
  });

  it("refuses a zero gas limit", () => {
    expect(() => assertLocallySignable(complete({ gasLimit: 0n }))).toThrow(
      /gasLimit/,
    );
  });
});

describe("assertSubmittable", () => {
  it("does not require nonce or fees, because the external wallet fills them", () => {
    expect(() =>
      assertSubmittable({ chainId: 8453, to: TO, value: 1n }),
    ).not.toThrow();
  });

  it("refuses a missing or nonsensical chainId", () => {
    expect(() => assertSubmittable({ to: TO, value: 1n } as never)).toThrow(
      /chainId/,
    );
    expect(() => assertSubmittable({ chainId: 0, to: TO, value: 1n })).toThrow(
      /chainId/,
    );
  });

  it("refuses a malformed recipient", () => {
    expect(() =>
      assertSubmittable({ chainId: 56, to: "0xnope", value: 1n }),
    ).toThrow(/收款地址/);
  });

  it("accepts an all-lowercase address, which exchanges commonly hand out", () => {
    expect(() =>
      assertSubmittable({
        chainId: 56,
        to: TO.toLowerCase(),
        value: 1n,
      }),
    ).not.toThrow();
  });

  it("refuses an address whose EIP-55 checksum is wrong", () => {
    // 混合大小写就意味着带校验和；校验和错了通常是手抄错了一个字符
    const tampered = `0xf977814e90DA44bFA03b6295A0616a897441aceD`;
    expect(() =>
      assertSubmittable({ chainId: 56, to: tampered, value: 1n }),
    ).toThrow(/收款地址/);
  });

  it("refuses a transaction that neither transfers nor calls anything", () => {
    expect(() => assertSubmittable({ chainId: 56, to: TO })).toThrow(
      /既没有转账金额也没有调用数据/,
    );
  });
});

describe("per-chain fee ceiling", () => {
  const GWEI = 1_000_000_000n;

  it("is far lower on BSC than on Ethereum, because normal fees are", () => {
    // 与链无关的 10000 Gwei 对 BSC 是三千倍常态，恶意节点一笔就能烧掉 0.6 BNB
    expect(maxFeePerGasCeiling(56)).toBeLessThan(maxFeePerGasCeiling(1));
    expect(maxFeePerGasCeiling(56)).toBeLessThanOrEqual(200n * GWEI);
  });

  it("rejects a BSC fee that Ethereum would still accept", () => {
    const fee = 500n * GWEI;
    expect(() =>
      assertLocallySignable({
        chainId: 56,
        to: "0x000000000000000000000000000000000000dEaD",
        value: 1n,
        nonce: 1,
        gasLimit: 21_000n,
        maxFeePerGas: fee,
        maxPriorityFeePerGas: fee,
      }),
    ).toThrow(/手续费高得不合理/);
    expect(() =>
      assertLocallySignable({
        chainId: 1,
        to: "0x000000000000000000000000000000000000dEaD",
        value: 1n,
        nonce: 1,
        gasLimit: 21_000n,
        maxFeePerGas: fee,
        maxPriorityFeePerGas: fee,
      }),
    ).not.toThrow();
  });

  it("falls back to the generic red line for a chain it does not know", () => {
    expect(maxFeePerGasCeiling(999_999)).toBe(10_000n * GWEI);
  });

  // 评审 N22 记的是"费率表仅 4 条链"。加一条链却忘了给它红线，表现是那条链
  // 静默退回 10000 Gwei——对 BSC 那是三千倍常态。这条断言让"忘了"变成构建失败。
  it("gives every supported chain its own ceiling instead of the fallback", () => {
    const withoutCeiling = CHAIN_IDS.filter(
      (chainId) => maxFeePerGasCeiling(chainId) === 10_000n * GWEI,
    );
    expect(withoutCeiling).toEqual([]);
  });
});

describe("assertSubmittable decodes the calldata", () => {
  it("refuses an allowance handed to the zero address", () => {
    // 撤销是把额度设成 0；把额度给零地址只会是参数拼错或被改过（N22）
    expect(() =>
      assertSubmittable(
        complete({
          value: undefined,
          data: erc20.encodeFunctionData("approve", [ZERO_ADDRESS, 1n]),
        }),
      ),
    ).toThrow(UnsignableTransactionError);
  });

  it("refuses a transfer that would burn the tokens", () => {
    expect(() =>
      assertSubmittable(
        complete({
          value: undefined,
          data: erc20.encodeFunctionData("transfer", [ZERO_ADDRESS, 1n]),
        }),
      ),
    ).toThrow(/销毁/);
  });

  it("leaves a normal approval and unknown calldata alone", () => {
    // 看不懂不等于危险：解不开就不拦，否则就是拒绝服务
    for (const data of [
      erc20.encodeFunctionData("approve", [TO, 1n]),
      "0xdeadbeefdeadbeef",
    ])
      expect(() =>
        assertSubmittable(complete({ value: undefined, data })),
      ).not.toThrow();
  });
});
