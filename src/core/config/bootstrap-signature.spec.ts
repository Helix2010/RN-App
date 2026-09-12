import { HDNodeWallet, encodeBase64, getBytes, toUtf8Bytes } from "ethers";
import {
  BootstrapSignatureError,
  BOOTSTRAP_SIGNATURE_ALGORITHM,
  isReplayed,
  parseSignatureHeader,
  verifyBootstrapSignature,
} from "./bootstrap-signature";

const wallet = HDNodeWallet.createRandom();

/** 服务端那条头长什么样：RFC 8941 字典，三个 sf-string。 */
async function headerFor(body: string, signer = wallet): Promise<string> {
  const signature = await signer.signMessage(toUtf8Bytes(body));
  return `sig="${encodeBase64(getBytes(signature))}", keyid="main", alg="${BOOTSTRAP_SIGNATURE_ALGORITHM}"`;
}

const body = JSON.stringify({
  schemaVersion: 1,
  issuedAt: 1789178790393,
  update: { minSupportedVersion: "0.9.0" },
});

describe("verifyBootstrapSignature", () => {
  it("接受服务端用钉住的那把密钥签的响应", async () => {
    const header = await headerFor(body);

    expect(() =>
      verifyBootstrapSignature({ body, header, signerAddress: wallet.address }),
    ).not.toThrow();
  });

  it("改一个字节就不认——minSupportedVersion 正是攻击者最想改的那一行", async () => {
    const header = await headerFor(body);
    const tampered = body.replace('"0.9.0"', '"0.0.0"');

    expect(() =>
      verifyBootstrapSignature({
        body: tampered,
        header,
        signerAddress: wallet.address,
      }),
    ).toThrow(BootstrapSignatureError);
  });

  it("别的密钥签的不认，哪怕签名本身完全合法", async () => {
    const attacker = HDNodeWallet.createRandom();
    const header = await headerFor(body, attacker);

    expect(() =>
      verifyBootstrapSignature({ body, header, signerAddress: wallet.address }),
    ).toThrow(/signed by/);
  });

  it("算法不是我们签的那个就拒，不去猜", async () => {
    const header = (await headerFor(body)).replace(
      BOOTSTRAP_SIGNATURE_ALGORITHM,
      "rsa-v1_5-sha256",
    );

    expect(() =>
      verifyBootstrapSignature({ body, header, signerAddress: wallet.address }),
    ).toThrow(/unexpected algorithm/);
  });

  it("头缺字段、签名不是 base64、钉住的地址不合法，都是拒绝而不是放行", async () => {
    const header = await headerFor(body);
    for (const broken of ['sig="abc"', 'keyid="main", alg="x"', ""]) {
      expect(() =>
        verifyBootstrapSignature({
          body,
          header: broken,
          signerAddress: wallet.address,
        }),
      ).toThrow(BootstrapSignatureError);
    }
    expect(() =>
      verifyBootstrapSignature({
        body,
        header: header.replace(/sig="[^"]*"/, 'sig="not base64!!"'),
        signerAddress: wallet.address,
      }),
    ).toThrow(BootstrapSignatureError);
    expect(() =>
      verifyBootstrapSignature({ body, header, signerAddress: "0xnope" }),
    ).toThrow(/pinned signer address/);
  });
});

describe("parseSignatureHeader", () => {
  it("解开 sf-string 的转义", () => {
    expect(
      parseSignatureHeader('sig="a", keyid="we\\"ird\\\\id", alg="x"'),
    ).toEqual({ sig: "a", keyid: 'we"ird\\id', alg: "x" });
  });

  it("缺任何一个字段都当成没有签名", () => {
    expect(parseSignatureHeader('sig="a", alg="x"')).toBeNull();
  });
});

describe("isReplayed", () => {
  it("比见过的最大值旧就是重放", () => {
    expect(isReplayed(1_000, 100_000)).toBe(true);
  });

  it("时钟偏差范围内不算重放——那是多实例之间的抖动，不是攻击", () => {
    expect(isReplayed(99_000, 100_000)).toBe(false);
  });

  it("更新的当然不是重放", () => {
    expect(isReplayed(200_000, 100_000)).toBe(false);
  });
});

/**
 * 跨语言定桩。上面的用例用 ethers 自签自验，证明不了**服务端签的这个 App 认**。
 * 这一组的签名是 Go 那边 `siwe.SignPersonal` 真实产出的：dcrd 的紧凑编码把恢复位
 * 放在最前面并加 27，ethers 要的是放在最后，两边只要有一处重排写反，这里当场红。
 *
 * 重新生成：在 RN-Server 的 internal/siwe 包里用同一个标量调 SignPersonal。
 */
describe("与服务端产出的签名对得上", () => {
  const GO_ADDRESS = "0x2316bF06f67dB017080f31E2aB3d89857d9aeBBb";
  const GO_BODY =
    '{"issuedAt":1789178790393,"schemaVersion":1,"update":{"minSupportedVersion":"0.9.0"}}';
  const GO_SIG =
    "u3ImHMqYhfuy+pXrAuhN6euq2XFiiRvof/gbqqX2OuUcXR1wizuWz/0ToAr5yTHD+z7WjQ064P5jl7AdLsG2ihs=";
  const header = `sig="${GO_SIG}", keyid="main", alg="${BOOTSTRAP_SIGNATURE_ALGORITHM}"`;

  it("接受 Go 服务端签的响应", () => {
    expect(() =>
      verifyBootstrapSignature({
        body: GO_BODY,
        header,
        signerAddress: GO_ADDRESS,
      }),
    ).not.toThrow();
  });

  it("同一条签名换个响应体就不认", () => {
    expect(() =>
      verifyBootstrapSignature({
        body: GO_BODY.replace("0.9.0", "0.0.0"),
        header,
        signerAddress: GO_ADDRESS,
      }),
    ).toThrow(BootstrapSignatureError);
  });
});
