import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { useState } from "react";
import { Text } from "react-native";
import type {
  BootstrapConfig,
  BrandingAsset,
} from "../core/config/bootstrap.schema";
import {
  loadBootstrap,
  loadCachedBootstrap,
  type BootstrapSnapshot,
} from "../core/config/bootstrap-repository";
import { createFallbackConfig } from "../core/config/fallback-config";
import { enabledChains } from "../core/wallet/config/wallet-runtime-config";
import { withWallet } from "../test/wallet-config";
import { FoundationRuntimeProvider } from "./runtime-context";

jest.mock("../core/config/bootstrap-repository", () => ({
  loadBootstrap: jest.fn(),
  loadCachedBootstrap: jest.fn(async () => null),
}));
jest.mock("../core/updates/update-service", () => ({
  applyDownloadedOta: jest.fn(),
  checkAndDownloadOta: jest.fn(async () => ({
    status: "none",
    messageKey: "",
    metadata: null,
  })),
}));
jest.mock("../core/updates/update-coordinator", () => ({
  resolveUpdatePlan: () => "none",
}));
// 必须是稳定引用：provider 把它放进 effect 依赖里，每次渲染换新对象就会无限重渲染
const IDLE_UPDATE_STATUS = { status: "none", messageKey: "", metadata: null };
jest.mock("../core/updates/use-update-status", () => ({
  useUpdateStatus: () => IDLE_UPDATE_STATUS,
}));
jest.mock("../core/device/installation-service", () => ({
  registerPushTokenIfAuthorized: jest.fn(async () => "unavailable"),
  subscribeToUpdateSignals: jest.fn(() => () => undefined),
}));
jest.mock("../core/config/branding-assets", () => ({
  ...jest.requireActual("../core/config/branding-assets"),
  warmBrandingAssets: jest.fn(async () => ({})),
}));
jest.mock("expo-localization", () => ({
  getLocales: () => [{ languageCode: "zh" }],
}));

const loadBootstrapMock = loadBootstrap as jest.MockedFunction<
  typeof loadBootstrap
>;
const loadCachedBootstrapMock = loadCachedBootstrap as jest.MockedFunction<
  typeof loadCachedBootstrap
>;

function asset(id: string, localFileUrl?: string): BrandingAsset {
  return {
    assetId: id,
    objectKey: `branding/${id}`,
    fileUrl: `https://cdn.example/${id}.png`,
    fileName: `${id}.png`,
    mimeType: "image/png",
    size: 1024,
    sha256: "a".repeat(64),
    width: 256,
    height: 256,
    ...(localFileUrl ? { localFileUrl } : {}),
  };
}

/** 一份带 logo 的租户品牌配置；`version` 用来区分缓存里的与本次下发的。 */
function brandedConfig(version: number, logo: BrandingAsset): BootstrapConfig {
  const base = createFallbackConfig("zh-CN");
  const branding = base.branding!;
  return {
    ...base,
    branding: {
      ...branding,
      version,
      launch: {
        ...branding.launch,
        minDisplayMs: 300,
        visuals: {
          light: { ...branding.launch.visuals.light, logo },
          dark: { ...branding.launch.visuals.dark, logo },
        },
      },
    },
  };
}

function remote(config: BootstrapConfig): BootstrapSnapshot {
  return { config, source: "remote" };
}

/** 业务界面的替身：首帧就读钱包运行时配置，验证它在挂载前已经应用 */
function Probe() {
  const [chains] = useState(() => enabledChains());
  return <Text testID="probe">{chains.join(",")}</Text>;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const sleep = (ms: number) =>
  act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));

let client: QueryClient | null = null;
// bootstrap 查询自带 24 小时的 gcTime，不清掉这个定时器 jest 就不会退出
afterEach(() => client?.clear());

async function renderProvider() {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  await render(
    <QueryClientProvider client={client}>
      <FoundationRuntimeProvider>
        <Probe />
      </FoundationRuntimeProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  loadBootstrapMock.mockReset();
  loadCachedBootstrapMock.mockReset();
  loadCachedBootstrapMock.mockResolvedValue(null);
});

