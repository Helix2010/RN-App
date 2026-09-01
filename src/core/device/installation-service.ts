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
import { AppError } from "../network/app-error";

const INSTALLATION_KEY = "foundation.installation-id.v1";
const CREDENTIAL_KEY = "foundation.installation-credential.v1";
const LEGACY_HEARTBEAT_KEY = "foundation.installation-heartbeat.v1";
const HEARTBEAT_KEY = "foundation.installation-heartbeat.v2";
const HEARTBEAT_INTERVAL_MS = 30 * 60 * 1_000;

const heartbeatRecordSchema = z.object({
  at: z.number(),
  fingerprint: z.string(),
});

const heartbeatResponseSchema = z.object({
  installationId: z.string(),
  // RN-Server dropped deviceGrouping in d8ff86d; keep it optional so older
  // and newer servers both satisfy the mobile contract.
  deviceGrouping: z.enum(["available", "disabled"]).optional(),
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

type InstallationReport = {
  installationId: string;
  deviceSourceHash: string;
  packageId: string;
  otaChannel: string;
  otaRevision: number | null;
  localizationVersion: string;
  brandingVersion: number | null;
  locale: string;
  theme: ThemePreference;
  osVersion: string;
  deviceClass: string;
};

function installationReport(
  id: string,
  sourceHash: string,
  config: BootstrapConfig,
  theme: ThemePreference,
): InstallationReport {
  return {
    installationId: id,
    deviceSourceHash: sourceHash,
    packageId: Application.applicationId ?? appRuntime.applicationId,
    otaChannel: appRuntime.otaChannel,
    otaRevision: config.update.ota.revision ?? null,
    localizationVersion: config.localization.messagesVersion,
    brandingVersion: config.branding?.version ?? null,
    locale: config.localization.selectedLocale,
    theme,
    osVersion: String(Platform.Version),
    deviceClass: Platform.OS === "android" ? "android-phone" : "ios-device",
  };
}

/**
 * 心跳节流指纹：原生构建身份（版本 / Build / runtime / 渠道）+ 上报的全部元数据。
 * 任一字段变化（覆盖安装、OTA、切语言、切主题…）都跳过 30 分钟节流立即上报，
 * 这样管理端的设备信息不会滞后一个心跳周期。
 */
export function heartbeatFingerprint(report: InstallationReport): string {
  const { installationId: _id, deviceSourceHash: _hash, ...reported } = report;
  return JSON.stringify({
    version: appRuntime.version,
    buildNumber: appRuntime.buildNumber,
    runtimeVersion: appRuntime.runtimeVersion,
    distributionChannel: appRuntime.distributionChannel,
    ...reported,
  });
}

async function readHeartbeatRecord(): Promise<{
  at: number;
  fingerprint: string;
} | null> {
  try {
    const raw = await AsyncStorage.getItem(HEARTBEAT_KEY);
    if (!raw) return null;
    const parsed = heartbeatRecordSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

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
): Promise<void> {
  const storedCredential = await SecureStore.getItemAsync(CREDENTIAL_KEY);
  const id = await installationId();
  const report = installationReport(
    id,
    await deviceSourceHash(),
    config,
    theme,
  );
  const fingerprint = heartbeatFingerprint(report);
  const last = await readHeartbeatRecord();
  if (
    storedCredential &&
    last &&
    last.fingerprint === fingerprint &&
    Date.now() - last.at < HEARTBEAT_INTERVAL_MS
  )
    return;
  let credential = storedCredential;
  if (!credential) {
    const registration = await apiClient.post(
      "/v1/mobile/installations/register",
      report,
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
  let response;
  try {
    response = await apiClient.post(
      "/v1/mobile/installations/heartbeat",
      report,
      heartbeatResponseSchema,
      { headers: { Authorization: `Installation ${credential}` } },
    );
  } catch (error) {
    if (storedCredential && error instanceof AppError && error.status === 401) {
      await SecureStore.deleteItemAsync(CREDENTIAL_KEY);
      return syncInstallationHeartbeat(config, theme);
    }
    throw error;
  }
  if (response.credentialRotated && response.installationCredential) {
    await SecureStore.setItemAsync(
      CREDENTIAL_KEY,
      response.installationCredential,
      {
        keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
      },
    );
  }
  await AsyncStorage.setItem(
    HEARTBEAT_KEY,
    JSON.stringify({ at: Date.now(), fingerprint }),
  );
  await AsyncStorage.removeItem(LEGACY_HEARTBEAT_KEY).catch(() => {});
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
  } catch (error) {
    if (__DEV__) console.warn("[push] token registration unavailable", error);
    return "unavailable";
  }
}

export function subscribeToUpdateSignals(
  onSignal: (signal: {
    opened: boolean;
    type?: string;
    eventId?: string;
  }) => void,
): () => void {
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
  const received = Notifications.addNotificationReceivedListener(
    (notification) =>
      onSignal({
        opened: false,
        type: String(notification.request.content.data?.type ?? ""),
        eventId: String(notification.request.content.data?.eventId ?? ""),
      }),
  );
  const opened = Notifications.addNotificationResponseReceivedListener(
    (response) =>
      onSignal({
        opened: true,
        type: String(response.notification.request.content.data?.type ?? ""),
        eventId: String(
          response.notification.request.content.data?.eventId ?? "",
        ),
      }),
  );
  return () => {
    received.remove();
    opened.remove();
  };
}
