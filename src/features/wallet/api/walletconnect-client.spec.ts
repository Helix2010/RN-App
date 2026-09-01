import { Linking } from "react-native";
import { pairingLinks, launchLinks } from "./wallet-deep-links";
import {
  isWalletInstalled,
  openWalletOrFallback,
} from "./walletconnect-client";

describe("wallet deep links", () => {
  it("uses the schemes the wallet vendors actually registered", () => {
    // okx:// 这个 scheme 不存在，注册表里是 okex://main 和 okxwallet://main。
    // 写错的话唤起永远失败，用户点了像没反应。
    expect(pairingLinks("okx")).toEqual([
      "okex://main/wc?uri=",
      "okxwallet://main/wc?uri=",
    ]);
    expect(pairingLinks("metamask")).toEqual(["metamask://wc?uri="]);
    expect(launchLinks("okx")).toEqual(["okex://main", "okxwallet://main"]);
  });

  it("has no link for the generic scan entry", () => {
    expect(pairingLinks("walletconnect")).toEqual([]);
  });
});

describe("openWalletOrFallback", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    // jest-expo 把 Linking 换成了 jest.fn，restore 后调用记录还在，不清会累积
    jest.clearAllMocks();
  });

  it("opens the wallet without asking canOpenURL first", async () => {
    // 回归：Android 11+ 的 package visibility 会让 canOpenURL 对未在 manifest
    // queries 里声明的 scheme 一律返回 false，哪怕钱包装着。用它做前置判断，
    // 装了 MetaMask 的用户也只会看到二维码。
    const canOpenURL = jest
      .spyOn(Linking, "canOpenURL")
      .mockResolvedValue(false);
    const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
    const fallback = jest.fn();

    await openWalletOrFallback(
      {
        uri: "wc:abc@2",
        connector: "metamask",
        deepLinks: pairingLinks("metamask"),
      },
      fallback,
    );

    expect(openURL).toHaveBeenCalledWith(
      `metamask://wc?uri=${encodeURIComponent("wc:abc@2")}`,
    );
    expect(canOpenURL).not.toHaveBeenCalled();
    expect(fallback).not.toHaveBeenCalled();
  });

  it("tries the next scheme when a wallet has more than one app", async () => {
    const openURL = jest
      .spyOn(Linking, "openURL")
      .mockRejectedValueOnce(new Error("no activity found"))
      .mockResolvedValueOnce(undefined);
    const fallback = jest.fn();

    await openWalletOrFallback(
      { uri: "wc:abc@2", connector: "okx", deepLinks: pairingLinks("okx") },
      fallback,
    );

    expect(openURL).toHaveBeenCalledTimes(2);
    expect(openURL).toHaveBeenLastCalledWith(
      `okxwallet://main/wc?uri=${encodeURIComponent("wc:abc@2")}`,
    );
    expect(fallback).not.toHaveBeenCalled();
  });

  it("falls back to the QR code when no wallet app can take it", async () => {
    jest
      .spyOn(Linking, "openURL")
      .mockRejectedValue(new Error("not installed"));
    const fallback = jest.fn();

    await openWalletOrFallback(
      { uri: "wc:abc@2", connector: "trust", deepLinks: pairingLinks("trust") },
      fallback,
    );

    expect(fallback).toHaveBeenCalledWith("wc:abc@2");
  });

  it("goes straight to the QR code for the generic scan entry", async () => {
    const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
    const fallback = jest.fn();

    await openWalletOrFallback(
      { uri: "wc:abc@2", connector: "walletconnect", deepLinks: [] },
      fallback,
    );

    expect(openURL).not.toHaveBeenCalled();
    expect(fallback).toHaveBeenCalledWith("wc:abc@2");
  });
});

describe("isWalletInstalled", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    // jest-expo 把 Linking 换成了 jest.fn，restore 后调用记录还在，不清会累积
    jest.clearAllMocks();
  });

  it("reports what canOpenURL says", async () => {
    jest.spyOn(Linking, "canOpenURL").mockResolvedValue(true);
    await expect(isWalletInstalled("metamask")).resolves.toBe(true);
  });

  it("treats a probe error as not installed", async () => {
    jest
      .spyOn(Linking, "canOpenURL")
      .mockRejectedValue(new Error("query not allowed"));
    await expect(isWalletInstalled("metamask")).resolves.toBe(false);
  });

  it("reports the scan entry as not a local app", async () => {
    await expect(isWalletInstalled("walletconnect")).resolves.toBe(false);
  });
});
