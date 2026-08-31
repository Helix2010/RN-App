import { screen } from "@testing-library/react-native";
import { Body } from "../design-system";
import { renderWithProviders } from "./harness";

describe("test harness", () => {
  it("renders design-system components with the tenant theme and translations", async () => {
    const { runtime } = await renderWithProviders(<Body>hello</Body>);
    expect(screen.getByText("hello")).toBeTruthy();
    expect(runtime.t("home.portfolio")).not.toBe("home.portfolio");
  });

  it("applies module switches to the injected config", async () => {
    const { runtime } = await renderWithProviders(<Body>x</Body>, {
      modules: { dex: false },
    });
    expect(runtime.config.modules).toMatchObject({ predict: true, dex: false });
  });
});
