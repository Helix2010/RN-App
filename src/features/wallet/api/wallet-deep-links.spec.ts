import { launchLinks, pairingLinks, probeLinks } from "./wallet-deep-links";

describe("wallet deep links", () => {
  it("offers the universal link before the custom scheme", () => {
    const [first, ...rest] = pairingLinks("metamask");
    // 自定义 scheme 谁都能声明，配对 URI 可能被抢注的应用接走（安全评审 N13）
    expect(first).toBe("https://metamask.app.link/wc?uri=");
    expect(rest).toContain("metamask://wc?uri=");
  });

  it("keeps the custom scheme as a fallback for older wallet builds", () => {
    expect(pairingLinks("trust")).toEqual([
      "https://link.trustwallet.com/wc?uri=",
      "trust://wc?uri=",
    ]);
    expect(launchLinks("trust")).toEqual([
      "https://link.trustwallet.com/",
      "trust://",
    ]);
  });

  it("probes installation with schemes only", () => {
    // canOpenURL 对 https 恒为 true（浏览器能开），拿它判断安装状态会全判成已装
    for (const connector of ["metamask", "trust", "okx"] as const)
      for (const link of probeLinks(connector))
        expect(link.startsWith("https://")).toBe(false);
  });

  it("keeps every OKX client, which has no universal link of its own", () => {
    expect(pairingLinks("okx")).toEqual([
      "okex://main/wc?requestId=",
      "okx://main/wc?requestId=",
      "okxwallet://main/wc?uri=",
    ]);
  });

  it("returns nothing for a connector with no known links", () => {
    expect(pairingLinks("walletconnect")).toEqual([]);
  });
});
