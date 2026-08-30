import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useIsFocused } from "@react-navigation/native";
import { useEffect, useState } from "react";
import { BackHandler, Modal } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../app/runtime-context";
import type { BootstrapConfig } from "../../core/config/bootstrap.schema";
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
import { shouldShowFullUpdatePrompt } from "../../core/updates/update-prompt";
import { useUpdateStatus } from "../../core/updates/use-update-status";
import {
  Badge,
  Body,
  AppIcon,
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
import { useEdgeBackGesture } from "../../navigation/edge-back-gesture";

type Props = NativeStackScreenProps<RootStackParamList, "UpdateCenter"> & {
  locked?: boolean;
};

export function UpdateCenterScreen({
  navigation,
  route,
  locked = false,
}: Props) {
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const { config, notificationIntent, otaResult, refresh, t } =
    useFoundationRuntime();
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
  const [infoTarget, setInfoTarget] = useState<"ota" | "full" | null>(null);
  const [pendingFullUpdate, setPendingFullUpdate] =
    useState<BootstrapConfig | null>(() =>
      (locked || route.params?.autoPrompt) &&
      config.update.full.actionUrl &&
      config.app.platform === "android" &&
      config.app.distribution === "direct" &&
      config.features.directUpdateEnabled
        ? config
        : null,
    );
  const [dismissedPushEventId, setDismissedPushEventId] = useState("");
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
        candidate.app.platform === "android" &&
        candidate.app.distribution === "direct" &&
        candidate.features.directUpdateEnabled &&
        Boolean(candidate.update.full.actionUrl);
      if (hasFullUpdate && candidate.update.full.actionUrl) {
        setPendingFullUpdate(candidate);
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

  const fullUpdatePromptVisible = shouldShowFullUpdatePrompt({
    pending: pendingFullUpdate !== null,
    signalType: notificationIntent?.type,
    signalEventId: notificationIntent?.eventId,
    dismissedSignalEventId: dismissedPushEventId,
    decision: config.update.decision,
    actionUrl: config.update.full.actionUrl,
    directInstallEnabled:
      config.app.platform === "android" &&
      config.app.distribution === "direct" &&
      config.features.directUpdateEnabled,
  });
  const promptConfig = pendingFullUpdate ?? config;
  const edgeBack = useEdgeBackGesture(navigation.goBack);
  const otaVersion = config.update.ota.revision
    ? `v${config.update.ota.revision}`
    : currentUpdate.isEmbedded
      ? t("update.embedded")
      : (currentUpdate.updateId ?? t("update.notConfigured"));
  const fullVersion = config.update.latestVersion;
  const hasOtaUpdate =
    displayedOta.status !== "current" && displayedOta.status !== "embedded";

  useEffect(() => {
    if (!isFocused || (!locked && apkDownloadState !== "downloading")) return;
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => true,
    );
    return () => subscription.remove();
  }, [apkDownloadState, isFocused, locked]);

  const downloadFullUpdate = async (): Promise<void> => {
    const candidate = pendingFullUpdate ?? config;
    if (
      !candidate.update.full.actionUrl ||
      candidate.app.platform !== "android" ||
      candidate.app.distribution !== "direct" ||
      !candidate.features.directUpdateEnabled
    )
      return;
    setPendingFullUpdate(null);
    if (notificationIntent?.eventId)
      setDismissedPushEventId(notificationIntent.eventId);
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
        error instanceof Error ? error.message : t("update.apkDownloadError"),
      );
    }
  };

  return (
    <Page {...edgeBack}>
      <PageScroll>
        <Content paddingTop={insets.top + 20}>
          <ScreenHeader
            eyebrow={t("update.releaseControl")}
            title={t("home.update")}
            subtitle={t(`update.${config.update.decision}`)}
            onBack={!locked ? () => navigation.goBack() : undefined}
            backLabel={!locked ? t("action.back") : undefined}
          />

          <Card backgroundColor="$surfaceVariant" shadowOpacity={0}>
            <Row justifyContent="space-between" alignItems="center">
              <Stack gap="$1">
                <Label>{t("update.currentVersion")}</Label>
                <Heading fontSize={28}>
                  {config.app.version} ({config.app.buildNumber})
                </Heading>
              </Stack>
              <Badge>
                <InlineText
                  color={
                    config.update.decision === "required"
                      ? "$danger"
                      : "$primary"
                  }
                >
                  {config.update.decision === "none"
                    ? t("update.none")
                    : t(`update.${config.update.decision}`)}
                </InlineText>
              </Badge>
            </Row>
            <Body>{t("update.currentVersionHint")}</Body>
            {config.update.decision !== "none" ? (
              <Body color="$warning">
                {config.update.latestVersion} · {t("update.recommended")}
              </Body>
            ) : null}
            <PrimaryButton disabled={busy} onPress={() => void checkUpdates()}>
              {busy ? t("update.checking") : t("action.checkupdate")}
            </PrimaryButton>
          </Card>

          <Card>
            <Label>{t("update.release")}</Label>
            <UpdateVersionRow
              label={t("update.otaTitle")}
              version={otaVersion}
              status={
                hasOtaUpdate
                  ? t(displayedOta.messageKey)
                  : t("update.otaCurrent")
              }
              onPress={() => void checkOta()}
              onInfo={() => setInfoTarget("ota")}
              busy={busy}
              t={t}
            />
            <UpdateVersionRow
              label={t("update.fullTitle")}
              version={fullVersion}
              status={
                config.update.decision === "none"
                  ? t("update.none")
                  : t(`update.${config.update.decision}`)
              }
              onPress={() => void checkUpdates()}
              onInfo={() => setInfoTarget("full")}
              busy={busy || apkDownloadState === "downloading"}
              t={t}
            />
            {displayedOta.status === "ready" &&
            displayedOta.metadata.applyStrategy === "immediate" ? (
              <SecondaryButton disabled={busy} onPress={() => void applyOta()}>
                {t("update.applyImmediate")}
              </SecondaryButton>
            ) : null}
            {fullMessage ? <Body color="$warning">{fullMessage}</Body> : null}
            {apkError ? <Body color="$danger">{apkError}</Body> : null}
          </Card>
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
      <Modal
        visible={fullUpdatePromptVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (promptConfig.update.decision === "required") return;
          setPendingFullUpdate(null);
          if (notificationIntent?.eventId)
            setDismissedPushEventId(notificationIntent.eventId);
        }}
      >
        <Stack
          flex={1}
          justifyContent="flex-end"
          padding="$4"
          backgroundColor="$backdrop"
        >
          <Card padding="$5">
            <Stack gap="$3">
              <Label color="$primary">
                {t(`update.${promptConfig.update.decision}`)}
              </Label>
              <SectionTitle>{t("update.noticeTitle")}</SectionTitle>
              <Body>{t("update.noticeDescription")}</Body>
              <Body>
                {promptConfig.app.version} → {promptConfig.update.latestVersion}
              </Body>
              {promptConfig.update.releaseNotes.map((note) => (
                <Body key={note}>• {note}</Body>
              ))}
              <PrimaryButton
                disabled={busy}
                onPress={() => {
                  void downloadFullUpdate();
                }}
              >
                {t("update.confirmAndDownload")}
              </PrimaryButton>
              {promptConfig.update.decision !== "required" ? (
                <SecondaryButton
                  disabled={busy}
                  onPress={() => {
                    setPendingFullUpdate(null);
                    if (notificationIntent?.eventId)
                      setDismissedPushEventId(notificationIntent.eventId);
                  }}
                >
                  {t("action.later")}
                </SecondaryButton>
              ) : null}
            </Stack>
          </Card>
        </Stack>
      </Modal>
      <Modal
        visible={infoTarget !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setInfoTarget(null)}
      >
        <Stack
          flex={1}
          justifyContent="flex-end"
          padding="$4"
          backgroundColor="$backdrop"
        >
          <Card padding="$5">
            <Row justifyContent="space-between" alignItems="center">
              <SectionTitle>{t("update.versionDetails")}</SectionTitle>
              <InlineText
                color="$textMuted"
                fontSize={26}
                onPress={() => setInfoTarget(null)}
                accessibilityRole="button"
                accessibilityLabel={t("action.close")}
              >
                ×
              </InlineText>
            </Row>
            {infoTarget === "ota" ? (
              <>
                <Body>
                  {t("update.otaTitle")} · {otaVersion}
                </Body>
                <Body>
                  {t("update.channel")} · {config.update.ota.channel}
                </Body>
                <Body>
                  {t("update.runtime")} · {config.update.ota.runtimeVersion}
                </Body>
                <Body>
                  {t("update.release")} ·{" "}
                  {config.update.ota.baseReleaseId ?? t("update.notConfigured")}
                </Body>
              </>
            ) : (
              <>
                <Body>
                  {t("update.fullTitle")} · {fullVersion}
                </Body>
                <Body>
                  {t("update.channel")} · {config.update.full.channel}
                </Body>
                <Body>
                  {t("settings.build")} · {config.app.buildNumber}
                </Body>
                <Body>
                  {t("update.runtime")} · {config.app.runtimeVersion}
                </Body>
                <Body>
                  {t("update.minimumVersion")} ·{" "}
                  {config.update.minSupportedVersion}
                </Body>
                <Body>
                  {t("update.release")} ·{" "}
                  {config.update.full.releaseId ?? t("update.notConfigured")}
                </Body>
              </>
            )}
          </Card>
        </Stack>
      </Modal>
    </Page>
  );
}

