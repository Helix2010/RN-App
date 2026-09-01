import { screen, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";
import { createTestGateways, renderWithProviders } from "../../../test/harness";
import { SessionRevalidator } from "../ui/session-revalidator";
import { useSession } from "./use-session";
import type { Session } from "../model/session";

function signedIn(): Session {
  return {
    address: "0x9858EfFD232B4033E47d90003D41EC34EcaEda94",
    connector: "embedded",
    chains: ["bsc"],
    expiresAt: "2099-01-01T00:00:00.000Z",
    signedInAt: "2026-09-01T00:00:00.000Z",
  };
}

/**
 * 断言走真实消费者而不是 `queryClient.getQueryData`：测试用的 QueryClient 是
 * `gcTime: 0`，没有观察者的缓存项会被立刻回收，直接读缓存等于和 GC 赛跑
 * （本地过、CI 挂）。真实 App 里会话永远有人在看，这样也更接近实际。
 */
function SessionProbe() {
  const { data, isPending } = useSession();
  return (
    <Text testID="probe">
      {isPending ? "loading" : (data?.address ?? "signed-out")}
    </Text>
  );
}

function tree() {
  return (
    <>
      <SessionRevalidator />
      <SessionProbe />
    </>
  );
}

/** 手动控制 refresh 的落地时机：否则它和本地 get() 的写入顺序不确定。 */
function deferredRefresh() {
  let settle!: (value: Session | null) => void;
  const refresh = jest.fn(
    () =>
      new Promise<Session | null>((resolve) => {
        settle = resolve;
      }),
  );
  return { refresh, settle: (value: Session | null) => settle(value) };
}

describe("SessionRevalidator", () => {
  it("signs the user out when the server no longer knows the token", async () => {
    const gateways = createTestGateways();
    const session = signedIn();
    const { refresh, settle } = deferredRefresh();
    // 真实网关在 401 时会清掉本地存储，get() 之后只能读到空
    let stored: Session | null = session;
    gateways.session.get = jest.fn(async () => stored);
    gateways.session.refresh = refresh;

    await renderWithProviders(tree(), { gateways });
    // 先让本地缓存的会话落地，再让服务端说"这个令牌没了"
    await waitFor(() =>
      expect(screen.getByTestId("probe")).toHaveTextContent(session.address),
    );

    stored = null;
    settle(null);

    await waitFor(() =>
      expect(screen.getByTestId("probe")).toHaveTextContent("signed-out"),
    );
  });

  it("keeps the session the server still recognises", async () => {
    const gateways = createTestGateways();
    const session = signedIn();
    const { refresh, settle } = deferredRefresh();
    gateways.session.get = jest.fn(async () => session);
    gateways.session.refresh = refresh;

    await renderWithProviders(tree(), { gateways });
    await waitFor(() => expect(refresh).toHaveBeenCalled());

    settle(session);

    await waitFor(() =>
      expect(screen.getByTestId("probe")).toHaveTextContent(session.address),
    );
  });

  it("does nothing when the gateway cannot revalidate", async () => {
    const gateways = createTestGateways();
    // Mock 会话没有 refresh：不能因此报错
    expect(gateways.session.refresh).toBeUndefined();
    await expect(
      renderWithProviders(tree(), { gateways }),
    ).resolves.toBeTruthy();
  });
});
