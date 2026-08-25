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
  "EAS build profiles use explicit API URLs and distribution channels.",
);
