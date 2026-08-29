import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../app/runtime-context";
import {
  applyDownloadedOta,
  checkAndDownloadOta,
  getCurrentUpdateMetadata,
  type OtaCheckResult,
} from "../../core/updates/update-service";
import {
  downloadAndInstallApk,
  type ApkDownloadProgress,
} from "../../core/updates/apk-update-service";
import { useUpdateStatus } from "../../core/updates/use-update-status";
import {
  Badge,
  Body,
  Card,
  Content,
  Heading,
  InlineText,
  Label,
  Page,
  PageScroll,
  PrimaryButton,
  Row,
  SecondaryButton,
  ScreenHeader,
  SectionTitle,
  Stack,
} from "../../design-system";
import type { RootStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "UpdateCenter"> & {
  locked?: boolean;
};

export function UpdateCenterScreen({ navigation, locked = false }: Props) {
  const insets = useSafeAreaInsets();
  const { config, otaResult, refresh, t } = useFoundationRuntime();
  const [ota, setOta] = useState<OtaCheckResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [fullMessage, setFullMessage] = useState<string | null>(null);
  const [apkDownloadState, setApkDownloadState] = useState<
    "idle" | "downloading" | "error"
  >("idle");
  const [apkProgress, setApkProgress] = useState<ApkDownloadProgress>({
    written: 0,
    total: config.update.full.size ?? 0,
    percentage: 0,
  });
  const [apkError, setApkError] = useState<string | null>(null);
  const currentUpdate = getCurrentUpdateMetadata();
  const nativeOta = useUpdateStatus();
  const displayedOta =
    ota ??
    otaResult ??
    (nativeOta.status === "ready"
      ? {
          ...nativeOta,
          metadata: {
            ...nativeOta.metadata,
            applyStrategy:
              config.update.ota.applyStrategy ??
              nativeOta.metadata.applyStrategy,
          },
        }
      : nativeOta);

  const checkOta = async (candidate: typeof config = config): Promise<void> => {
    setBusy(true);
    try {
      setOta(
        await checkAndDownloadOta(candidate, {
          onStateChange: (status) =>
            setOta((previous) => ({
              status,
              messageKey:
                status === "checking"
                  ? "update.checking"
                  : status === "available"
                    ? "update.otaAvailable"
                    : status === "downloading"
                      ? "update.otaDownloading"
                      : (previous?.messageKey ?? "update.otaCurrent"),
              metadata: previous?.metadata ?? getCurrentUpdateMetadata(),
            })),
        }),
      );
    } finally {
      setBusy(false);
    }
  };

  const checkUpdates = async (): Promise<void> => {
    if (busy || apkDownloadState === "downloading") return;
    setBusy(true);
    setFullMessage(null);
    setApkError(null);
    try {
      const refreshed = await refresh();
      if (refreshed.source !== "remote" || refreshed.stale) {
        setFullMessage(t("status.error"));
        return;
      }
      const candidate = refreshed.config;
      const hasFullUpdate =
        candidate.update.decision !== "none" &&
        Boolean(candidate.update.full.actionUrl);
      if (hasFullUpdate && candidate.update.full.actionUrl) {
        setApkDownloadState("downloading");
        setApkProgress({
          written: 0,
          total: candidate.update.full.size ?? 0,
          percentage: 0,
        });
        try {
          await downloadAndInstallApk(candidate, setApkProgress);
          setFullMessage(t("update.apkInstallerOpened"));
          setApkDownloadState("idle");
        } catch (error) {
          setApkDownloadState("error");
          setApkError(
            error instanceof Error
              ? error.message
              : t("update.apkDownloadError"),
          );
        }
        return;
      }
      await checkOta(candidate);
    } catch {
      setFullMessage(t("status.error"));
    } finally {
      setBusy(false);
    }
  };

  const applyOta = async (): Promise<void> => {
    setBusy(true);
    try {
      await applyDownloadedOta(displayedOta.metadata.applyStrategy);
    } catch {
      setOta((previous) =>
        previous
          ? { ...previous, status: "error", messageKey: "update.otaError" }
          : null,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page>
      <PageScroll>
        <Content paddingTop={insets.top + 20}>
          <ScreenHeader
            eyebrow={t("update.releaseControl")}
            title={t("home.update")}
            subtitle={t(`update.${config.update.decision}`)}
            onBack={!locked ? () => navigation.goBack() : undefined}
            backLabel={!locked ? t("action.back") : undefined}
          />

          <Card>
            <Row justifyContent="space-between" alignItems="center">
              <SectionTitle>{t("update.policy")}</SectionTitle>
              <Badge>
                <InlineText
                  color={
                    config.update.decision === "required"
                      ? "$danger"
                      : "$primary"
                  }
                >
                  {config.update.decision.toUpperCase()}
                </InlineText>
              </Badge>
            </Row>
            <Body>
              {t("update.currentVersion")}：{config.app.version} (
              {config.app.buildNumber})
            </Body>
            <Body>
              {t("update.minimumVersion")}：{config.update.minSupportedVersion}
            </Body>
            <Body>
              {t("update.latestVersion")}：{config.update.latestVersion}
            </Body>
            <Body>
              {t("update.channel")}：{config.update.full.channel}
            </Body>
          </Card>

          <Card>
            <Label>OTA / {config.update.ota.channel}</Label>
            <SectionTitle>{t("update.otaTitle")}</SectionTitle>
            <Body>
              {t("update.runtime")} · {config.update.ota.runtimeVersion}
            </Body>
            <Body>
              {t("update.release")} ·{" "}
              {currentUpdate.isEmbedded
                ? t("update.embedded")
                : (currentUpdate.updateId ?? t("update.notConfigured"))}
            </Body>
            <Body
              color={displayedOta.status === "error" ? "$danger" : "$textMuted"}
            >
              {t(displayedOta.messageKey)}
            </Body>
            {displayedOta.status === "ready" &&
            displayedOta.metadata.applyStrategy === "immediate" ? (
              <Body color="$warning">{t("update.otaImmediateRequired")}</Body>
            ) : null}
            <PrimaryButton disabled={busy} onPress={() => void checkUpdates()}>
              {busy ? t("update.checking") : t("action.checkupdate")}
            </PrimaryButton>
            {(displayedOta.status === "ready" &&
              displayedOta.metadata.applyStrategy === "immediate") ||
            displayedOta.status === "rollback" ? (
              <SecondaryButton disabled={busy} onPress={() => void applyOta()}>
                {displayedOta.status === "rollback"
                  ? t("update.rollbackApply")
                  : t("update.applyImmediate")}
              </SecondaryButton>
            ) : null}
          </Card>

          <Card>
            <Label>{config.update.full.channel.toUpperCase()}</Label>
            <SectionTitle>{t("update.fullTitle")}</SectionTitle>
            <Body>{t("update.fullDescription")}</Body>
            {config.update.releaseNotes.map((note) => (
              <Body key={note}>• {note}</Body>
            ))}
            {fullMessage ? <Body color="$warning">{fullMessage}</Body> : null}
            {apkError ? <Body color="$danger">{apkError}</Body> : null}
          </Card>

          {config.features.diagnosticsEnabled ? (
            <Card>
              <Label>{t("update.diagnostics")}</Label>
              <Body>
                {t("update.requestId")} · {config.support.diagnosticId}
              </Body>
              <Body>
                {t("update.release")} ·{" "}
                {config.update.full.releaseId ?? t("update.notConfigured")}
              </Body>
              <Body>
                {t("update.runtime")} · {config.app.runtimeVersion}
              </Body>
            </Card>
          ) : null}
        </Content>
      </PageScroll>
      {apkDownloadState !== "idle" ? (
        <Stack
          position="absolute"
          top={0}
          right={0}
          bottom={0}
          left={0}
          zIndex={90}
          justifyContent="center"
          padding="$4"
          backgroundColor="$backdrop"
          accessibilityRole="alert"
        >
          <Card width="100%" maxWidth={460} alignSelf="center">
            <Stack gap="$2">
              <Heading>{t("update.apkDownloadTitle")}</Heading>
              <Body>
                {apkDownloadState === "error"
                  ? t("update.apkDownloadError")
                  : t("update.apkDownloading")}
              </Body>
              {apkDownloadState === "downloading" ? (
                <>
                  <Body>
                    {apkProgress.percentage}% ·{" "}
                    {formatBytes(apkProgress.written)} /{" "}
                    {formatBytes(apkProgress.total)}
                  </Body>
                  <Stack
                    height={8}
                    overflow="hidden"
                    borderRadius="$4"
                    backgroundColor="$surfaceVariant"
                  >
                    <Stack
                      width={`${apkProgress.percentage}%`}
                      height="100%"
                      backgroundColor="$primary"
                    />
                  </Stack>
                </>
              ) : null}
              {apkDownloadState === "error" ? (
                <PrimaryButton onPress={() => void checkUpdates()}>
                  {t("action.retry")}
                </PrimaryButton>
              ) : null}
            </Stack>
          </Card>
        </Stack>
      ) : null}
    </Page>
  );
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "-";
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
