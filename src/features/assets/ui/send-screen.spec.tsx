import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import {
  createTestGateways,
  renderWithProviders,
  signIn,
} from "../../../test/harness";
import { SendScreen } from "./send-screen";
import type { Gateways } from "../../../core/gateways/gateway-context";
import type { TokenBalance } from "../../wallet/model/wallet";
import { InsufficientGasError } from "../../../core/chain/transfer-service";
import { CHAINS } from "../../../core/gateways/types";
import { withWallet } from "../../../test/wallet-config";
import { fromDecimal, money } from "../../../core/money/money";
import { ToastHost } from "../../../design-system";
import * as LocalAuthentication from "expo-local-authentication";

const RECIPIENT = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";
const USDT_BSC = "0x55d398326f99059ff775485246999027b3197955";

function balance(overrides: {
  address: string;
  symbol: string;
  verified: boolean;
  /** 展示精度；缺省按稳定币的 2 位 */
  displayDecimals?: number;
  amount?: string;
}): TokenBalance {
  return {
    token: {
      chain: "bsc",
      address: overrides.address,
      symbol: overrides.symbol,
      name: overrides.symbol,
      decimals: 18,
      displayDecimals: overrides.displayDecimals ?? 2,
      logoColor: "#26A17B",
      verified: overrides.verified,
    },
    amount: fromDecimal(overrides.amount ?? "500", 18, overrides.symbol),
    usdValue: 500,
    change24hPct: 0,
  };
}

async function openConfirm(options: {
  verified: boolean;
  prepare?: (gateways: Gateways) => void;
}) {
  const gateways = createTestGateways();
  await signIn(gateways);
  gateways.wallet.getBalances = jest.fn(async () => [
    balance({
      address: USDT_BSC,
      symbol: "USDT",
      verified: options.verified,
    }),
  ]);
  options.prepare?.(gateways);
  const rendered = await renderWithProviders(
    <>
      <SendScreen onBack={jest.fn()} initialChain="bsc" />
      {/* 失败原因是通过 toast 说出来的，不挂 host 就断言不到用户真正看到的东西 */}
      <ToastHost />
    </>,
    { gateways },
  );

  void fireEvent.changeText(
    await screen.findByTestId("send-address"),
    RECIPIENT,
  );
  void fireEvent.changeText(await screen.findByTestId("send-amount"), "100");
  void fireEvent.press(await screen.findByTestId("send-submit"));
  return rendered;
}

describe("SendScreen confirmation", () => {
  it("shows the recipient in full, not shortened", async () => {
    // 剪贴板劫持伪造的地址首尾往往一致，缩略显示看不出差别，
    // 而这是用户签名前最后一次能看到目标的地方
    const { runtime } = await openConfirm({ verified: true });

    await waitFor(() =>
      expect(screen.getByTestId("send-confirm-address")).toHaveTextContent(
        RECIPIENT,
      ),
    );
    expect(screen.getByText(runtime.t("send.checkAddress"))).toBeTruthy();
  });

  it("shows the token contract address and the chain id", async () => {
    // 合约地址被换掉时符号完全一样，不显示它就等于没有防线
    await openConfirm({ verified: true });

    await waitFor(() => expect(screen.getByText(/USDT ·/)).toBeTruthy());
    expect(screen.getByText(new RegExp(USDT_BSC))).toBeTruthy();
    // 链名会重复（Base 和 Ethereum 的原生币都叫 ETH），chainId 不会
    expect(screen.getByText(/· 56$/)).toBeTruthy();
  });

  it("warns when the token is not on the verified list", async () => {
    const { runtime } = await openConfirm({ verified: false });

    await waitFor(() =>
      expect(
        screen.getByText(runtime.t("send.unverifiedWarning")),
      ).toBeTruthy(),
    );
  });

  it("stays quiet for a verified token", async () => {
    const { runtime } = await openConfirm({ verified: true });

    await waitFor(() => expect(screen.getByText(/USDT ·/)).toBeTruthy());
    expect(screen.queryByText(runtime.t("send.unverifiedWarning"))).toBeNull();
  });
});

describe("SendScreen network fee", () => {
  it("says the fee cannot be estimated rather than inventing a number", async () => {
    // Mock 账本给不出链上手续费。编一个数字更糟：写小了用户会以为余额够
    const { runtime } = await openConfirm({ verified: true });

    await waitFor(() =>
      expect(screen.getAllByText(runtime.t("send.feeUnavailable")).length).toBe(
        2,
      ),
    );
  });

  it("shows the real fee once the chain quotes one", async () => {
    await openConfirm({
      verified: true,
      prepare: (gateways) => {
        gateways.wallet.quoteTransfer = jest.fn(async () => ({
          fee: money(300_000_000_000_000n, 18, "BNB"),
          maxAmount: null,
        }));
      },
    });

    await waitFor(() =>
      expect(screen.getAllByText(/0\.0003 BNB/).length).toBeGreaterThan(0),
    );
  });
});

