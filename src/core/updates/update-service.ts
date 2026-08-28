import * as Linking from "expo-linking";
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
      const metadata = getUpdateMetadataFromManifest(fetched.manifest);
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
  const metadata =
    typeof manifest.metadata === "object" && manifest.metadata !== null
      ? (manifest.metadata as Record<string, unknown>)
      : {};
  return metadata.applyStrategy === "immediate" ? "immediate" : "next_launch";
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

export async function openFullUpdate(
  config: BootstrapConfig,
): Promise<boolean> {
  if (
    config.app.platform === "android" &&
    config.app.distribution === "direct" &&
    !config.features.directUpdateEnabled
  ) {
    return false;
  }
  const url = config.update.full.actionUrl;
  if (!url || !(await Linking.canOpenURL(url))) return false;
  await Linking.openURL(url);
  return true;
}
