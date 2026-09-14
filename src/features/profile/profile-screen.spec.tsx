import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { ProfileScreen } from "./profile-screen";
import {
  createTestGateways,
  renderWithProviders,
  signIn,
} from "../../test/harness";

const mockNavigate = jest.fn();
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => ({
    navigate: mockNavigate,
    goBack: jest.fn(),
    popToTop: jest.fn(),
    canGoBack: () => true,
  }),
}));

beforeEach(() => mockNavigate.mockClear());

describe("ProfileScreen history entry", () => {
  /**
   * 「交易记录」这一行在三种模块组合下去三个不同的地方。原来是个二选一，
   * `00` 时会跳预测账户详情——那个页面外面包着 ModuleGate，会被拦回首页。
   */
  it.each([
    [
      "sends DEX tenants to the swap history",
      { predict: true, dex: true },
      ["SwapHistory", undefined],
    ],
    [
      "sends predict-only tenants to the predict account",
      { predict: true, dex: false },
      ["AccountDetail", { kind: "predict" }],
    ],
    [
      "sends wallet-only tenants to the wallet records",
      { predict: false, dex: false },
      ["Records", { tab: "wallet" }],
    ],
  ])("%s", async (_name, modules, expected) => {
    const gateways = createTestGateways();
    await signIn(gateways);
    await renderWithProviders(<ProfileScreen />, { gateways, modules });
    await waitFor(() =>
      expect(screen.getByTestId("profile-history")).toBeTruthy(),
    );

    void fireEvent.press(screen.getByTestId("profile-history"));

    const [target, params] = expected as [string, unknown];
    if (params === undefined) expect(mockNavigate).toHaveBeenCalledWith(target);
    else expect(mockNavigate).toHaveBeenCalledWith(target, params);
  });
});
