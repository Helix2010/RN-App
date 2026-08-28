import * as Updates from "expo-updates";
import {
  getCurrentUpdateMetadata,
  getUpdateMetadataFromManifest,
  type OtaCheckResult,
} from "./update-service";

export function useUpdateStatus(): OtaCheckResult {
  const state = Updates.useUpdates();
  const metadata = state.downloadedUpdate?.manifest
    ? getUpdateMetadataFromManifest(state.downloadedUpdate.manifest)
    : getCurrentUpdateMetadata();

  if (state.currentlyRunning.isEmergencyLaunch) {
    return { status: "rollback", messageKey: "update.otaRollback", metadata };
  }
  if (state.isRestarting) {
    return { status: "applying", messageKey: "update.otaApplying", metadata };
  }
  if (state.isUpdatePending) {
    return {
      status: "ready",
      messageKey:
        metadata.applyStrategy === "immediate"
          ? "update.otaReadyImmediate"
          : "update.otaReadyNextLaunch",
      metadata,
    };
  }
  if (state.isDownloading) {
    return {
      status: "downloading",
      messageKey: "update.otaDownloading",
      metadata,
    };
  }
  if (state.isUpdateAvailable) {
    return {
      status: "available",
      messageKey: "update.otaAvailable",
      metadata,
    };
  }
  if (state.isChecking) {
    return { status: "checking", messageKey: "update.checking", metadata };
  }
  return {
    status: metadata.isEmbedded ? "embedded" : "current",
    messageKey: metadata.isEmbedded
      ? "update.embeddedCurrent"
      : "update.otaCurrent",
    metadata,
  };
}
