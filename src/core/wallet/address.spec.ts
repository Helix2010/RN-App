import { classifyEvmAddress } from "./address";

const CHECKSUMMED = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";

describe("classifyEvmAddress", () => {
  it("accepts a correctly checksummed address", () => {
    expect(classifyEvmAddress(CHECKSUMMED)).toBe("valid");
  });

  it("accepts all-lowercase and all-uppercase, which carry no checksum", () => {
    // 交易所常给全小写；两种写法都没有校验和信息，不能因此拒收
    expect(classifyEvmAddress(CHECKSUMMED.toLowerCase())).toBe("valid");
    expect(classifyEvmAddress("0x" + CHECKSUMMED.slice(2).toUpperCase())).toBe(
      "valid",
    );
  });

  it("calls out a mixed-case address whose checksum is wrong", () => {
    // 几乎总是手抄错了一个字符：必须和"格式不对"分开讲
    const tampered = CHECKSUMMED.slice(0, -2) + "A4";
    expect(classifyEvmAddress(tampered)).toBe("checksum");
  });

  it("rejects anything that is not 20 bytes of hex", () => {
    expect(classifyEvmAddress("")).toBe("invalid");
    expect(classifyEvmAddress("0x123")).toBe("invalid");
    expect(classifyEvmAddress(CHECKSUMMED + "00")).toBe("invalid");
    expect(
      classifyEvmAddress("bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh"),
    ).toBe("invalid");
  });

  it("tolerates surrounding whitespace from the clipboard", () => {
    expect(classifyEvmAddress(`  ${CHECKSUMMED}\n`)).toBe("valid");
  });
});
