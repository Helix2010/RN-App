import { Interface } from "ethers";
import {
  UNLIMITED_ALLOWANCE,
  ZERO_ADDRESS,
  describeCalldata,
  grantsAllowance,
  impossibleIntentReason,
  isUnlimitedAllowance,
} from "./calldata";

const SPENDER = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";
const RECIPIENT = "0x2B5AD5c4795c026514f8317c7a215E218DcCD6cF";

const abi = new Interface([
  "function approve(address spender, uint256 value)",
  "function setApprovalForAll(address operator, bool approved)",
  "function increaseAllowance(address spender, uint256 addedValue)",
  "function transfer(address to, uint256 value)",
  "function transferFrom(address from, address to, uint256 value)",
  "function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)",
  // 词表之外的调用：解码必须如实说"不认识"，而不是猜
  "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)",
]);
const encode = (name: string, args: unknown[]): string =>
  abi.encodeFunctionData(name, args);

describe("describeCalldata", () => {
  it("names the spender of an approve, which is what a confirm screen must show", () => {
    expect(describeCalldata(encode("approve", [SPENDER, 1_000n]))).toEqual({
      kind: "approve",
      spender: SPENDER,
      amount: 1_000n,
      unlimited: false,
    });
  });

  it("flags an unlimited approval", () => {
    const intent = describeCalldata(
      encode("approve", [SPENDER, UNLIMITED_ALLOWANCE]),
    );
    expect(intent).toMatchObject({ unlimited: true, spender: SPENDER });
    // 有些前端用 2^255-1 当"无限"，链上效果一样，不能只认 2^256-1
    expect(isUnlimitedAllowance((1n << 255n) - 1n)).toBe(true);
    expect(isUnlimitedAllowance((1n << 254n) - 1n)).toBe(false);
  });

  it("reads the spender out of permit, which sits at a different argument position", () => {
    // 回归：permit 的 spender 是第 2 个参数，approve 是第 1 个。取错位置会在
    // 确认界面上显示成钱包自己的地址，看起来完全正常
    const data = encode("permit", [
      RECIPIENT,
      SPENDER,
      500n,
      1893456000n,
      27,
      `0x${"11".repeat(32)}`,
      `0x${"22".repeat(32)}`,
    ]);
    expect(describeCalldata(data)).toEqual({
      kind: "permit",
      spender: SPENDER,
      amount: 500n,
      unlimited: false,
    });
  });

  it("reads setApprovalForAll in both directions", () => {
    expect(
      describeCalldata(encode("setApprovalForAll", [SPENDER, true])),
    ).toEqual({ kind: "setApprovalForAll", spender: SPENDER, approved: true });
    expect(
      describeCalldata(encode("setApprovalForAll", [SPENDER, false])),
    ).toMatchObject({ approved: false });
  });

  it("reads transfer and transferFrom", () => {
    expect(describeCalldata(encode("transfer", [RECIPIENT, 7n]))).toEqual({
      kind: "transfer",
      recipient: RECIPIENT,
      amount: 7n,
    });
    expect(
      describeCalldata(encode("transferFrom", [SPENDER, RECIPIENT, 7n])),
    ).toEqual({
      kind: "transferFrom",
      from: SPENDER,
      recipient: RECIPIENT,
      amount: 7n,
    });
  });

  it("says it does not know rather than guessing", () => {
    // 认不出来不等于安全，只等于"这里给不出解释"
    expect(
      describeCalldata(
        encode("swapExactTokensForTokens", [
          1n,
          1n,
          [SPENDER, RECIPIENT],
          RECIPIENT,
          1n,
        ]),
      ),
    ).toBeNull();
    for (const data of [undefined, "", "0x", "0xdeadbeef", "0x095ea7b3"])
      expect(describeCalldata(data)).toBeNull();
  });

  it("does not throw on a truncated or malformed body", () => {
    // 解不开就不拦：把"看不懂"变成拒绝就是拒绝服务
    const good = encode("approve", [SPENDER, 1n]);
    expect(describeCalldata(good.slice(0, good.length - 8))).toBeNull();
  });
});

describe("grantsAllowance", () => {
  it("separates giving control away from moving money", () => {
    const allowance = [
      encode("approve", [SPENDER, 1n]),
      encode("increaseAllowance", [SPENDER, 1n]),
      encode("setApprovalForAll", [SPENDER, true]),
    ];
    for (const data of allowance)
      expect(grantsAllowance(describeCalldata(data))).toBe(true);
    // 撤销不是授权
    expect(
      grantsAllowance(
        describeCalldata(encode("setApprovalForAll", [SPENDER, false])),
      ),
    ).toBe(false);
    expect(
      grantsAllowance(describeCalldata(encode("transfer", [RECIPIENT, 1n]))),
    ).toBe(false);
    expect(grantsAllowance(null)).toBe(false);
  });
});

describe("impossibleIntentReason", () => {
  it("catches an allowance handed to the zero address", () => {
    // 撤销是把额度设成 0，不是把额度给零地址——这种只会是参数拼错或被改过
    expect(
      impossibleIntentReason(
        describeCalldata(encode("approve", [ZERO_ADDRESS, 1n])),
      ),
    ).toMatch(/零地址/);
    expect(
      impossibleIntentReason(
        describeCalldata(encode("setApprovalForAll", [ZERO_ADDRESS, true])),
      ),
    ).toMatch(/零地址/);
  });

  it("catches a transfer that would burn the tokens", () => {
    expect(
      impossibleIntentReason(
        describeCalldata(encode("transfer", [ZERO_ADDRESS, 1n])),
      ),
    ).toMatch(/销毁/);
    expect(
      impossibleIntentReason(
        describeCalldata(encode("transferFrom", [SPENDER, ZERO_ADDRESS, 1n])),
      ),
    ).toMatch(/销毁/);
  });

  it("leaves legitimate calls alone", () => {
    for (const data of [
      encode("approve", [SPENDER, 1n]),
      // 把零地址的额度设成 0 是无意义但无害的，不拦
      encode("approve", [ZERO_ADDRESS, 0n]),
      encode("setApprovalForAll", [ZERO_ADDRESS, false]),
      encode("transfer", [RECIPIENT, 1n]),
    ])
      expect(impossibleIntentReason(describeCalldata(data))).toBeNull();
    expect(impossibleIntentReason(null)).toBeNull();
  });
});
