import { waitFor } from "@testing-library/react-native";
import { createTestGateways, renderWithProviders } from "../../../test/harness";
import { SessionRevalidator } from "../ui/session-revalidator";
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

describe("SessionRevalidator", () => {
  it("clears the cached session when the server says the token is gone", async () => {
    const gateways = createTestGateways();
    const session = signedIn();
    gateways.session.get = jest.fn(async () => session);
    gateways.session.refresh = jest.fn(async () => null);

    const { queryClient } = await renderWithProviders(<SessionRevalidator />, {
      gateways,
    });
    await waitFor(() =>
      expect(queryClient.getQueryData(["session"])).toBeNull(),
    );
    expect(gateways.session.refresh).toHaveBeenCalled();
  });

  it("keeps the session the server still recognises", async () => {
    const gateways = createTestGateways();
    const session = signedIn();
    gateways.session.get = jest.fn(async () => session);
    gateways.session.refresh = jest.fn(async () => session);

    const { queryClient } = await renderWithProviders(<SessionRevalidator />, {
      gateways,
    });
    await waitFor(() =>
      expect(queryClient.getQueryData(["session"])).toEqual(session),
    );
  });

  it("does nothing when the gateway cannot revalidate", async () => {
    const gateways = createTestGateways();
    // Mock 会话没有 refresh：不能因此报错
    expect(gateways.session.refresh).toBeUndefined();
    await expect(
      renderWithProviders(<SessionRevalidator />, { gateways }),
    ).resolves.toBeTruthy();
  });
});
