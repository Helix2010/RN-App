import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Application from "expo-application";
import * as Crypto from "expo-crypto";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import * as Updates from "expo-updates";
import { Platform } from "react-native";
import {
  collectDeviceIntegrity,
  hasAnySignal,
  type DeviceIntegritySignals,
} from "../security/device-integrity";
import { z } from "zod";
import type { BootstrapConfig } from "../config/bootstrap.schema";
import type { ThemePreference } from "../preferences/preferences-store";
import { apiClient, appRuntime } from "../network/api-client";
import { AppError } from "../network/app-error";
import { getCurrentUpdateMetadata } from "../updates/update-service";
import {
  probeSessionState,
  type ReportedSessionState,
} from "./session-state-probe";

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
  /** bootstrap 下发的最新可用修订号（服务端视角），不是正在跑的版本 */
  otaRevision: number | null;
  /** 设备实际在跑什么：内置 bundle 还是 OTA bundle（设计 §4.1） */
  launchSource: "embedded" | "ota";
  /** 正在运行的 expo-updates update id；内置包为 null */
  runningUpdateId: string | null;
  /** 客户端登录态，只给服务端对账；探针未注册时为 null（服务端记"未上报"） */
  sessionState: ReportedSessionState | null;
  localizationVersion: string;
  brandingVersion: number | null;
  locale: string;
  theme: ThemePreference;
  osVersion: string;
  deviceClass: string;
  /**
   * 设备完整性信号（安全评审 N31）。自报，只作舰队统计，不参与任何放行判定。
   * 每一项都探不出来时整个省略——服务端会把它与"旧版 App 没上报"存成同一个 NULL。
   */
  deviceIntegrity?: DeviceIntegritySignals;
};

/**
 * 正在运行的 bundle 来源。expo-updates 关闭（开发构建）时跑的就是打包进去的 bundle，按内置算；
 * 开着且不是内置启动却拿不到 update id 是不可能的状态，原样上报让服务端 422 暴露出来，不猜。
 */
function runningBundle(): Pick<
  InstallationReport,
  "launchSource" | "runningUpdateId"
> {
  const current = getCurrentUpdateMetadata();
  if (!Updates.isEnabled || current.isEmbedded) {
    return { launchSource: "embedded", runningUpdateId: null };
  }
  return { launchSource: "ota", runningUpdateId: current.updateId };
}

async function installationReport(
  id: string,
  sourceHash: string,
  config: BootstrapConfig,
  theme: ThemePreference,
): Promise<InstallationReport> {
  return {
    installationId: id,
    deviceSourceHash: sourceHash,
    packageId: Application.applicationId ?? appRuntime.applicationId,
    otaChannel: appRuntime.otaChannel,
    otaRevision: config.update.ota.revision ?? null,
    ...runningBundle(),
    sessionState: await probeSessionState(),
    localizationVersion: config.localization.messagesVersion,
    brandingVersion: config.branding?.version ?? null,
    locale: config.localization.selectedLocale,
    theme,
    osVersion: String(Platform.Version),
    deviceClass: Platform.OS === "android" ? "android-phone" : "ios-device",
    ...(await integritySignals()),
  };
}

/** 采集失败不该连累心跳：心跳挂掉会让一台设备在管理端整个消失。 */
async function integritySignals(): Promise<{
  deviceIntegrity?: DeviceIntegritySignals;
}> {
  try {
    const signals = await collectDeviceIntegrity();
    return hasAnySignal(signals) ? { deviceIntegrity: signals } : {};
  } catch {
    return {};
  }
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
    // 应用身份是服务端安装记录的键之一：OTA 换了身份就得立刻重新上报，不能等 30 分钟
    applicationId: appRuntime.applicationId,
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

/**
 * 登录时带上的安装身份：服务端把钱包会话关联到这台安装，收款等用户级推送只发它。
 * 还没注册过（没有凭证）就不带，登录照常。
 */
export async function installationAuthorization(): Promise<
  Record<string, string>
> {
  const [id, credential] = await Promise.all([
    SecureStore.getItemAsync(INSTALLATION_KEY),
    SecureStore.getItemAsync(CREDENTIAL_KEY),
  ]);
  if (!id || !credential) return {};
  return {
    "X-Installation-ID": id,
    Authorization: `Installation ${credential}`,
  };
}

/**
 * 给**不走 apiClient 的传输**用的完整身份头（安装包下载走 expo-file-system，
 * OTA 走原生下载器，都不经过 apiClient 的默认头）。
 *
 * 只带 `X-Installation-ID` + `Authorization` 是不够的：服务端按
 * `(tenant, application_id, platform, installation_id)` 四元组定位安装记录，
 * 缺了平台和应用身份就查不到行，凭证明明有效也会被判成匿名——灰度包于是 404。
 */
export async function installationTransportHeaders(): Promise<
  Record<string, string>
> {
  return {
    "X-Platform": appRuntime.platform,
    "X-Application-ID": appRuntime.applicationId,
    ...(await installationAuthorization()),
  };
}

/** 服务端判定凭证失效时丢掉它：下次心跳会重新注册拿新凭证。 */
export async function forgetInstallationCredential(): Promise<void> {
  await SecureStore.deleteItemAsync(CREDENTIAL_KEY);
}

/**
 * 登录必须带安装身份（设计 §4.2，用户 2026-09-07 决定）：没有凭证就当场重新注册；
 * 注册不了（启动心跳还没跑过、服务端不可用）登录失败并报 INSTALLATION_REQUIRED，
 * 不再退化成"不关联设备"的登录。
 */
export async function ensureInstallationAuthorization(): Promise<
  Record<string, string>
> {
  const existing = await installationAuthorization();
  if (Object.keys(existing).length > 0) return existing;
  if (!lastSyncInput) {
    throw new AppError(
      "configuration",
      "Installation is not registered yet; sign-in requires a registered installation",
      false,
      undefined,
      undefined,
      { code: "INSTALLATION_REQUIRED" },
    );
  }
  await syncInstallationHeartbeat(lastSyncInput.config, lastSyncInput.theme);
  const refreshed = await installationAuthorization();
  if (Object.keys(refreshed).length === 0) {
    throw new AppError(
      "configuration",
      "Installation registration did not yield a credential",
      false,
      undefined,
      undefined,
      { code: "INSTALLATION_REQUIRED" },
    );
  }
  return refreshed;
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

/** 最近一次心跳用的输入；登录时凭证缺失要靠它重新注册（设计 §4.2） */
let lastSyncInput: { config: BootstrapConfig; theme: ThemePreference } | null =
  null;

/** 测试隔离用：清掉进程内记住的心跳输入，让"首个心跳之前"的分支可复现 */
export function forgetInstallationSyncInputForTests(): void {
  lastSyncInput = null;
}

export async function syncInstallationHeartbeat(
  config: BootstrapConfig,
  theme: ThemePreference,
): Promise<void> {
  lastSyncInput = { config, theme };
  const storedCredential = await SecureStore.getItemAsync(CREDENTIAL_KEY);
  const id = await installationId();
  const report = await installationReport(
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
