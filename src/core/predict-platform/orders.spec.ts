import { Wallet, getAddress, verifyTypedData, type HDNodeWallet } from "ethers";
import type { WalletSigner } from "../wallet/signer/types";
import {
  ORDER_TYPES,
  OrderRejectedError,
  orderDomain,
  orderValue,
  postOrder,
  signOrder,
  type OrderDraft,
} from "./orders";
import { setPlatformFetch } from "./tenant-client";

const SCOPE = `0x${"fb".repeat(32)}`;
const EXCHANGE = getAddress(`0x${"e1".repeat(20)}`);
const SAFE = getAddress(`0x${"5a".repeat(20)}`);
const service = {
  domain: "predict.prax1s.xyz",
  scopeId: SCOPE,
  chain: "op-sepolia" as const,
};

function signerFor(wallet: HDNodeWallet): WalletSigner {
  return {
    address: wallet.address,
    managesOwnFees: false,
    signMessage: (message) => wallet.signMessage(message),
    signTypedData: (domain, types, value) =>
      wallet.signTypedData(domain, types, value),
    submitTransaction: async () => {
      throw new Error("not used");
    },
  };
}

function draft(over: Partial<OrderDraft> = {}): OrderDraft {
  return {
    chainId: 11155420,
    exchange: EXCHANGE,
    scopeId: SCOPE,
    safe: SAFE,
    tokenId: "111",
    side: "BUY",
    makerAmount: 9_994_400n,
    takerAmount: 16_120_000n,
    feeRateBps: 20,
    orderType: "FAK",
    expirationSeconds: 0,
    salt: 12345n,
    ...over,
  };
}

afterEach(() => setPlatformFetch(null));

describe("order signing", () => {
  it("signs the 13-field Order against the exchange domain with maker = Safe and signer = EOA", async () => {
    const wallet = Wallet.createRandom();
    const signed = await signOrder(draft(), signerFor(wallet), {
      reason: "test",
    });
    expect(signed).toMatchObject({
      salt: "12345",
      maker: SAFE,
      signer: wallet.address,
      taker: "0x0000000000000000000000000000000000000000",
      tokenID: "111",
      makerAmount: "9994400",
      takerAmount: "16120000",
      expiration: "0",
      nonce: "0",
      feeRateBps: "20",
      side: "BUY",
      signatureType: "2",
      scopeId: SCOPE,
    });
    expect(ORDER_TYPES.Order?.map((field) => field.name)).toEqual([
      "salt",
      "maker",
      "signer",
      "taker",
      "tokenId",
      "makerAmount",
      "takerAmount",
      "expiration",
      "nonce",
      "feeRateBps",
      "side",
      "signatureType",
      "scopeId",
    ]);
    expect(
      verifyTypedData(
        orderDomain(11155420, EXCHANGE),
        ORDER_TYPES,
        orderValue(draft(), wallet.address),
        signed.signature,
      ),
    ).toBe(wallet.address);
    expect(orderDomain(11155420, EXCHANGE)).toEqual({
      name: "Prediction Market Protocol",
      version: "1",
      chainId: 11155420,
      verifyingContract: EXCHANGE,
    });
  });

  it("puts the expiration only on GTD orders and refuses a GTD without one", () => {
    const gtd = orderValue(
      draft({ orderType: "GTD", expirationSeconds: 1_800_000_000 }),
      SAFE,
    );
    expect(gtd.expiration).toBe(1_800_000_000n);
    expect(orderValue(draft({ orderType: "GTC" }), SAFE).expiration).toBe(0n);
    expect(orderValue(draft({ side: "SELL" }), SAFE).side).toBe(1);
    expect(() => orderValue(draft({ orderType: "GTD" }), SAFE)).toThrow(
      /expiration/,
    );
  });
});

describe("postOrder", () => {
  it("posts {order, orderType, deferExec, postOnly} with L2 headers signed over path + body", async () => {
    let captured: { body: string; headers: Record<string, string> } | null =
      null;
    setPlatformFetch(async (input, init) => {
      const url = new URL(String(input));
      const json = (body: unknown) =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      if (url.pathname === "/time") return json(1_800_000_000);
      captured = {
        body: String(init?.body),
        headers: (init?.headers ?? {}) as Record<string, string>,
      };
      return json({
        success: true,
        orderID: "o-9",
        takingAmount: "16.12",
        makingAmount: "9.9944",
        status: "matched",
        transactionsHashes: [],
        tradeIDs: ["t-1"],
      });
    });
    const wallet = Wallet.createRandom();
    const signed = await signOrder(draft(), signerFor(wallet), { reason: "t" });
    const result = await postOrder(
      service,
      {
        credentials: { apiKey: "key", secret: "c2VjcmV0", passphrase: "pass" },
        address: wallet.address,
      },
      signed,
      "FAK",
    );
    expect(result.orderID).toBe("o-9");
    expect(result.status).toBe("matched");
    const sent = captured as unknown as {
      body: string;
      headers: Record<string, string>;
    };
    expect(JSON.parse(sent.body)).toEqual({
      order: signed,
      orderType: "FAK",
      deferExec: false,
      postOnly: false,
    });
    expect(sent.headers.PRED_API_KEY).toBe("key");
    expect(sent.headers.PRED_ADDRESS).toBe(wallet.address);
    expect(sent.headers.PRED_TIMESTAMP).toBe("1800000000");
    expect(sent.headers.PRED_SIGNATURE).toBeDefined();
  });

  it("turns success=false into OrderRejectedError carrying the platform message", async () => {
    setPlatformFetch(async (input) => {
      const url = new URL(String(input));
      const json = (body: unknown) =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      if (url.pathname === "/time") return json(1_800_000_000);
      return json({
        success: false,
        errorMsg: "INSUFFICIENT_BALANCE",
        orderID: "",
        status: "",
      });
    });
    const wallet = Wallet.createRandom();
    const signed = await signOrder(draft(), signerFor(wallet), { reason: "t" });
    await expect(
      postOrder(
        service,
        {
          credentials: { apiKey: "k", secret: "c2VjcmV0", passphrase: "p" },
          address: wallet.address,
        },
        signed,
        "FAK",
      ),
    ).rejects.toMatchObject({
      name: "OrderRejectedError",
      message: "INSUFFICIENT_BALANCE",
    });
    expect(new OrderRejectedError("x", "m")).toBeInstanceOf(Error);
  });
});
