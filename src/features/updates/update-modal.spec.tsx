import { screen, waitFor } from "@testing-library/react-native";
import type { BootstrapConfig } from "../../core/config/bootstrap.schema";
import { useUpdatePromptStore } from "../../core/updates/update-prompt-store";
import { renderWithProviders } from "../../test/harness";
import { UpdateModal } from "./update-modal";

function withUpdate(
  decision: BootstrapConfig["update"]["decision"],
  extra: Partial<BootstrapConfig["update"]> = {},
) {
  return (config: BootstrapConfig): BootstrapConfig => ({
    ...config,
    update: {
      ...config.update,
      decision,
      latestVersion: "1.5.0",
      releaseNotes: ["兑换记录支持筛选", "限价单支持 GTD", "修复深色模式 K 线"],
      ...extra,
      full: {
        ...config.update.full,
        actionUrl: "https://example.test/app.apk",
        size: 90_596_966,
        ...extra.full,
      },
    },
  });
}

describe("UpdateModal (S-07)", () => {
  beforeEach(() => {
    useUpdatePromptStore.setState({
      lastPromptedVersion: null,
      lastPromptedAt: null,
    });
  });

  it("stays hidden when there is no update", async () => {
    await renderWithProviders(<UpdateModal />, { config: withUpdate("none") });
    expect(screen.queryByTestId("update-modal-now")).toBeNull();
  });

  it("shows version, size, notes and both actions for a soft update", async () => {
    const { runtime } = await renderWithProviders(<UpdateModal />, {
      config: withUpdate("optional"),
    });
    expect(await screen.findByTestId("update-modal-now")).toBeTruthy();
    expect(screen.getByTestId("update-modal-later")).toBeTruthy();
    expect(
      screen.getByText(
        runtime.t("update.modalTitle").replace("{version}", "1.5.0"),
      ),
    ).toBeTruthy();
    expect(screen.getByText(/86\.4 MB/)).toBeTruthy();
    expect(screen.getByText("限价单支持 GTD")).toBeTruthy();
    expect(screen.queryByText(runtime.t("update.forceSubtitle"))).toBeNull();
  });

  it("records the prompt so the same version stays quiet for 24h", async () => {
    await renderWithProviders(<UpdateModal />, {
      config: withUpdate("optional"),
    });
    await waitFor(() =>
      expect(useUpdatePromptStore.getState().lastPromptedVersion).toBe("1.5.0"),
    );
    await renderWithProviders(<UpdateModal />, {
      config: withUpdate("optional"),
    });
    expect(screen.queryByTestId("update-modal-now")).toBeNull();
  });

  it("drops the later button and explains the block for a required update", async () => {
    const { runtime } = await renderWithProviders(<UpdateModal />, {
      config: withUpdate("required"),
    });
    expect(await screen.findByTestId("update-modal-now")).toBeTruthy();
    expect(screen.queryByTestId("update-modal-later")).toBeNull();
    expect(screen.getByText(runtime.t("update.forceSubtitle"))).toBeTruthy();
  });

  it("keeps prompting a required update even inside the throttle window", async () => {
    useUpdatePromptStore.setState({
      lastPromptedVersion: "1.5.0",
      lastPromptedAt: new Date().toISOString(),
    });
    await renderWithProviders(<UpdateModal />, {
      config: withUpdate("required"),
    });
    expect(await screen.findByTestId("update-modal-now")).toBeTruthy();
  });

  it("stays hidden when the tenant has no update url", async () => {
    await renderWithProviders(<UpdateModal />, {
      config: (config) => ({
        ...withUpdate("optional")(config),
        update: {
          ...withUpdate("optional")(config).update,
          full: { ...config.update.full, actionUrl: null },
        },
      }),
    });
    expect(screen.queryByTestId("update-modal-now")).toBeNull();
  });
});
