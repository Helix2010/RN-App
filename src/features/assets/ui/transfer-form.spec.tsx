import type { QueryClient } from "@tanstack/react-query";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { fromDecimal } from "../../../core/money/money";
import {
  createTestGateways,
  renderWithProviders,
  signIn,
} from "../../../test/harness";
import type { InMemoryPredictAccountGateway } from "../../../test/predict-account";
import { TransferForm } from "./transfer-form";

async function setup(options: { enable?: boolean } = {}) {
  const gateways = createTestGateways();
  const session = await signIn(gateways);
  const account = gateways.predictAccount as InMemoryPredictAccountGateway;
  if (options.enable !== false) await account.enable(session.address);
  return { gateways, account, address: session.address };
}

/** 让提交后的失效重取与交易轮询跑完，避免下一个用例的 render 与本用例的 act 重叠。 */
async function settle(queryClient: QueryClient) {
  await waitFor(() => expect(queryClient.isMutating()).toBe(0));
  await waitFor(() => expect(queryClient.isFetching()).toBe(0));
}

function form(
  address: string,
  overrides: Partial<React.ComponentProps<typeof TransferForm>> = {},
) {
  return (
    <TransferForm
      address={address}
      onFinished={jest.fn()}
      onOpenEnable={jest.fn()}
      {...overrides}
    />
  );
}

describe("TransferForm", () => {
  it("shows the enable entry instead of the form when the account is not enabled", async () => {
    const { gateways, address } = await setup({ enable: false });
    const onOpenEnable = jest.fn();
    await renderWithProviders(form(address, { onOpenEnable }), { gateways });
    void fireEvent.press(await screen.findByTestId("transfer-enable"));
    expect(onOpenEnable).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("transfer-amount")).toBeNull();
    expect(screen.queryByTestId("transfer-submit")).toBeNull();
  });

  it("deposits USDC through approve + wrap and switches to the on-chain progress", async () => {
    const { gateways, account, address } = await setup();
    const { queryClient } = await renderWithProviders(form(address), {
      gateways,
    });
    void fireEvent.changeText(
      await screen.findByTestId("transfer-amount"),
      "100",
    );
    // 手续费估出来之前按钮不可用，估出来后才提交
    await waitFor(() =>
      expect(
        screen.getByTestId("transfer-submit").props["aria-disabled"],
      ).toBeFalsy(),
    );
    void fireEvent.press(screen.getByTestId("transfer-submit"));
    await waitFor(() =>
      expect(account.calls).toContain("deposit:USDC:100000000"),
    );
    expect(await screen.findByTestId("tx-progress")).toBeTruthy();
    await settle(queryClient);
  });

  it("transfers USDW in one step when that asset is picked", async () => {
    const { gateways, account, address } = await setup();
    account.funds = { ...account.funds, usdw: fromDecimal("50", 6, "USDW") };
    const { queryClient } = await renderWithProviders(form(address), {
      gateways,
    });
    void fireEvent.press(await screen.findByTestId("transfer-asset-USDW"));
    // 切换币种后钱包可用变成 USDW 的余额，再输入数量
    await screen.findByText(/50\.00 USDW/);
    void fireEvent.changeText(screen.getByTestId("transfer-amount"), "20");
    await waitFor(() =>
      expect(
        screen.getByTestId("transfer-submit").props["aria-disabled"],
      ).toBeFalsy(),
    );
    void fireEvent.press(screen.getByTestId("transfer-submit"));
    await waitFor(() =>
      expect(account.calls).toContain("deposit:USDW:20000000"),
    );
    expect(await screen.findByTestId("tx-progress")).toBeTruthy();
    await settle(queryClient);
  });

  it("blocks a deposit the wallet cannot pay gas for", async () => {
    const { gateways, account, address } = await setup();
    account.funds = { ...account.funds, native: fromDecimal("0", 18, "ETH") };
    const { runtime } = await renderWithProviders(form(address), { gateways });
    void fireEvent.changeText(
      await screen.findByTestId("transfer-amount"),
      "10",
    );
    await waitFor(() =>
      expect(
        screen.getByText(
          runtime.t("transfer.noGas").replace("{symbol}", "ETH"),
        ),
      ).toBeTruthy(),
    );
    void fireEvent.press(screen.getByTestId("transfer-submit"));
    expect(account.calls.filter((call) => call.startsWith("deposit"))).toEqual(
      [],
    );
  });

  it("starts a withdrawal and lists it as pending until the delay passes", async () => {
    const { gateways, account, address } = await setup();
    account.balance = {
      ...account.balance,
      available: fromDecimal("40", 6, "USDW"),
      safeBalance: fromDecimal("40", 6, "USDW"),
    };
    const { queryClient } = await renderWithProviders(
      form(address, { initialDirection: "withdraw" }),
      {
        gateways,
      },
    );
    void fireEvent.changeText(
      await screen.findByTestId("transfer-amount"),
      "15",
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("transfer-submit").props["aria-disabled"],
      ).toBeFalsy(),
    );
    void fireEvent.press(screen.getByTestId("transfer-submit"));
    await waitFor(() => expect(account.calls).toContain("withdraw:15000000"));
    const claim = await screen.findByTestId("transfer-claim-1");
    // 60 秒等待期还没过：能看到记录，但不能领
    expect(claim.props["aria-disabled"]).toBe(true);
    expect(account.calls.filter((call) => call.startsWith("claim"))).toEqual(
      [],
    );
    await settle(queryClient);
  });

  it("claims a matured withdrawal and shows the claim progress", async () => {
    const { gateways, account, address } = await setup();
    account.balance = {
      ...account.balance,
      available: fromDecimal("40", 6, "USDW"),
      safeBalance: fromDecimal("40", 6, "USDW"),
    };
    // 网关时钟拨回两分钟：发起的记录立刻到期
    account.now = () => Date.now() - 120_000;
    await account.withdraw(address, fromDecimal("15", 6, "USDW"));
    const { queryClient } = await renderWithProviders(
      form(address, { initialDirection: "withdraw" }),
      {
        gateways,
      },
    );
    const claim = await screen.findByTestId("transfer-claim-1");
    await waitFor(() => expect(claim.props["aria-disabled"]).toBeFalsy());
    void fireEvent.press(claim);
    await waitFor(() => expect(account.calls).toContain("claim:1"));
    expect(await screen.findByTestId("tx-progress")).toBeTruthy();
    await settle(queryClient);
  });

  it("refuses a withdrawal below the wrapper minimum", async () => {
    const { gateways, account, address } = await setup();
    account.balance = {
      ...account.balance,
      available: fromDecimal("40", 6, "USDW"),
      safeBalance: fromDecimal("40", 6, "USDW"),
    };
    account.terms = {
      delaySeconds: 60,
      // wrapper 的真实最小额（dev 实测 minUnwrapUsdw = 0.001）
      minAmount: fromDecimal("0.001", 6, "USDW"),
    };
    const { runtime } = await renderWithProviders(
      form(address, { initialDirection: "withdraw" }),
      { gateways },
    );
    void fireEvent.changeText(
      await screen.findByTestId("transfer-amount"),
      "0.0001",
    );
    await waitFor(() =>
      expect(
        screen.getByText(
          runtime.t("transfer.minWithdraw").replace("{amount}", "0.001 USDW"),
        ),
      ).toBeTruthy(),
    );
    void fireEvent.press(screen.getByTestId("transfer-submit"));
    expect(account.calls.filter((call) => call.startsWith("withdraw"))).toEqual(
      [],
    );
  });
});
