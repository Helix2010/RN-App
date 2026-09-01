import {
  Transaction,
  verifyMessage,
  verifyTypedData,
  type TypedDataField,
} from "ethers";
import { memoryStorage } from "../../gateways/types";
import {
  KeystoreVault,
  WalletAuthRequiredError,
} from "../vault/keystore-vault";
import { memorySecureStore, type AuthOutcome } from "../vault/ports";
import { EmbeddedSigner } from "./embedded-signer";

const PHRASE =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const ADDRESS = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";
const context = { reason: "sign" };

async function setup() {
  let outcome: AuthOutcome = "success";
  const authenticate = jest.fn(async () => outcome);
  const vault = new KeystoreVault({
    storage: memoryStorage(),
    secureStore: memorySecureStore(),
    authenticate,
  });
  await vault.importMnemonic(PHRASE);
  return {
    signer: new EmbeddedSigner(ADDRESS, vault),
    vault,
    authenticate,
    setOutcome: (next: AuthOutcome) => {
      outcome = next;
    },
  };
}

describe("EmbeddedSigner", () => {
  it("produces an EIP-191 signature that recovers to its own address", async () => {
    const { signer } = await setup();
    const message =
      "example.com wants you to sign in with your Ethereum account";
    const signature = await signer.signMessage(message, context);
    expect(verifyMessage(message, signature)).toBe(ADDRESS);
  });

  it("signs the same message deterministically (RFC6979)", async () => {
    const { signer } = await setup();
    const first = await signer.signMessage("same", context);
    const second = await signer.signMessage("same", context);
    expect(first).toBe(second);
  });

  it("produces an EIP-712 signature that recovers to its own address", async () => {
    const { signer } = await setup();
    const domain = { name: "Foundation", version: "1", chainId: 56 };
    const types: Record<string, TypedDataField[]> = {
      Order: [
        { name: "marketId", type: "string" },
        { name: "shares", type: "uint256" },
      ],
    };
    const value = { marketId: "m-btc-120k", shares: 10n };
    const signature = await signer.signTypedData(domain, types, value, context);
    expect(verifyTypedData(domain, types, value, signature)).toBe(ADDRESS);
  });

  it("signs an EIP-1559 transaction whose recovered sender is its own address", async () => {
    const { signer } = await setup();
    let signed = "";
    const hash = await signer.submitTransaction(
      {
        chainId: 56,
        to: "0x000000000000000000000000000000000000dEaD",
        value: 1_000_000_000_000_000n,
        nonce: 7,
        gasLimit: 21_000n,
        maxFeePerGas: 3_000_000_000n,
        maxPriorityFeePerGas: 1_000_000_000n,
      },
      context,
      // 签名器不碰网络：广播由调用方注入，这里顺手把原始交易捕获下来
      async (raw) => {
        signed = raw;
        return "0xhash";
      },
    );
    expect(hash).toBe("0xhash");
    const parsed = Transaction.from(signed);
    expect(parsed.from).toBe(ADDRESS);
    expect(parsed.chainId).toBe(56n);
    expect(parsed.nonce).toBe(7);
  });

  it("propagates a refused authentication instead of signing", async () => {
    const { signer, setOutcome } = await setup();
    setOutcome("cancelled");
    await expect(signer.signMessage("nope", context)).rejects.toBeInstanceOf(
      WalletAuthRequiredError,
    );
  });

  it("passes the caller's reason to the system prompt", async () => {
    const { signer, authenticate } = await setup();
    await signer.signMessage("hi", { reason: "确认转账" });
    expect(authenticate).toHaveBeenCalledWith("确认转账");
  });
});
