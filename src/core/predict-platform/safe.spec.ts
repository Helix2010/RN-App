import { Wallet, verifyTypedData } from "ethers";
import { createProxyTypedData, encodeMultiSend, safeTxTypedData } from "./safe";
import { conditionalTokens, erc20, MAX_UINT256 } from "./contracts";

const USDW = "0x790eabd79898F49859FE283967625438a5856098";
const CTF = "0x58Ab59C7F83Fb46ffcBF15469404393aE3db12fe";
const SAFE = "0x79ec2b3b2C34b583c1a4c1408f45AC01B5731740";
const SCOPE =
  "0xfb05e4134e5b30db022b94b822e7d19b1e5cd1c244468eada63789fd3514454a";

/** user-dapp `useSetupSteps.ts:566-583` 的手工打包，作为编码的对照。 */
function webMultiSend(ops: { to: string; data: string }[]): string {
  let packed = "";
  for (const op of ops) {
    const data = op.data.slice(2);
    const dataLen = (data.length / 2).toString(16).padStart(64, "0");
    packed +=
      "00" +
      op.to.slice(2).toLowerCase().padStart(40, "0") +
      "".padStart(64, "0") +
      dataLen +
      data;
  }
  const packedLen = (packed.length / 2).toString(16).padStart(64, "0");
  return (
    "0x8d80ff0a" +
    "0000000000000000000000000000000000000000000000000000000000000020" +
    packedLen +
    packed +
    "0".repeat((64 - (packed.length % 64)) % 64)
  );
}

describe("encodeMultiSend", () => {
  it("packs operations exactly like the web client does", () => {
    const ops = [
      {
        to: USDW,
        data: erc20.encodeFunctionData("approve", [CTF, MAX_UINT256]),
      },
      {
        to: CTF,
        data: conditionalTokens.encodeFunctionData("setApprovalForAll", [
          CTF,
          true,
        ]),
      },
    ];
    // 同一份字节：relayer 白名单校验与 Safe 执行的都是它
    expect(encodeMultiSend(ops).toLowerCase()).toBe(
      webMultiSend(ops).toLowerCase(),
    );
  });
});

describe("Safe typed data", () => {
  it("produces SafeTx signatures that recover to the signer under the Safe v1.3 domain", async () => {
    const wallet = Wallet.createRandom();
    const typed = safeTxTypedData(11155420, SAFE, {
      to: USDW,
      data: "0x1234",
      operation: 1,
      nonce: 3n,
    });
    const signature = await wallet.signTypedData(
      typed.domain,
      typed.types,
      typed.value,
    );
    expect(
      verifyTypedData(typed.domain, typed.types, typed.value, signature),
    ).toBe(wallet.address);
    // domain 只有 chainId + verifyingContract：多了 name/version 会算出另一个 hash
    expect(Object.keys(typed.domain).sort()).toEqual([
      "chainId",
      "verifyingContract",
    ]);
  });

  it("produces CreateProxy signatures with the factory as verifying contract", async () => {
    const wallet = Wallet.createRandom();
    const typed = createProxyTypedData(11155420, CTF, SCOPE);
    const signature = await wallet.signTypedData(
      typed.domain,
      typed.types,
      typed.value,
    );
    expect(
      verifyTypedData(typed.domain, typed.types, typed.value, signature),
    ).toBe(wallet.address);
    expect(typed.domain.name).toBe("Polymarket Contract Proxy Factory");
    expect(typed.domain.version).toBeUndefined();
  });
});
