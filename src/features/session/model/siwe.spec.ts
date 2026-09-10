import {
  SiweMessageRejected,
  assertSiweMessage,
  parseSiweMessage,
} from "./siwe";

const DOMAIN = "api.example.com";
const ADDRESS = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";
const NONCE = "server-nonce";
const NOW = Date.parse("2026-09-01T00:00:00.000Z");

function message(overrides?: {
  domain?: string;
  address?: string;
  nonce?: string;
  expirationTime?: string | null;
}): string {
  const lines = [
    `${overrides?.domain ?? DOMAIN} wants you to sign in with your Ethereum account:`,
    overrides?.address ?? ADDRESS,
    "",
    "Sign in to continue.",
    "",
    `URI: https://${DOMAIN}`,
    "Version: 1",
    "Chain ID: 56",
    `Nonce: ${overrides?.nonce ?? NONCE}`,
    "Issued At: 2026-09-01T00:00:00.000Z",
  ];
  const expiration =
    overrides?.expirationTime === undefined
      ? "2026-09-01T00:10:00.000Z"
      : overrides.expirationTime;
  if (expiration !== null) lines.push(`Expiration Time: ${expiration}`);
  return lines.join("\n");
}

const expected = { domain: DOMAIN, address: ADDRESS, nonce: NONCE, nowMs: NOW };

describe("SIWE message check", () => {
  it("reads the fields the app has to verify", () => {
    const parsed = parseSiweMessage(message());
    expect(parsed).toMatchObject({
      domain: DOMAIN,
      address: ADDRESS,
      uri: `https://${DOMAIN}`,
      chainId: 56,
      nonce: NONCE,
    });
  });

  it("accepts the message the server issued for this account", () => {
    expect(() => assertSiweMessage(message(), expected)).not.toThrow();
  });

  it("refuses a message that would sign the user in to another domain", () => {
    expect(() =>
      assertSiweMessage(message({ domain: "evil.example.com" }), expected),
    ).toThrow(SiweMessageRejected);
  });

  it("refuses a message bound to a different account", () => {
    expect(() =>
      assertSiweMessage(
        message({ address: "0x1111111111111111111111111111111111111111" }),
        expected,
      ),
    ).toThrow(/is not the account being signed in/);
  });

  it("accepts the same account written in a different letter case", () => {
    expect(() =>
      assertSiweMessage(message({ address: ADDRESS.toLowerCase() }), expected),
    ).not.toThrow();
  });

  it("refuses a nonce the app never asked for", () => {
    expect(() =>
      assertSiweMessage(message({ nonce: "someone-elses" }), expected),
    ).toThrow(/nonce does not match/);
  });

  it("refuses a message that has already expired", () => {
    expect(() =>
      assertSiweMessage(message(), {
        ...expected,
        nowMs: Date.parse("2026-09-01T01:00:00.000Z"),
      }),
    ).toThrow(/already expired/);
  });

  it("refuses a message with an unreadable expiry rather than ignoring it", () => {
    expect(() =>
      assertSiweMessage(message({ expirationTime: "soon" }), expected),
    ).toThrow(/not a valid timestamp/);
  });

  it("accepts a message with no expiry at all", () => {
    expect(() =>
      assertSiweMessage(message({ expirationTime: null }), expected),
    ).not.toThrow();
  });

  it("refuses text that is not an EIP-4361 message", () => {
    expect(parseSiweMessage("please sign this")).toBeNull();
    expect(() => assertSiweMessage("please sign this", expected)).toThrow(
      /not a valid EIP-4361 message/,
    );
  });
});
