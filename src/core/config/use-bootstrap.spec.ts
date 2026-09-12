import {
  bootstrapQueryFn,
  bootstrapRetryDelay,
  shouldRetryBootstrap,
} from "./use-bootstrap";
import { loadBootstrap, loadCachedBootstrap } from "./bootstrap-repository";
import { createFallbackConfig } from "./fallback-config";
import { AppError } from "../network/app-error";

jest.mock("./bootstrap-repository", () => ({
  loadBootstrap: jest.fn(),
  loadCachedBootstrap: jest.fn(),
}));
jest.mock("../wallet/config/wallet-runtime-config", () => ({
  applyDeliveredWalletConfig: jest.fn(),
}));
jest.mock("../predict-platform/config", () => ({
  applyDeliveredServices: jest.fn(),
}));

const load = loadBootstrap as jest.MockedFunction<typeof loadBootstrap>;
const cached = loadCachedBootstrap as jest.MockedFunction<
  typeof loadCachedBootstrap
>;
const { applyDeliveredWalletConfig } = jest.requireMock(
  "../wallet/config/wallet-runtime-config",
) as { applyDeliveredWalletConfig: jest.Mock };

const config = createFallbackConfig("zh-CN");
const offline = (): AppError =>
  new AppError("network", "The service is unreachable", true);

beforeEach(() => {
  jest.clearAllMocks();
});

describe("bootstrapQueryFn", () => {
  it("请求失败时用上一次成功下发的缓存启动，而不是把用户挡在门禁外", async () => {
    load.mockRejectedValue(offline());
    cached.mockResolvedValue(config);

    const snapshot = await bootstrapQueryFn("zh-CN");

    expect(snapshot.source).toBe("cache");
    // 缓存这条路同样要把钱包运行时配置应用上，否则业务页会跑在内置配置上
    expect(applyDeliveredWalletConfig).toHaveBeenCalledWith(config.wallet);
  });

  it("没有缓存就照实抛错——这时确实没有任何可用配置", async () => {
    load.mockRejectedValue(offline());
    cached.mockResolvedValue(null);

    await expect(bootstrapQueryFn("zh-CN")).rejects.toThrow(AppError);
  });

  it("读缓存本身失败也不掩盖原始错误", async () => {
    load.mockRejectedValue(offline());
    cached.mockRejectedValue(new Error("storage is gone"));

    await expect(bootstrapQueryFn("zh-CN")).rejects.toThrow(
      "The service is unreachable",
    );
  });

  it("请求被取消时不退回缓存：切语言会中止上一发，那不是失败", async () => {
    const controller = new AbortController();
    controller.abort();
    load.mockRejectedValue(offline());
    cached.mockResolvedValue(config);

    await expect(bootstrapQueryFn("zh-CN", controller.signal)).rejects.toThrow(
      AppError,
    );
    expect(cached).not.toHaveBeenCalled();
  });

  it("成功时仍然是 remote，缓存不参与", async () => {
    load.mockResolvedValue({ config, source: "remote" });

    const snapshot = await bootstrapQueryFn("zh-CN");

    expect(snapshot.source).toBe("remote");
    expect(cached).not.toHaveBeenCalled();
  });
});

describe("shouldRetryBootstrap", () => {
  it("传输失败重试，最多两次", () => {
    expect(shouldRetryBootstrap(0, offline())).toBe(true);
    expect(shouldRetryBootstrap(1, offline())).toBe(true);
    expect(shouldRetryBootstrap(2, offline())).toBe(false);
  });

  it("确定性失败不重试：结论不会变，只会多晾用户几秒", () => {
    const badRequest = new AppError("server", "Request failed", false);
    expect(shouldRetryBootstrap(0, badRequest)).toBe(false);
    expect(shouldRetryBootstrap(0, new Error("schema mismatch"))).toBe(false);
  });

  it("退避有上限", () => {
    expect(bootstrapRetryDelay(0)).toBeLessThan(bootstrapRetryDelay(1));
    expect(bootstrapRetryDelay(10)).toBe(4_000);
  });
});
