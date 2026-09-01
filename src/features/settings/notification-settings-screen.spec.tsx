import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { fakeNavigation, renderWithProviders } from "../../test/harness";
import { NotificationSettingsScreen } from "./notification-settings-screen";

function renderNotifications(
  options: Parameters<typeof renderWithProviders>[1] = {},
) {
  return renderWithProviders(
    <NotificationSettingsScreen
      navigation={fakeNavigation()}
      route={fakeNavigation()}
    />,
    options,
  );
}

describe("NotificationSettingsScreen", () => {
  it("requests the system permission before sending users to settings", async () => {
    const enableUpdateNotifications = jest.fn(async () => {});
    const { runtime } = await renderNotifications({
      runtime: { notificationStatus: "denied", enableUpdateNotifications },
    });
    const action = await screen.findByTestId("notif-permission-action");
    expect(screen.getByText(runtime.t("notif.enable"))).toBeTruthy();
    void fireEvent.press(action);
    await waitFor(() =>
      expect(enableUpdateNotifications).toHaveBeenCalledTimes(1),
    );
    expect(
      await screen.findByText(runtime.t("notif.openSettings")),
    ).toBeTruthy();
  });

  it("hides the permission banner once the token is registered", async () => {
    await renderNotifications({
      runtime: { notificationStatus: "registered" },
    });
    expect(await screen.findByTestId("notif-order-filled")).toBeTruthy();
    expect(screen.queryByTestId("notif-permission-action")).toBeNull();
  });
});
