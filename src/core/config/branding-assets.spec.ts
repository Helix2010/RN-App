import type { BrandingAsset } from "./bootstrap.schema";
import { brandingAssetUrl, resolveBrandingVisual } from "./branding-assets";

jest.mock("../network/api-client", () => ({
  appRuntime: {
    apiBaseUrl: "https://api.tenant.example",
    applicationId: "dex-mobile",
  },
}));

jest.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///branding-test/",
}));

const logo: BrandingAsset = {
  assetId: "brand_logo",
  objectKey: "tenants/1/branding/logo.png",
  fileUrl: "/v1/mobile/branding/assets/brand_logo",
  fileName: "logo.png",
  mimeType: "image/png",
  size: 1024,
  sha256: "a".repeat(64),
  width: 512,
  height: 512,
};

describe("tenant branding assets", () => {
  it("uses the tenant asset from the other theme when the selected theme has no image", () => {
    const visual = resolveBrandingVisual(
      {
        light: {
          backgroundColor: "#ffffff",
          logo,
          backgroundImage: { ...logo, assetId: "brand_background" },
        },
        dark: { backgroundColor: "#000000" },
      },
      "dark",
    );

    expect(visual.backgroundColor).toBe("#000000");
    expect(visual.logo?.assetId).toBe("brand_logo");
    expect(visual.backgroundImage?.assetId).toBe("brand_background");
  });

  it("resolves relative tenant asset URLs against the packaged API origin", () => {
    expect(brandingAssetUrl(logo)).toBe(
      "https://api.tenant.example/v1/mobile/branding/assets/brand_logo",
    );
  });
});
