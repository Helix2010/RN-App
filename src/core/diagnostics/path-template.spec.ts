import { pathTemplate } from "./path-template";

describe("pathTemplate", () => {
  it.each([
    ["keeps a plain route", "/v1/mobile/auth/nonce", "/v1/mobile/auth/nonce"],
    [
      "drops the query string, which can carry a cursor or an address",
      "/v1/mobile/wallet/transfers?limit=50&cursor=eyJhZGRyZXNzIjoiMHg",
      "/v1/mobile/wallet/transfers",
    ],
    [
      "drops scheme and host from a server-delivered absolute URL",
      "https://cdn.example.com/v1/mobile/languages/zh-CN/document?sig=abc",
      "/v1/mobile/languages/zh-CN/document",
    ],
    [
      "collapses an address segment",
      "/v1/mobile/wallet/0x71C7656EC7ab88b098defB751B7401B5f6d8976F/balance",
      "/v1/mobile/wallet/:id/balance",
    ],
    [
      "collapses a UUID segment",
      "/v1/ota/assets/5f0c7a1e-3b2d-4e8f-9a6b-1c2d3e4f5a6b/bundle",
      "/v1/ota/assets/:id/bundle",
    ],
    [
      "collapses a long opaque token segment",
      "/v1/mobile/branding/assets/brand_Xk2pQ9vLm3Nz8RtY4wBc7Hd",
      "/v1/mobile/branding/assets/:id",
    ],
    [
      "keeps a short locale segment",
      "/v1/mobile/languages/en-US/document",
      "/v1/mobile/languages/en-US/document",
    ],
  ])("%s", (_name, input, expected) => {
    expect(pathTemplate(input)).toBe(expected);
  });
});
