import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import {
  createTestGateways,
  renderWithProviders,
  signIn,
} from "../../../test/harness";
import type { InMemoryPredictAccountGateway } from "../../../test/predict-account";
import { PredictEnableScreen } from "./predict-enable-screen";

async function setup() {
  const gateways = createTestGateways();
  const session = await signIn(gateways);
  const account = gateways.predictAccount as InMemoryPredictAccountGateway;
  return { gateways, account, address: session.address };
}

describe("PredictEnableScreen", () => {
  it("runs the four enablement steps and reports done", async () => {
    const { gateways, account } = await setup();
    const onDone = jest.fn();
    await renderWithProviders(
      <PredictEnableScreen onBack={jest.fn()} onDone={onDone} />,
      { gateways },
    );
    expect(await screen.findByTestId("predict-enable-step-login")).toBeTruthy();
    expect(screen.getByTestId("predict-enable-step-approve")).toBeTruthy();
    // 协议列表（这里为空）拿到之前按钮不可用
    const run = screen.getByTestId("predict-enable-run");
    await waitFor(() => expect(run.props["aria-disabled"]).toBeFalsy());
    void fireEvent.press(run);
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(account.calls).toContain("enable");
    expect(account.status.approved).toBe(true);
  });

  it("explains when the tenant has no platform link instead of offering the steps", async () => {
    const { gateways, account } = await setup();
    account.status = { ...account.status, configured: false };
    const { runtime } = await renderWithProviders(
      <PredictEnableScreen onBack={jest.fn()} onDone={jest.fn()} />,
      { gateways },
    );
    expect(
      await screen.findByText(runtime.t("predict.enable.notConfigured")),
    ).toBeTruthy();
    expect(screen.queryByTestId("predict-enable-run")).toBeNull();
  });

  it("offers nothing to run once every step is complete", async () => {
    const { gateways, account, address } = await setup();
    await account.enable(address);
    const { runtime } = await renderWithProviders(
      <PredictEnableScreen onBack={jest.fn()} onDone={jest.fn()} />,
      { gateways },
    );
    const run = await screen.findByTestId("predict-enable-run");
    await waitFor(() => expect(run.props["aria-disabled"]).toBe(true));
    expect(screen.getByText(runtime.t("predict.enable.complete"))).toBeTruthy();
    expect(screen.getByText(runtime.t("common.done"))).toBeTruthy();
  });

  it("blocks enabling until the required platform agreements are accepted, then records them", async () => {
    const { gateways, account } = await setup();
    account.agreements_ = [
      {
        type: "terms",
        titleTranslation: '{"en": "Terms", "zh": "条款"}',
        version: "v1.1",
        contentTranslation: '{"zh":"**重点**内容","en":"**Key** content"}',
        required: true,
        sortOrder: 0,
      },
      {
        type: "privacy",
        titleTranslation: '{"en": "Privacy", "zh": "隐私"}',
        version: "v1.0",
        externalUrl:
          '{"zh":"https://example.com/cn","en":"https://example.com/en"}',
        required: false,
        sortOrder: 1,
      },
    ];
    const onDone = jest.fn();
    await renderWithProviders(
      <PredictEnableScreen onBack={jest.fn()} onDone={onDone} />,
      { gateways },
    );
    expect(await screen.findByText("条款")).toBeTruthy();
    expect(screen.getByText("隐私")).toBeTruthy();
    const run = screen.getByTestId("predict-enable-run");
    await waitFor(() => expect(run.props["aria-disabled"]).toBe(true));
    // 展开正文：去掉 ** 标记
    void fireEvent.press(screen.getByTestId("predict-agreement-toggle-terms"));
    expect(await screen.findByText("重点内容")).toBeTruthy();
    void fireEvent.press(screen.getByTestId("predict-enable-agree"));
    await waitFor(() => expect(run.props["aria-disabled"]).toBeFalsy());
    void fireEvent.press(run);
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(account.accepted).toEqual({ terms: "v1.1" }));
  });
});