describe("SendScreen failure reasons", () => {
  it("tells the user to top up gas instead of just saying it failed", async () => {
    // 最高频的困惑："我有 USDT，为什么转不了"。答案是缺 BNB，而不是余额不足
    const { runtime } = await openConfirm({
      verified: true,
      prepare: (gateways) => {
        gateways.wallet.send = jest.fn(async () => {
          throw new InsufficientGasError("BNB", 300n, 0n);
        });
      },
    });

    void fireEvent.press(await screen.findByTestId("send-confirm"));

    await waitFor(() =>
      expect(
        screen.getByText(
          runtime.t("send.error.gas").replace("{symbol}", "BNB"),
        ),
      ).toBeTruthy(),
    );
    expect(screen.queryByText(runtime.t("send.failed"))).toBeNull();
  });
});

describe("SendScreen recipient validation", () => {
  async function typeAddress(value: string) {
    const gateways = createTestGateways();
    await signIn(gateways);
    gateways.wallet.getBalances = jest.fn(async () => [
      balance({ address: USDT_BSC, symbol: "USDT", verified: true }),
    ]);
    const rendered = await renderWithProviders(
      <SendScreen onBack={jest.fn()} initialChain="bsc" />,
      { gateways },
    );
    void fireEvent.changeText(await screen.findByTestId("send-address"), value);
    void fireEvent.changeText(await screen.findByTestId("send-amount"), "1");
    return rendered;
  }

  it("calls out a mixed-case address whose checksum is wrong, instead of 'invalid format'", async () => {
    // 几乎总是手抄错了一个字符；说"格式不对"会让用户去改格式
    const tampered = RECIPIENT.slice(0, -2) + "A4";
    const { runtime } = await typeAddress(tampered);

    await waitFor(() =>
      expect(screen.getByText(runtime.t("send.addressChecksum"))).toBeTruthy(),
    );
    expect(screen.queryByText(runtime.t("send.addressInvalid"))).toBeNull();
    // 注意：不能用"点了之后确认页不出现"来断言——bottom-sheet 的 jest mock 会始终
    // 渲染 sheet 的子树。Tamagui 的 disabled 落到宿主上是 pointerEvents=none，
    // 真机上就是这个属性在拦点击。
    const submit = screen.getByTestId("send-submit");
    expect(submit.props["aria-disabled"]).toBe(true);
    expect(submit.props.pointerEvents).toBe("none");
  });

  it("refuses to send a token to its own contract address", async () => {
    // 转给代币合约本身 = 永久丢失
    const { runtime } = await typeAddress(USDT_BSC);

    await waitFor(() =>
      expect(
        screen.getByText(runtime.t("send.addressIsContract")),
      ).toBeTruthy(),
    );
    // 注意：不能用"点了之后确认页不出现"来断言——bottom-sheet 的 jest mock 会始终
    // 渲染 sheet 的子树。Tamagui 的 disabled 落到宿主上是 pointerEvents=none，
    // 真机上就是这个属性在拦点击。
    const submit = screen.getByTestId("send-submit");
    expect(submit.props["aria-disabled"]).toBe(true);
    expect(submit.props.pointerEvents).toBe("none");
  });

  it("still accepts an all-lowercase address, which carries no checksum", async () => {
    const { runtime } = await typeAddress(RECIPIENT.toLowerCase());

    await waitFor(() =>
      expect(
        screen.getByText(
          runtime.t("send.addressValid").replace("{chain}", "BNB Smart Chain"),
        ),
      ).toBeTruthy(),
    );
  });
});

