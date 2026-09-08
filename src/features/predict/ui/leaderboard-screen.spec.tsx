import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import {
  createTestGateways,
  renderWithProviders,
  signIn,
} from "../../../test/harness";
import type { InMemoryPredictAccountGateway } from "../../../test/predict-account";
import { LeaderboardScreen } from "./leaderboard-screen";

describe("LeaderboardScreen nickname", () => {
  it("shows the platform pseudonym and lets a logged-in account set a nickname", async () => {
    const gateways = createTestGateways();
    const session = await signIn(gateways);
    const account = gateways.predictAccount as InMemoryPredictAccountGateway;
    await account.enable(session.address);
    await renderWithProviders(
      <LeaderboardScreen onBack={jest.fn()} onOpenPositions={jest.fn()} />,
      { gateways },
    );
    expect(await screen.findByText("Quiet-Fox")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("leaderboard-edit-nickname"));
    await fireEvent.changeText(
      await screen.findByTestId("nickname-input", {}, { timeout: 3000 }),
      "Keen Bear",
    );
    await fireEvent.press(screen.getByTestId("nickname-save"));
    await waitFor(() => expect(account.profileState.name).toBe("Keen Bear"));
    expect(account.calls).toContain("profile");
    expect(await screen.findByText("Keen Bear")).toBeTruthy();
  });

  it("hides the edit entry until the account has logged in to the platform", async () => {
    const gateways = createTestGateways();
    await signIn(gateways);
    await renderWithProviders(
      <LeaderboardScreen onBack={jest.fn()} onOpenPositions={jest.fn()} />,
      { gateways },
    );
    expect(await screen.findByText("Quiet-Fox")).toBeTruthy();
    expect(screen.queryByTestId("leaderboard-edit-nickname")).toBeNull();
  });
});
