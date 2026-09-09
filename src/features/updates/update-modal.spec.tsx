import { act, fireEvent, screen } from "@testing-library/react-native";
import { useState } from "react";
import { Pressable, Text } from "react-native";
import {
  RuntimeContext,
  useFoundationRuntime,
} from "../../app/runtime-context";
import type { BootstrapConfig } from "../../core/config/bootstrap.schema";
import {
  useApkDownloadStore,
  type ApkDownloadState,
} from "../../core/updates/apk-download-manager";
import { renderWithProviders } from "../../test/harness";
import { UpdateModal } from "./update-modal";

const setDownload = (state: ApkDownloadState) =>
  act(async () => {
    useApkDownloadStore.setState({ state });
  });

/** 嵌套一层运行时：按钮把配置从"没有更新"切成"推荐更新"（模拟会话中途前台刷新拿到新版本），再切成强制 */
function LaterUpdateHost() {
  const runtime = useFoundationRuntime();
  const [decision, setDecision] =
    useState<BootstrapConfig["update"]["decision"]>("none");
  const config = withUpdate(decision)(runtime.config);
  return (
    <RuntimeContext.Provider value={{ ...runtime, config }}>
      <Pressable
        testID="host-recommended"
        onPress={() => setDecision("recommended")}
      >
        <Text>recommended</Text>
      </Pressable>
      <Pressable testID="host-required" onPress={() => setDecision("required")}>
        <Text>required</Text>
      </Pressable>
      <UpdateModal />
    </RuntimeContext.Provider>
  );
}

/** 嵌套一层运行时：按钮模拟"关于页点了检查更新"，每次给一个新的手动提示令牌 */
function ManualCheckHost() {
  const runtime = useFoundationRuntime();
  const [prompt, setPrompt] = useState<{
    version: string;
    requestedAt: number;
  } | null>(null);
  return (
    <RuntimeContext.Provider
      value={{
        ...runtime,
        manualUpdatePrompt: prompt,
        dismissUpdatePrompt: () => setPrompt(null),
      }}
    >
      <Pressable
        testID="host-check"
        onPress={() =>
          setPrompt({
            version: "1.5.0",
            requestedAt: Date.now() + Math.random(),
          })
        }
      >
        <Text>check</Text>
      </Pressable>
      <UpdateModal />
    </RuntimeContext.Provider>
  );
}

function withUpdate(
  decision: BootstrapConfig["update"]["decision"],
  extra: Partial<BootstrapConfig["update"]> = {},
) {
  return (config: BootstrapConfig): BootstrapConfig => ({
    ...config,
    app: { ...config.app, platform: "android", distribution: "direct" },
    features: { ...config.features, directUpdateEnabled: true },
    update: {
      ...config.update,
      decision,
      latestVersion: "1.5.0",
      releaseNotes: ["兑换记录支持筛选", "限价单支持 GTD", "修复深色模式 K 线"],
      ...extra,
      full: {
        ...config.update.full,
        actionUrl: "https://example.test/app.apk",
        releaseId: "rel_1",
        size: 90_596_966,
        ...extra.full,
      },
    },
  });
}

