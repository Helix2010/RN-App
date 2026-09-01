import {
  UnsignableTransactionError,
  assertLocallySignable,
  assertSubmittable,
} from "./transaction-guard";
import type { EvmTransactionRequest } from "./types";

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