describe("FoundationRuntimeProvider startup gate", () => {
  it("keeps the launch screen until this launch's remote bootstrap arrives, then mounts children with the wallet config already applied", async () => {
    const bootstrap = deferred<BootstrapSnapshot>();
    loadBootstrapMock.mockReturnValue(bootstrap.promise);

    await renderProvider();

    expect(screen.getByTestId("launch-screen")).toBeTruthy();
    // 最短停留时间早就过了，但下发还没到：不放行，也没有"超时放行"
    await sleep(900);
    expect(screen.queryByTestId("probe")).toBeNull();

    bootstrap.resolve(
      remote(withWallet(createFallbackConfig("zh-CN"), { chains: ["eth"] })),
    );

    await waitFor(() => expect(screen.getByTestId("probe")).toBeTruthy(), {
      timeout: 3000,
    });
    // 业务界面首帧读到的就是本次下发的链集合
    expect(screen.getByTestId("probe").props.children).toBe("eth");
    expect(screen.queryByTestId("launch-screen")).toBeNull();
  });

  it("paints no logo until it knows which branding this launch uses", async () => {
    const cache = deferred<BootstrapConfig | null>();
    loadCachedBootstrapMock.mockReturnValue(cache.promise);
    loadBootstrapMock.mockReturnValue(new Promise(() => undefined));

    await renderProvider();

    // 缓存还没读完：只有背景和一句状态文案，没有内置标——先画内置标再换租户 logo 就是两张图
    expect(screen.getByTestId("launch-pending")).toBeTruthy();
    expect(screen.queryByTestId("launch-logo")).toBeNull();

    cache.resolve(
      brandedConfig(1, asset("logo-a", "file:///cache/logo-a.png")),
    );

    await waitFor(() =>
      expect(screen.getByTestId("launch-logo").props.source).toEqual({
        uri: "file:///cache/logo-a.png",
      }),
    );
  });

  it("freezes the launch visual on the cached branding even when the server delivers a newer version", async () => {
    loadCachedBootstrapMock.mockResolvedValue(
      brandedConfig(1, asset("logo-a", "file:///cache/logo-a.png")),
    );
    const bootstrap = deferred<BootstrapSnapshot>();
    loadBootstrapMock.mockReturnValue(bootstrap.promise);

    await renderProvider();
    await waitFor(() =>
      expect(screen.getByTestId("launch-logo").props.source).toEqual({
        uri: "file:///cache/logo-a.png",
      }),
    );

    // 新版本到了：本次启动页不换图，新资源留给下一次启动
    bootstrap.resolve(remote(brandedConfig(2, asset("logo-b"))));
    await sleep(100);
    expect(screen.getByTestId("launch-logo").props.source).toEqual({
      uri: "file:///cache/logo-a.png",
    });

    await waitFor(() => expect(screen.getByTestId("probe")).toBeTruthy(), {
      timeout: 3000,
    });
  });

  it("stays entered when a later refresh fails", async () => {
    // 进入过就锁住：运行中的配置刷新失败不该把用户踢回门禁
    loadBootstrapMock.mockResolvedValueOnce(
      remote(withWallet(createFallbackConfig("zh-CN"), { chains: ["eth"] })),
    );
    await renderProvider();
    await waitFor(() => expect(screen.getByTestId("probe")).toBeTruthy(), {
      timeout: 3000,
    });

    loadBootstrapMock.mockRejectedValueOnce(new Error("offline"));
    await act(async () => {
      await client?.refetchQueries({ queryKey: ["mobile-bootstrap"] });
    });

    expect(screen.getByTestId("probe")).toBeTruthy();
    expect(screen.queryByText("暂时无法启动应用")).toBeNull();
  });

  it("marks the balance and portfolio caches for re-read when the delivered wallet config changes", async () => {
    // 管理端加了一条链 / 上了一个新币之后，下一次配置刷新就要让依赖目录的查询重读；
    // 只失效余额、漏掉资产总览的话，首页金额会停在改动之前
    loadBootstrapMock.mockResolvedValueOnce(
      remote(withWallet(createFallbackConfig("zh-CN"), { chains: ["eth"] })),
    );
    await renderProvider();
    await waitFor(() => expect(screen.getByTestId("probe")).toBeTruthy(), {
      timeout: 3000,
    });
    const keys = [
      ["wallet-balances", "0xabc", "all"],
      ["assets", "0xabc", false],
      ["wallet-recent-recipients", "0xabc"],
    ];
    for (const key of keys) {
      // 这个 client 的默认 gcTime 是 0，没有订阅者的缓存会立刻被回收
      client?.setQueryDefaults([key[0] as string], { gcTime: 60_000 });
      client?.setQueryData(key, []);
    }

    loadBootstrapMock.mockResolvedValueOnce(
      remote(
        withWallet(createFallbackConfig("zh-CN"), { chains: ["eth", "bsc"] }),
      ),
    );
    await act(async () => {
      await client?.refetchQueries({ queryKey: ["mobile-bootstrap"] });
    });

    for (const key of keys)
      expect(client?.getQueryState(key)?.isInvalidated).toBe(true);
  });

  it("shows the retry screen when the bootstrap request fails and never enters on stale data", async () => {
    loadCachedBootstrapMock.mockResolvedValue(createFallbackConfig("zh-CN"));
    loadBootstrapMock.mockRejectedValueOnce(new Error("offline"));

    await renderProvider();

    await waitFor(() =>
      expect(screen.getByText("暂时无法启动应用")).toBeTruthy(),
    );
    expect(screen.queryByTestId("probe")).toBeNull();

    // 重试成功后才进入
    loadBootstrapMock.mockResolvedValueOnce(
      remote(withWallet(createFallbackConfig("zh-CN"), { chains: ["bsc"] })),
    );
    void fireEvent.press(screen.getByRole("button"));

    await waitFor(() => expect(screen.getByTestId("probe")).toBeTruthy(), {
      timeout: 3000,
    });
    expect(screen.getByTestId("probe").props.children).toBe("bsc");
  });
});
