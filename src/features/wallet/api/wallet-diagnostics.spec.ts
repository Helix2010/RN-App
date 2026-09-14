import { clearLogs, snapshotLogs } from "../../../core/diagnostics/log-buffer";
import type { WalletGateway } from "./gateway";
import { withWalletDiagnostics } from "./wallet-diagnostics";

const RECIPIENT = "0x71C7656EC7ab88b098defB751B7401B5f6d8976F";

class UnsignableTransactionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsignableTransactionError";
  }
}
class WalletPassphraseRequiredError extends Error {
  constructor() {
    super("passphrase required");
    this.name = "WalletPassphraseRequiredError";
  }
}

function fakeGateway(overrides: Record<string, unknown>): WalletGateway {
  return { ...overrides } as unknown as WalletGateway;
}

beforeEach(() => clearLogs());

describe("withWalletDiagnostics", () => {
  it("records the operation, error class and chain — never the message, address or amount", async () => {
    const gateway = withWalletDiagnostics(
      fakeGateway({
        send: async () => {
          throw new UnsignableTransactionError(`收款地址不合法：${RECIPIENT}`);
        },
      }),
    );

    await expect(
      gateway.send({
        from: "0x1111111111111111111111111111111111111111",
        to: RECIPIENT,
        token: {
          chain: "base",
          address: "0x2222222222222222222222222222222222222222",
          symbol: "USDC",
          name: "USD Coin",
          decimals: 6,
        },
        amount: { value: "123456", decimals: 6 },
      } as unknown as Parameters<WalletGateway["send"]>[0]),
    ).rejects.toThrow(UnsignableTransactionError);

    expect(snapshotLogs()).toEqual([
      expect.objectContaining({
        level: "error",
        tag: "wallet",
        message: "operation failed",
        fields: {
          op: "send",
          error: "UnsignableTransactionError",
          chain: "base",
        },
      }),
    ]);
    const logged = JSON.stringify(snapshotLogs());
    expect(logged).not.toContain(RECIPIENT);
    expect(logged).not.toContain("0x1111");
    expect(logged).not.toContain("123456");
    expect(logged).not.toContain("收款地址");
  });

  it("takes a bare chain id argument", async () => {
    const gateway = withWalletDiagnostics(
      fakeGateway({
        getBalances: async () => {
          throw new Error("rpc down");
        },
      }),
    );
    await expect(gateway.getBalances(RECIPIENT, "eth")).rejects.toThrow();
    expect(snapshotLogs()[0]?.fields).toEqual({
      op: "getBalances",
      error: "Error",
      chain: "eth",
    });
  });

  it("records an expected flow interruption as info, not as an error", async () => {
    const gateway = withWalletDiagnostics(
      fakeGateway({
        exportMnemonic: async () => {
          throw new WalletPassphraseRequiredError();
        },
      }),
    );
    await expect(
      (
        gateway as unknown as { exportMnemonic(): Promise<string> }
      ).exportMnemonic(),
    ).rejects.toThrow();
    expect(snapshotLogs()[0]?.level).toBe("info");
  });

  it("does not trust an error name that is not shaped like a class name", async () => {
    const error = new Error("x");
    error.name = `leak ${RECIPIENT}`;
    const gateway = withWalletDiagnostics(
      fakeGateway({
        listAccounts: async () => {
          throw error;
        },
      }),
    );
    await expect(gateway.listAccounts()).rejects.toThrow();
    expect(snapshotLogs()[0]?.fields?.error).toBe("unknown");
    expect(JSON.stringify(snapshotLogs())).not.toContain(RECIPIENT);
  });

  it("records synchronous throws too", () => {
    const gateway = withWalletDiagnostics(
      fakeGateway({
        rename: () => {
          throw new Error("sync");
        },
      }),
    );
    expect(() => gateway.rename(RECIPIENT, "label")).toThrow("sync");
    expect(snapshotLogs()[0]?.fields).toEqual({ op: "rename", error: "Error" });
  });

  it("records only the public operation, not the internal calls it makes", async () => {
    // 以 Proxy 为 this 调用的话，send 内部的 this.quote() 也会经过 Proxy，
    // 一次失败就会记成 quote + send 两条
    class Real {
      async quote(): Promise<never> {
        throw new Error("inner");
      }
      async send(): Promise<never> {
        return this.quote();
      }
    }
    const gateway = withWalletDiagnostics(
      new Real() as unknown as WalletGateway,
    );
    await expect(
      gateway.send({} as Parameters<WalletGateway["send"]>[0]),
    ).rejects.toThrow("inner");
    expect(snapshotLogs().map((entry) => entry.fields?.op)).toEqual(["send"]);
  });

  it("passes results and plain properties through untouched", async () => {
    const accounts = [{ address: "a" }];
    const gateway = withWalletDiagnostics(
      fakeGateway({ listAccounts: async () => accounts, version: 3 }),
    );
    await expect(gateway.listAccounts()).resolves.toBe(accounts);
    expect((gateway as unknown as { version: number }).version).toBe(3);
    expect(snapshotLogs()).toHaveLength(0);
  });
});
