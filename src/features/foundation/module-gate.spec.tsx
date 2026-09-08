import { screen } from "@testing-library/react-native";
import { Text } from "react-native";
import { renderWithProviders } from "../../test/harness";
import { ModuleGate } from "./module-gate";

const mockPopToTop = jest.fn();
const mockCanGoBack = jest.fn(() => true);
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => ({ popToTop: mockPopToTop, canGoBack: mockCanGoBack }),
}));

describe("ModuleGate", () => {
  beforeEach(() => {
    mockPopToTop.mockClear();
    mockCanGoBack.mockClear();
  });

  it("renders module content while the module is on", async () => {
    await renderWithProviders(
      <ModuleGate module="predict">
        <Text>预测详情</Text>
      </ModuleGate>,
      { modules: { predict: true } },
    );
    expect(screen.getByText("预测详情")).toBeTruthy();
    expect(mockPopToTop).not.toHaveBeenCalled();
  });

  it("renders nothing and leaves the stack when the module is off", async () => {
    await renderWithProviders(
      <ModuleGate module="predict">
        <Text>预测详情</Text>
      </ModuleGate>,
      { modules: { predict: false } },
    );
    expect(screen.queryByText("预测详情")).toBeNull();
    expect(mockPopToTop).toHaveBeenCalledTimes(1);
  });

  it("does not pop when there is nothing below on the stack", async () => {
    mockCanGoBack.mockReturnValueOnce(false);
    await renderWithProviders(
      <ModuleGate module="dex">
        <Text>兑换</Text>
      </ModuleGate>,
      { modules: { dex: false } },
    );
    expect(screen.queryByText("兑换")).toBeNull();
    expect(mockPopToTop).not.toHaveBeenCalled();
  });

  it("passes screens that belong to no module", async () => {
    await renderWithProviders(
      <ModuleGate module={null}>
        <Text>钱包账户</Text>
      </ModuleGate>,
      { modules: { predict: false } },
    );
    expect(screen.getByText("钱包账户")).toBeTruthy();
  });
});
