import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const eas = JSON.parse(
  readFileSync(resolve(process.cwd(), "eas.json"), "utf8"),
);
const expectedChannels = {
  development: "development",
  staging: "staging",
  "production-store": "store",
  "android-direct": "direct",
  "ios-mdm": "mdm",
};
const expectedOtaChannels = {
  development: "development",
  staging: "staging",
  "production-store": "production",
  "android-direct": "production",
  "ios-mdm": "production",
};

for (const [profileName, expectedChannel] of Object.entries(expectedChannels)) {
  const profile = eas.build?.[profileName];
  if (!profile) {
    throw new Error(`Missing EAS build profile: ${profileName}`);
  }

  const channel = profile.env?.EXPO_PUBLIC_DISTRIBUTION_CHANNEL;
  if (channel !== expectedChannel) {
    throw new Error(
      `${profileName} must use distribution channel ${expectedChannel}, received ${channel ?? "missing"}`,
    );
  }

  const otaChannel = profile.env?.EXPO_PUBLIC_OTA_CHANNEL;
  if (otaChannel !== expectedOtaChannels[profileName]) {
    throw new Error(
      `${profileName} must use OTA channel ${expectedOtaChannels[profileName]}, received ${otaChannel ?? "missing"}`,
    );
  }

  const applicationId = profile.env?.EXPO_PUBLIC_APPLICATION_ID;
  if (
    typeof applicationId !== "string" ||
    !/^[a-z0-9][a-z0-9_-]{1,119}$/.test(applicationId)
  ) {
    throw new Error(`${profileName} must declare a valid application id`);
  }

  const apiBaseUrl = profile.env?.EXPO_PUBLIC_API_BASE_URL;
  if (profileName === "development") {
    if (apiBaseUrl !== "http://localhost:3000") {
      throw new Error("Development must use the documented local API URL");
    }
    continue;
  }

  if (
    typeof apiBaseUrl !== "string" ||
    !apiBaseUrl.startsWith("https://") ||
    apiBaseUrl.includes("localhost") ||
    apiBaseUrl.includes("127.0.0.1")
  ) {
    throw new Error(`${profileName} must use a non-local HTTPS API URL`);
  }
}

console.log(
  "EAS build profiles pin the tenant API domain, application and distribution.",
);
