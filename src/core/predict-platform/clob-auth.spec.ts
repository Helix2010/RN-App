import { createHmac } from "node:crypto";
import { Wallet, verifyTypedData } from "ethers";
import { clobAuthTypedData, l2Headers } from "./clob-auth";

const SCOPE =
  "0xfb05e4134e5b30db022b94b822e7d19b1e5cd1c244468eada63789fd3514454a";

describe("clob L2 headers", () => {
  it("signs timestamp + METHOD + path + body with the base64url-decoded secret", () => {
    // 和 user-dapp lib/hmac.ts 同一公式；对照用 node 的 HMAC 独立算一遍
    const secret = Buffer.from("this-is-the-shared-secret").toString(
      "base64url",
    );
    const headers = l2Headers(
      { apiKey: "key-1", secret, passphrase: "pass" },
      "0x9858effd232b4033e47d90003d41ec34ecaeda94",
      "get",
      "/balance-allowance",
      1788351551,
    );
    const expected = createHmac("sha256", Buffer.from(secret, "base64url"))
      .update("1788351551GET/balance-allowance")
      .digest("base64");
    expect(headers.PRED_SIGNATURE).toBe(expected);
    expect(headers.PRED_TIMESTAMP).toBe("1788351551");
    // 地址按 EIP-55 发，平台按它找 Safe
    expect(headers.PRED_ADDRESS).toBe(
      "0x9858EfFD232B4033E47d90003D41EC34EcaEda94",
    );
  });
});

describe("ClobAuth typed data", () => {
  it("recovers the signer under the ClobAuthDomain", async () => {
    const wallet = Wallet.createRandom();
    const typed = clobAuthTypedData(
      11155420,
      wallet.address,
      "1788351551",
      SCOPE,
    );
    const signature = await wallet.signTypedData(
      typed.domain,
      typed.types,
      typed.value,
    );
    expect(
      verifyTypedData(typed.domain, typed.types, typed.value, signature),
    ).toBe(wallet.address);
    expect(typed.value.nonce).toBe(0n);
  });
});