describe("SendScreen on a real chain", () => {
  it("will not let the user sign while the fee is unknown", async () => {
    // 签名费要绑定到用户看到的数；没看到就没有可绑的
    const { runtime } = await openConfirm({
      verified: true,
      prepare: (gateways) => {
        gateways.wallet.sendsOnchain = () => true;
        gateways.wallet.quoteTransfer = jest.fn(async () => {
          throw new Error("node down");
        });
      },
    });

    // 报价失败会先重试一次（800ms），提示要等它放弃之后才出现
    await waitFor(
      () =>
        expect(screen.getByText(runtime.t("send.feeRequired"))).toBeTruthy(),
      { timeout: 4_000 },
    );
    const submit = screen.getByTestId("send-submit");
    expect(submit.props["aria-disabled"]).toBe(true);
  });

  it("hands the quoted fee to the send so signing is bound to it", async () => {
    const send = jest.fn(async () => {
      throw new Error("stop here");
    });
    await openConfirm({
      verified: true,
      prepare: (gateways) => {
        gateways.wallet.sendsOnchain = () => true;
        gateways.wallet.quoteTransfer = jest.fn(async () => ({
          fee: money(300_000_000_000_000n, 18, "BNB"),
          maxAmount: null,
        }));
        gateways.wallet.send = send;
      },
    });
    await waitFor(() =>
      expect(screen.getAllByText(/0\.0003 BNB/).length).toBeGreaterThan(0),
    );

    void fireEvent.press(await screen.findByTestId("send-confirm"));

    await waitFor(() => expect(send).toHaveBeenCalled());
    const [request] = send.mock.calls[0] as unknown as [
      { maxFee?: { raw: string } },
    ];
    expect(request.maxFee?.raw).toBe("300000000000000");
  });

  it("says so when the send only reaches the demo ledger", async () => {
    const { runtime } = await openConfirm({ verified: true });
    await waitFor(() =>
      expect(screen.getByText(runtime.t("send.demoLedger"))).toBeTruthy(),
    );
  });

  it("shows the exact amount that will be signed, not a rounded one", async () => {
    const gateways = createTestGateways();
    await signIn(gateways);
    gateways.wallet.getBalances = jest.fn(async () => [
      // 输入框只收展示精度以内的位数，所以这里要给到 6 位才输得进 1.009
      balance({
        address: USDT_BSC,
        symbol: "USDT",
        verified: true,
        displayDecimals: 6,
      }),
    ]);
    await renderWithProviders(
      <SendScreen onBack={jest.fn()} initialChain="bsc" />,
      { gateways },
    );
    void fireEvent.changeText(
      await screen.findByTestId("send-address"),
      RECIPIENT,
    );
    void fireEvent.changeText(
      await screen.findByTestId("send-amount"),
      "1.009",
    );
    void fireEvent.press(await screen.findByTestId("send-submit"));

    // formatMoney 会把 1.009 四舍五入成 1.01；签的却是 1.009
    await waitFor(() =>
      expect(screen.getAllByText("1.009 USDT").length).toBeGreaterThan(0),
    );
  });
});

describe("SendScreen double submit", () => {
  it("sends once when the confirm button is tapped twice during verification", async () => {
    // 从点确认到 mutate 之间要 await 生物验证，这段窗口里 isPending 还是 false。
    // 注意：fireEvent 会在 act 里同步刷新状态，所以这里其实是 verifying 态把
    // 第二次点击挡住的；ref 守卫覆盖的是真机上重渲染之前那个更窄的窗口，
    // 在 jest 里观察不到，只能靠代码审阅。
    const send = jest.fn(async () => {
      throw new Error("stop here");
    });
    jest
      .mocked(LocalAuthentication.getEnrolledLevelAsync)
      .mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(3), 30)),
      );
    await openConfirm({
      verified: true,
      prepare: (gateways) => {
        gateways.wallet.send = send;
      },
    });

    const confirm = await screen.findByTestId("send-confirm");
    void fireEvent.press(confirm);
    await new Promise((resolve) => setTimeout(resolve, 10));
    void fireEvent.press(confirm);

    await waitFor(() => expect(send).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(send).toHaveBeenCalledTimes(1);
    jest.mocked(LocalAuthentication.getEnrolledLevelAsync).mockResolvedValue(3);
  });
});

describe("SendScreen progress page", () => {
  it("keeps showing the submitted transfer even after the balance refresh empties the list", async () => {
    // 转出成功后余额刷新会让 selected 变成 undefined；进度页要是跟着它走，
    // 就会整个卸载回表单——而那笔真实交易已经发出去了
    let sent = false;
    const record = {
      id: "0xabc",
      kind: "send" as const,
      status: "submitted" as const,
      hash: "0xabc",
      token: balance({ address: USDT_BSC, symbol: "USDT", verified: true })
        .token,
      amount: fromDecimal("100", 18, "USDT"),
      counterparty: RECIPIENT,
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const { runtime } = await openConfirm({
      verified: true,
      prepare: (gateways) => {
        gateways.wallet.getBalances = jest.fn(async () =>
          sent
            ? []
            : [balance({ address: USDT_BSC, symbol: "USDT", verified: true })],
        );
        gateways.wallet.send = jest.fn(async () => {
          sent = true;
          return record;
        });
        gateways.wallet.getTransaction = jest.fn(async () => ({
          ...record,
          status: "confirming" as const,
        }));
      },
    });

    void fireEvent.press(await screen.findByTestId("send-confirm"));

    await waitFor(() => expect(screen.getByTestId("tx-progress")).toBeTruthy());
    // 余额刷新之后仍然在进度页，而且有出口
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByTestId("tx-progress")).toBeTruthy();
    expect(screen.getByText(runtime.t("tx.minimize"))).toBeTruthy();
    // 进度页标题是签名的精确值，不四舍五入
    expect(screen.getByText(/100 USDT/)).toBeTruthy();
  });
});

