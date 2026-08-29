import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Application from "expo-application";
import * as Crypto from "expo-crypto";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { z } from "zod";
import type { BootstrapConfig } from "../config/bootstrap.schema";
import type { ThemePreference } from "../preferences/preferences-store";
import { apiClient, appRuntime } from "../network/api-client";

const INSTALLATION_KEY = "foundation.installation-id.v1";
const CREDENTIAL_KEY = "foundation.installation-credential.v1";
const HEARTBEAT_KEY = "foundation.installation-heartbeat.v1";
const HEARTBEAT_INTERVAL_MS = 30 * 60 * 1_000;

const heartbeatResponseSchema = z.object({
  installationId: z.string(),
  deviceGrouping: z.enum(["available", "disabled"]),
  heartbeatIntervalSeconds: z.number(),
  receivedAt: z.string(),
  credentialRotated: z.boolean().optional(),
  installationCredential: z.string().optional(),
  credentialVersion: z.number().optional(),
  credentialExpiresAt: z.string().optional(),
});
const pushResponseSchema = z.object({
  registered: z.literal(true),
  provider: z.enum(["fcm", "apns", "hms"]),
  updatedAt: z.string(),
});

async function installationId(): Promise<string> {
  const current = await SecureStore.getItemAsync(INSTALLATION_KEY);
  if (current) return current;
  const created = `inst_${Crypto.randomUUID().replaceAll("-", "")}`;
  await SecureStore.setItemAsync(INSTALLATION_KEY, created, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
  return created;
}

async function deviceSourceHash(): Promise<string> {
  try {
    const source =
      Platform.OS === "android"
        ? Application.getAndroidId()
        : await Application.getIosIdForVendorAsync();
    if (!source) return "";
    return Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      `${Platform.OS}:${source}`,
    );
  } catch {
    return "";
  }
}

export async function syncInstallationHeartbeat(
  config: BootstrapConfig,
  theme: ThemePreference,
  force = false,
): Promise<void> {
  const last = Number(await AsyncStorage.getItem(HEARTBEAT_KEY));
  const storedCredential = await SecureStore.getItemAsync(CREDENTIAL_KEY);
  if (
    !force &&
    storedCredential &&
    Number.isFinite(last) &&
    Date.now() - last < HEARTBEAT_INTERVAL_MS
  )
    return;
  const id = await installationId();
  let credential = storedCredential;
  if (!credential) {
    const registration = await apiClient.post(
      "/v1/mobile/installations/register",
      {
        installationId: id,
        deviceSourceHash: await deviceSourceHash(),
        packageId: Application.applicationId ?? appRuntime.applicationId,
        otaChannel: appRuntime.otaChannel,
        otaRevision: config.update.ota.revision ?? null,
        localizationVersion: config.localization.messagesVersion,
        brandingVersion: config.branding?.version ?? null,
        locale: config.localization.selectedLocale,
        theme,
        osVersion: String(Platform.Version),
        deviceClass: Platform.OS === "android" ? "android-phone" : "ios-device",
      },
      z.object({
        installationId: z.string(),
        installationCredential: z.string(),
        credentialVersion: z.number(),
        credentialExpiresAt: z.string(),
        heartbeatIntervalSeconds: z.number(),
        receivedAt: z.string(),
      }),
    );
    credential = registration.installationCredential;
    await SecureStore.setItemAsync(CREDENTIAL_KEY, credential, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
  }
  const response = await apiClient.post(
    "/v1/mobile/installations/heartbeat",
    {
      installationId: id,
      deviceSourceHash: await deviceSourceHash(),
      packageId: Application.applicationId ?? appRuntime.applicationId,
      otaChannel: appRuntime.otaChannel,
      otaRevision: config.update.ota.revision ?? null,
      localizationVersion: config.localization.messagesVersion,
      brandingVersion: config.branding?.version ?? null,
      locale: config.localization.selectedLocale,
      theme,
      osVersion: String(Platform.Version),
      deviceClass: Platform.OS === "android" ? "android-phone" : "ios-device",
    },
    heartbeatResponseSchema,
    { headers: { Authorization: `Installation ${credential}` } },
  );
  if (response.credentialRotated && response.installationCredential) {
    await SecureStore.setItemAsync(
      CREDENTIAL_KEY,
      response.installationCredential,
      {
        keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
      },
    );
  }
  await AsyncStorage.setItem(HEARTBEAT_KEY, String(Date.now()));
}

export async function registerPushTokenIfAuthorized(
  config: BootstrapConfig,
  theme: ThemePreference,
  requestPermission = false,
): Promise<"registered" | "denied" | "unavailable"> {
  try {
    await syncInstallationHeartbeat(config, theme);
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("updates", {
        name: "App updates",
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    let permission = await Notifications.getPermissionsAsync();
    if (!permission.granted && requestPermission)
      permission = await Notifications.requestPermissionsAsync();
    if (!permission.granted) return "denied";
    const credential = await SecureStore.getItemAsync(CREDENTIAL_KEY);
    if (!credential) return "unavailable";
    const token = await Notifications.getDevicePushTokenAsync();
    if (typeof token.data !== "string" || token.data === "")
      return "unavailable";
    const provider = Platform.OS === "android" ? "fcm" : "apns";
    await apiClient.post(
      "/v1/mobile/push-tokens",
      {
        installationId: await installationId(),
        provider,
        token: token.data,
        environment:
          Platform.OS === "ios"
            ? ((await Application.getIosPushNotificationServiceEnvironmentAsync()) ??
              "production")
            : "production",
        permissionStatus: permission.status,
      },
      pushResponseSchema,
      { headers: { Authorization: `Installation ${credential}` } },
    );
    return "registered";
  } catch {
    return "unavailable";
  }
}

export function subscribeToUpdateSignals(onSignal: () => void): () => void {
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const rawVisible = notification.request.content.data?.requiresUserAction;
      const visible = rawVisible === true || rawVisible === "true";
      return {
        shouldShowBanner: visible,
        shouldShowList: visible,
        shouldPlaySound: visible,
        shouldSetBadge: false,
      };
    },
  });
  const received = Notifications.addNotificationReceivedListener(() =>
    onSignal(),
  );
  const opened = Notifications.addNotificationResponseReceivedListener(() =>
    onSignal(),
  );
  return () => {
    received.remove();
    opened.remove();
  };
}