function UpdateVersionRow({
  label,
  version,
  status,
  onPress,
  onInfo,
  busy,
  t,
}: {
  label: string;
  version: string;
  status: string;
  onPress: () => void;
  onInfo: () => void;
  busy: boolean;
  t: (key: string) => string;
}) {
  return (
    <Row
      minHeight={78}
      paddingVertical="$3"
      borderBottomWidth={1}
      borderColor="$borderColor"
      alignItems="center"
      gap="$3"
    >
      <Stack flex={1} gap="$1" onPress={onPress}>
        <Label>{label}</Label>
        <SectionTitle>{version}</SectionTitle>
        <Body fontSize={12}>{status}</Body>
      </Stack>
      <InlineText
        color="$primary"
        fontSize={23}
        onPress={onInfo}
        accessibilityRole="button"
        accessibilityLabel={`${label}${t("update.info")}`}
      >
        <AppIcon name="information-outline" size={22} />
      </InlineText>
      <InlineText
        color={busy ? "$textMuted" : "$primary"}
        fontSize={22}
        onPress={busy ? undefined : onPress}
        accessibilityRole="button"
        accessibilityLabel={`${label}${t("action.checkupdate")}`}
      >
        <AppIcon name="chevron-right" size={21} colorToken="textMuted" />
      </InlineText>
    </Row>
  );
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "-";
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