describe("SendScreen amount presets", () => {
  it("computes a preset from the exact balance, not a rounded float", async () => {
    const gateways = createTestGateways();
    await signIn(gateways);
    gateways.wallet.getBalances = jest.fn(async () => [
      balance({ address: USDT_BSC, symbol: "USDT", verified: true }),
    ]);
    await renderWithProviders(
      <SendScreen onBack={jest.fn()} initialChain="bsc" />,
      { gateways },
    );
    void fireEvent.changeText(
      await screen.findByTestId("send-address"),
      RECIPIENT,
    );
    // 余额 500 USDT，25% = 125
    void fireEvent.press(await screen.findByText("25%"));

    await waitFor(() =>
      expect(screen.getByTestId("send-amount").props.value).toBe("125"),
    );
  });
});

describe("SendScreen display precision", () => {
  async function renderWithBalance(item: TokenBalance) {
    const gateways = createTestGateways();
    await signIn(gateways);
    gateways.wallet.getBalances = jest.fn(async () => [item]);
    return renderWithProviders(
      <SendScreen onBack={jest.fn()} initialChain="bsc" />,
      { gateways },
    );
  }

  it("fills MAX with the balance truncated to the display precision, not rounded", async () => {
    // 输入框只能显示展示精度；填进去的就是要签的，多出来的尘埃留在余额里。
    // 500.129999 四舍五入是 500.13，而 500.13 > 余额，用户会看到"余额不足"
    const { runtime } = await renderWithBalance(
      balance({
        address: USDT_BSC,
        symbol: "USDT",
        verified: true,
        amount: "500.129999",
        displayDecimals: 2,
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByText(
          runtime.t("send.balance").replace("{amount}", "500.12 USDT"),
        ),
      ).toBeTruthy(),
    );

    void fireEvent.press(screen.getByLabelText(runtime.t("common.max")));

    await waitFor(() =>
      expect(screen.getByTestId("send-amount").props.value).toBe("500.12"),
    );
  });

  it("computes a preset from the exact balance and then truncates it to the display precision", async () => {
    // 先按整数算精确值（25% of 500.129999 = 125.03249975），再截到 2 位
    const { runtime } = await renderWithBalance(
      balance({
        address: USDT_BSC,
        symbol: "USDT",
        verified: true,
        amount: "500.129999",
        displayDecimals: 2,
      }),
    );
    await screen.findByLabelText(runtime.t("common.max"));

    void fireEvent.press(screen.getByText("25%"));

    await waitFor(() =>
      expect(screen.getByTestId("send-amount").props.value).toBe("125.03"),
    );
  });

  it("caps typed decimals at the display precision", async () => {
    // 不能输入比能看到的更多位
    await renderWithBalance(
      balance({
        address: USDT_BSC,
        symbol: "USDT",
        verified: true,
        displayDecimals: 2,
      }),
    );

    void fireEvent.changeText(
      await screen.findByTestId("send-amount"),
      "1.23456",
    );

    await waitFor(() =>
      expect(screen.getByTestId("send-amount").props.value).toBe("1.23"),
    );
  });

  it("shows a fee below one display unit as '< …' rather than as zero", async () => {
    // 0.00003 BNB 按原生币的 4 位展示精度会截成 0，显示成 0 会让用户以为不要钱
    await openConfirm({
      verified: true,
      prepare: (gateways) => {
        gateways.wallet.quoteTransfer = jest.fn(async () => ({
          fee: money(30_000_000_000_000n, 18, "BNB"),
          maxAmount: null,
        }));
      },
    });

    await waitFor(() =>
      expect(screen.getAllByText(/< 0\.0001 BNB/).length).toBeGreaterThan(0),
    );
  });
});

describe("SendScreen chain switch", () => {
  it("offers only the chains the tenant enabled and starts on the first of them", async () => {
    const gateways = createTestGateways();
    await signIn(gateways);
    gateways.wallet.getBalances = jest.fn(async () => []);

    await renderWithProviders(<SendScreen onBack={jest.fn()} />, {
      gateways,
      config: (c) => withWallet(c, { chains: ["eth"] }),
    });

    expect(screen.queryByText(CHAINS.bsc.name)).toBeNull();
    expect(screen.getAllByText(CHAINS.eth.name).length).toBeGreaterThan(0);
  });

  it("shows an empty state when the tenant enabled no chain at all", async () => {
    const gateways = createTestGateways();
    await signIn(gateways);

    await renderWithProviders(<SendScreen onBack={jest.fn()} />, {
      gateways,
      config: (c) => withWallet(c, { chains: [] }),
    });

    expect(screen.getByTestId("send-no-chain")).toBeTruthy();
  });
});
