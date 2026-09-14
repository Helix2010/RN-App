import { fireEvent, screen } from "@testing-library/react-native";
import { createFallbackConfig } from "../../core/config/fallback-config";
import { fakeNavigation, renderWithProviders } from "../../test/harness";
import { LanguageSettingsScreen } from "./language-settings-screen";

describe("LanguageSettingsScreen", () => {
  it("offers the tenant default first, named after the fallback language set in the admin console", async () => {
    const config = createFallbackConfig("zh-CN");
    config.localization.fallbackLocale = "en-US";
    const setLocale = jest.fn(async () => {});
    await renderWithProviders(
      <LanguageSettingsScreen
        navigation={fakeNavigation()}
        route={undefined as never}
      />,
      {
        config: () => config,
        runtime: { setLocale, localePreference: "default" },
      },
    );

    const options = screen.getAllByTestId(/^language-option-/);
    // 默认语言在最前，其次跟随系统，再是服务端下发的语言目录
    expect(options.map((option) => option.props.accessibilityLabel)).toEqual([
      "默认语言",
      "跟随系统",
      "简体中文",
      "English",
    ]);
    expect(options[0]?.props.accessibilityState).toMatchObject({
      selected: true,
    });
    // 默认语言那一行写着它现在是哪种语言（回退语言的名字），加上 English 那一行本身
    expect(screen.getAllByText("English")).toHaveLength(2);

    await fireEvent.press(screen.getByTestId("language-option-zh-CN"));
    expect(setLocale).toHaveBeenCalledWith("zh-CN");
  });
});
