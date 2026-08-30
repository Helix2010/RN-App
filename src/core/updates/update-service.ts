import * as Updates from "expo-updates";
import type { BootstrapConfig } from "../config/bootstrap.schema";
import { appRuntime } from "../network/api-client";
import { emitUpdateTelemetry } from "./update-telemetry";

export type UpdateState =
  | "embedded"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "applying"
  | "current"
  | "error"
  | "rollback";

export type UpdateMetadata = {
  updateId: string | null;
  runtimeVersion: string;
  channel: string | null;
  isEmbedded: boolean;
  createdAt: string | null;
  applyStrategy: "next_launch" | "immediate";
};

export type OtaCheckResult = {
  status: UpdateState;
  messageKey: string;
  metadata: UpdateMetadata;
};

export type OtaCheckOptions = {
  onStateChange?: (state: UpdateState) => void;
};

let inFlightCheck: Promise<OtaCheckResult> | null = null;

function currentMetadata(): UpdateMetadata {
  return {
    updateId: Updates.updateId ?? null,
    runtimeVersion: Updates.runtimeVersion ?? "embedded",
    channel: Updates.channel ?? appRuntime.otaChannel,
    isEmbedded: Updates.isEmbeddedLaunch,
    createdAt: Updates.createdAt?.toISOString() ?? null,
    applyStrategy: "next_launch",
  };
}

function result(
  status: UpdateState,
  messageKey: string,
  metadata = currentMetadata(),
): OtaCheckResult {
  return { status, messageKey, metadata };
}

function isRollback(value: unknown): value is { isRollBackToEmbedded: true } {
  return (
    typeof value === "object" &&
    value !== null &&
    "isRollBackToEmbedded" in value &&
    value.isRollBackToEmbedded === true
  );
}

export async function checkAndDownloadOta(
  config: BootstrapConfig,
  options?: OtaCheckOptions,
): Promise<OtaCheckResult> {
  if (inFlightCheck) return inFlightCheck;
  inFlightCheck = performCheckAndDownloadOta(config, options);
  try {
    return await inFlightCheck;
  } finally {
    inFlightCheck = null;
  }
}

async function performCheckAndDownloadOta(
  config: BootstrapConfig,
  options?: OtaCheckOptions,
): Promise<OtaCheckResult> {
  const transition = (state: UpdateState): void => {
    options?.onStateChange?.(state);
  };
  if (!config.features.otaEnabled || !config.update.ota.enabled) {
    const status = Updates.isEmbeddedLaunch ? "embedded" : "current";
    transition(status);
    return result(status, "update.otaDisabled");
  }
  if (!Updates.isEnabled) {
    const status = Updates.isEmbeddedLaunch ? "embedded" : "current";
    transition(status);
    return result(status, "update.otaUnavailable");
  }
  if (
    config.update.ota.runtimeVersion !== appRuntime.runtimeVersion ||
    config.update.ota.channel !== appRuntime.otaChannel
  ) {
    const status = Updates.isEmbeddedLaunch ? "embedded" : "current";
    transition(status);
    emitUpdateTelemetry({ stage: "current" });
    return result(status, "update.otaIncompatible");
  }

  transition("checking");
  emitUpdateTelemetry({ stage: "checking" });
  try {
    const check = await Updates.checkForUpdateAsync();
    if (isRollback(check)) {
      const rollback = await Updates.fetchUpdateAsync();
      if (!isRollback(rollback)) {
        transition("error");
        emitUpdateTelemetry({ stage: "error" });
        return resultValue("error", "update.otaError");
      }
      transition("rollback");
      emitUpdateTelemetry({ stage: "rollback" });
      return result("rollback", "update.otaRollback");
    }
    if (!check.isAvailable) {
      const status = Updates.isEmbeddedLaunch ? "embedded" : "current";
      transition(status);
      emitUpdateTelemetry({ stage: "current" });
      return result(status, "update.otaCurrent");
    }
    if (!isManifestCompatibleWithApp(check.manifest, config)) {
      const status = Updates.isEmbeddedLaunch ? "embedded" : "current";
      transition(status);
      emitUpdateTelemetry({ stage: "current", updateId: check.manifest?.id });
      return result(status, "update.otaIncompatible");
    }
    transition("available");
    emitUpdateTelemetry({ stage: "available", updateId: check.manifest?.id });
    transition("downloading");
    emitUpdateTelemetry({ stage: "downloading", updateId: check.manifest?.id });
    const fetched = await Updates.fetchUpdateAsync();
    if (isRollback(fetched)) {
      transition("rollback");
      emitUpdateTelemetry({ stage: "rollback" });
      return { ...resultValue("rollback", "update.otaRollback") };
    }
    if (fetched.isNew) {
      if (!isManifestCompatibleWithApp(fetched.manifest, config)) {
        transition("error");
        emitUpdateTelemetry({
          stage: "error",
          updateId: fetched.manifest?.id,
        });
        return resultValue("error", "update.otaIncompatible");
      }
      const manifestMetadata = getUpdateMetadataFromManifest(fetched.manifest);
      const manifestApplyStrategy = getApplyStrategyFromManifest(
        fetched.manifest,
      );
      const metadata = {
        ...manifestMetadata,
        // Bootstrap is the server's tenant-scoped release policy. Keep it as
        // the source of truth when a provider strips custom manifest metadata.
        applyStrategy:
          config.update.ota.applyStrategy ??
          manifestApplyStrategy ??
          manifestMetadata.applyStrategy,
      };
      transition("ready");
      emitUpdateTelemetry({
        stage: "ready",
        updateId: metadata.updateId,
        runtimeVersion: metadata.runtimeVersion,
        channel: metadata.channel,
        applyStrategy: metadata.applyStrategy,
      });
      return resultValue(
        "ready",
        metadata.applyStrategy === "immediate"
          ? "update.otaReadyImmediate"
          : "update.otaReadyNextLaunch",
        metadata,
      );
    }
    emitUpdateTelemetry({ stage: "current" });
    return resultValue("current", "update.otaCurrent");
  } catch (error) {
    transition("error");
    emitUpdateTelemetry({ stage: "error", error });
    return resultValue("error", "update.otaError");
  }
}