describe("UpdateModal (S-07)", () => {
  beforeEach(() => useApkDownloadStore.setState({ state: { phase: "idle" } }));

  it("stays hidden when there is no update", async () => {
    await renderWithProviders(<UpdateModal />, { config: withUpdate("none") });
    expect(screen.queryByTestId("update-modal-now")).toBeNull();
  });

  it("prompts once on cold start with version, size, notes and both actions", async () => {
    const { runtime } = await renderWithProviders(<UpdateModal />, {
      config: withUpdate("recommended"),
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
    // "稍后"只对本次进程有效：关掉后不再自动弹
    await fireEvent.press(screen.getByTestId("update-modal-later"));
    expect(screen.queryByTestId("update-modal-now")).toBeNull();
  });

  it("re-opens for every new manual check even after it was dismissed", async () => {
    await renderWithProviders(<ManualCheckHost />, {
      config: withUpdate("recommended"),
    });
    await fireEvent.press(await screen.findByTestId("update-modal-later"));
    expect(screen.queryByTestId("update-modal-now")).toBeNull();
    await fireEvent.press(screen.getByTestId("host-check"));
    expect(await screen.findByTestId("update-modal-now")).toBeTruthy();
    // 点遮罩关掉，再检查一次，还得出来
    await fireEvent.press(screen.getByLabelText("关闭"));
    expect(screen.queryByTestId("update-modal-now")).toBeNull();
    await fireEvent.press(screen.getByTestId("host-check"));
    expect(await screen.findByTestId("update-modal-now")).toBeTruthy();
  });

  it("does not auto-prompt for an update that appears mid-session, but a required one always shows", async () => {
    await renderWithProviders(<LaterUpdateHost />, {
      config: withUpdate("none"),
    });
    expect(screen.queryByTestId("update-modal-now")).toBeNull();
    await fireEvent.press(screen.getByTestId("host-recommended"));
    expect(screen.queryByTestId("update-modal-now")).toBeNull();
    await fireEvent.press(screen.getByTestId("host-required"));
    expect(await screen.findByTestId("update-modal-now")).toBeTruthy();
    expect(screen.queryByTestId("update-modal-later")).toBeNull();
  });

  it("drops the later button and explains the block for a required update", async () => {
    const { runtime } = await renderWithProviders(<UpdateModal />, {
      config: withUpdate("required"),
    });
    expect(await screen.findByTestId("update-modal-now")).toBeTruthy();
    expect(screen.queryByTestId("update-modal-later")).toBeNull();
    expect(screen.getByText(runtime.t("update.forceSubtitle"))).toBeTruthy();
  });

  it("gives way while an immediate OTA restart is pending", async () => {
    await renderWithProviders(<UpdateModal />, {
      config: withUpdate("required"),
      runtime: { otaRestartPending: true },
    });
    expect(screen.queryByTestId("update-modal")).toBeNull();
  });

  it("stays hidden when the tenant has no update url", async () => {
    await renderWithProviders(<UpdateModal />, {
      config: withUpdate("recommended", {
        full: {
          channel: "direct",
          actionUrl: null,
          releaseId: null,
          sha256: null,
          size: null,
        },
      }),
    });
    expect(screen.queryByTestId("update-modal-now")).toBeNull();
  });

  it("mirrors the download manager: progress while downloading, resume / retry / install afterwards", async () => {
    const { runtime } = await renderWithProviders(<UpdateModal />, {
      config: withUpdate("recommended"),
    });
    await setDownload({
      phase: "downloading",
      releaseId: "rel_1",
      written: 45_298_483,
      total: 90_596_966,
      bytesPerSecond: 2_000_000,
    });
    expect(await screen.findByTestId("update-modal-progress")).toBeTruthy();
    expect(screen.getByText(runtime.t("update.backgroundHint"))).toBeTruthy();
    expect(screen.queryByTestId("update-modal-now")).toBeNull();

    await setDownload({
      phase: "paused",
      releaseId: "rel_1",
      written: 45_298_483,
      total: 90_596_966,
      reason: "stalled",
      retriesLeft: 0,
    });
    expect(screen.getByText(runtime.t("update.resume"))).toBeTruthy();
    expect(screen.getByText(runtime.t("update.pausedStalled"))).toBeTruthy();

    await setDownload({
      phase: "failed",
      releaseId: "rel_1",
      written: 0,
      total: 90_596_966,
      error: "boom",
    });
    expect(screen.getByText(runtime.t("update.retryDownload"))).toBeTruthy();

    // 下载完成：哪怕之前关掉了，也再弹出来给"安装"
    await fireEvent.press(screen.getByTestId("update-modal-later"));
    expect(screen.queryByTestId("update-modal-now")).toBeNull();
    await setDownload({
      phase: "ready",
      releaseId: "rel_1",
      fileUri: "file:///cache/apk-updates/release-rel_1.apk",
      size: 90_596_966,
    });
    expect(await screen.findByText(runtime.t("update.install"))).toBeTruthy();
  });
});
