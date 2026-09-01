import { renderHook } from "@testing-library/react-native";
import { BackHandler } from "react-native";
import { useSystemBackHandler } from "./use-system-back";
import type { RootRouteName } from "./system-back";

type BackHandlerCallback = () => boolean;

function captureHandler() {
  const handlers: BackHandlerCallback[] = [];
  jest
    .spyOn(BackHandler, "addEventListener")
    .mockImplementation((_event, callback) => {
      handlers.push(callback as BackHandlerCallback);
      return { remove: jest.fn() } as never;
    });
  return handlers;
}

async function setup(options: {
  updateLocked: boolean;
  route?: RootRouteName;
  canGoBack?: boolean;
}) {
  const handlers = captureHandler();
  const goBack = jest.fn();
  await renderHook(() =>
    useSystemBackHandler({
      updateLocked: options.updateLocked,
      getRouteName: () => options.route ?? "AppShell",
      canGoBack: () => options.canGoBack ?? false,
      goBack,
    }),
  );
  return { press: () => handlers[0]?.() ?? false, goBack };
}

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe("useSystemBackHandler", () => {
  it("swallows the back key while a forced update is on screen", async () => {
    // 回归：调用处曾经硬编码 updateLocked=false，这条分支是死代码
    const { press, goBack } = await setup({ updateLocked: true });

    expect(press()).toBe(true);
    expect(goBack).not.toHaveBeenCalled();
  });

  it("lets the back key through on the shell when no update is forced", async () => {
    const { press, goBack } = await setup({ updateLocked: false });

    // 返回 false = 交给系统（退到桌面），这是首页的正常行为
    expect(press()).toBe(false);
    expect(goBack).not.toHaveBeenCalled();
  });

  it("still navigates back from an inner screen during a forced update", async () => {
    // 锁只针对首页：内层页面照常返回，否则用户会被卡在某个子页面里
    const { press, goBack } = await setup({
      updateLocked: true,
      route: "Wallets",
      canGoBack: true,
    });

    expect(press()).toBe(true);
    expect(goBack).toHaveBeenCalled();
  });
});
