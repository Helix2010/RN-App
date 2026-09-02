import { fireEvent, render, screen } from "@testing-library/react-native";
import * as Clipboard from "expo-clipboard";
import { Text } from "react-native";
import { RootErrorBoundary } from "./root-error-boundary";

jest.mock("expo-localization", () => ({
  getLocales: () => [{ languageCode: "zh" }],
}));

let explode = true;
function Child() {
  if (explode) throw new Error("render exploded");
  return <Text testID="child">ok</Text>;
}

describe("RootErrorBoundary", () => {
  beforeEach(() => {
    explode = true;
    jest.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it("turns a render crash into a screen with retry and diagnostics, and recovers on retry", async () => {
    await render(
      <RootErrorBoundary>
        <Child />
      </RootErrorBoundary>,
    );

    expect(screen.getByTestId("root-error-boundary")).toBeTruthy();
    expect(screen.getByText(/render exploded/)).toBeTruthy();
    expect(
      screen.getByTestId("root-error-diagnostic-id").props.children.join(""),
    ).toMatch(/诊断 ID: [0-9a-z]+-[0-9a-z]+/);

    await fireEvent.press(screen.getByTestId("root-error-copy"));
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith(
      expect.stringContaining("error: Error: render exploded"),
    );

    explode = false;
    await fireEvent.press(screen.getByTestId("root-error-retry"));
    expect(screen.getByTestId("child")).toBeTruthy();
  });
});