export function isManifestCompatibleWithApp(
  manifest: unknown,
  config: BootstrapConfig,
): boolean {
  const identity = getManifestAppIdentity(manifest);
  return (
    identity.version === config.app.version &&
    identity.buildNumber === config.app.buildNumber
  );
}

export function getManifestAppIdentity(manifest: unknown): {
  version: string;
  buildNumber: string;
} {
  const record = objectValue(manifest);
  const extra = objectValue(record.extra);
  const expoClient = objectValue(extra.expoClient);
  const clientExtra = objectValue(expoClient.extra);
  const android = objectValue(expoClient.android);
  const ios = objectValue(expoClient.ios);
  const version = firstText(
    extra.appVersion,
    clientExtra.appVersion,
    expoClient.version,
  );
  const buildNumber = firstText(
    extra.buildNumber,
    clientExtra.buildNumber,
    android.versionCode,
    ios.buildNumber,
  );
  return { version, buildNumber };
}

function objectValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") return value.trim();
    if (typeof value === "number" && Number.isFinite(value))
      return String(value);
  }
  return "";
}

function resultValue(
  status: UpdateState,
  messageKey: string,
  metadata = currentMetadata(),
): OtaCheckResult {
  return { status, messageKey, metadata };
}

export function getUpdateMetadataFromManifest(
  manifest: unknown,
): UpdateMetadata {
  const record =
    typeof manifest === "object" && manifest !== null
      ? (manifest as Record<string, unknown>)
      : {};
  const runtimeVersion =
    typeof record.runtimeVersion === "string"
      ? record.runtimeVersion
      : (Updates.runtimeVersion ?? "embedded");
  return {
    updateId:
      typeof record.id === "string" ? record.id : (Updates.updateId ?? null),
    runtimeVersion,
    channel: Updates.channel ?? appRuntime.otaChannel,
    isEmbedded: false,
    createdAt: typeof record.createdAt === "string" ? record.createdAt : null,
    applyStrategy: applyStrategyFromManifest(record),
  };
}

function applyStrategyFromManifest(
  manifest: Record<string, unknown>,
): "next_launch" | "immediate" {
  return getApplyStrategyFromManifest(manifest) ?? "next_launch";
}

function getApplyStrategyFromManifest(
  manifest: Record<string, unknown>,
): "next_launch" | "immediate" | undefined {
  const metadata = manifestMetadataFromManifest(manifest);
  if (metadata.applyStrategy === "immediate") return "immediate";
  if (metadata.applyStrategy === "next_launch") return "next_launch";
  return undefined;
}

function manifestMetadataFromManifest(
  manifest: Record<string, unknown>,
): Record<string, unknown> {
  const candidates: unknown[] = [manifest.metadata];
  const extra = manifest.extra;
  if (typeof extra === "object" && extra !== null) {
    const extraRecord = extra as Record<string, unknown>;
    candidates.push(extraRecord.metadata, extraRecord);
  }
  return (
    (candidates.find(
      (value) =>
        typeof value === "object" &&
        value !== null &&
        typeof (value as Record<string, unknown>).applyStrategy === "string",
    ) as Record<string, unknown> | undefined) ?? {}
  );
}

export async function applyDownloadedOta(
  applyStrategy: UpdateMetadata["applyStrategy"] = "next_launch",
): Promise<void> {
  emitUpdateTelemetry({ stage: "applying", applyStrategy });
  await Updates.reloadAsync();
}

export function getCurrentUpdateMetadata(): UpdateMetadata {
  return currentMetadata();
}
