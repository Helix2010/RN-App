import { RpcError, RpcUnavailableError } from "../../../core/chain/rpc-client";
import {
  InsufficientBalanceError,
  InsufficientGasError,
} from "../../../core/chain/transfer-service";
import { UnsignableTransactionError } from "../../../core/wallet/signer/transaction-guard";
import {
  WalletAuthRequiredError,
  WalletVaultError,
} from "../../../core/wallet/vault/keystore-vault";
import { transferErrorCopy } from "./transfer-errors";

describe("transferErrorCopy", () => {
  it("tells 'no gas' apart from 'no balance', and names the coin to top up", () => {
    // 这两个原因要用户做的事完全不同：一个去充 BNB，一个改金额
    expect(
      transferErrorCopy(new InsufficientGasError("BNB", 100n, 0n)),
    ).toEqual({
      key: "send.error.gas",
      values: { symbol: "BNB" },
    });
    expect(
      transferErrorCopy(new InsufficientBalanceError("USDT", 100n, 1n)),
    ).toEqual({ key: "send.error.balance", values: { symbol: "USDT" } });
  });

  it("separates 'cannot reach any node' from 'the node refused this transaction'", () => {
    // 前者重试可能成功，后者重试还是一样
    expect(transferErrorCopy(new RpcUnavailableError(2)).key).toBe(
      "send.error.network",
    );
    expect(
      transferErrorCopy(new RpcError("execution reverted", 3, "BEP20: ..."))
        .key,
    ).toBe("send.error.node");
  });

  it("never shows the node's raw wording to the user", () => {
    const copy = transferErrorCopy(
      new RpcError("rpc error", 3, "execution reverted: BEP20: no balance"),
    );
    expect(JSON.stringify(copy)).not.toContain("BEP20");
  });

  it("distinguishes a cancelled verification from a failed one", () => {
    expect(
      transferErrorCopy(new WalletAuthRequiredError("cancelled")).key,
    ).toBe("send.error.rejected");
    expect(transferErrorCopy(new WalletAuthRequiredError("failed")).key).toBe(
      "send.error.authFailed",
    );
  });

  it("classifies the external wallet's own outcomes by error name", () => {
    // 按 name 而不是 instanceof：不能把 WalletConnect SDK 拖进转出界面的模块图
    const rejected = new Error("User rejected the request");
    rejected.name = "WalletConnectRejectedError";
    const timeout = new Error("wallet approval timeout");
    timeout.name = "WalletConnectTimeoutError";

    expect(transferErrorCopy(rejected).key).toBe("send.error.rejected");
    expect(transferErrorCopy(timeout).key).toBe("send.error.timeout");
  });

  it("tells the user this device cannot sign for that account", () => {
    // 真实签名路径会抛它（记录被删 / 密文解不开），落到兜底文案就只剩"转出失败"，
    // 而用户要做的其实是重新导入钱包
    expect(
      transferErrorCopy(new WalletVaultError("account is not in this vault"))
        .key,
    ).toBe("send.error.noKey");
  });

  it("says nothing was sent when the local guard blocked signing", () => {
    expect(
      transferErrorCopy(new UnsignableTransactionError("nonce is missing")).key,
    ).toBe("send.error.unsafe");
  });

  it("falls back to the generic failure for anything unrecognised", () => {
    expect(transferErrorCopy(new Error("boom")).key).toBe("send.failed");
    expect(transferErrorCopy("boom").key).toBe("send.failed");
    expect(transferErrorCopy(undefined).key).toBe("send.failed");
  });
});
