import { memoryStorage } from "../../../core/gateways/types";
import { MockSessionGateway } from "./mock-session-gateway";

describe("MockSessionGateway", () => {
  const request = {
    address: "0x3f4a8c21b7d94e0a1f6c5d2e8b9a7c3d4e5f9a2c",
    connector: "metamask" as const,
    chains: ["bsc" as const],
    domain: "app.nova.example",
  };

  it("starts signed out, signs in with a challenge and persists the session", async () => {
    const gateway = new MockSessionGateway(memoryStorage());
    expect(await gateway.get()).toBeNull();
    const challenge = await gateway.challenge(request);
    expect(challenge.message).toContain(request.address);
    expect(challenge.message).toContain("Nonce:");
    const session = await gateway.verify(request, challenge, "0xdeadbeefcafe");
    expect(session.ens).toBe("kenneth.eth");
    expect(await gateway.get()).toEqual(session);
  });

  it("rejects malformed signatures and clears on sign out", async () => {
    const gateway = new MockSessionGateway(memoryStorage());
    const challenge = await gateway.challenge(request);
    await expect(gateway.verify(request, challenge, "nope")).rejects.toThrow(
      /signature/,
    );
    await gateway.verify(request, challenge, "0xdeadbeefcafe");
    await gateway.signOut();
    expect(await gateway.get()).toBeNull();
  });
});
