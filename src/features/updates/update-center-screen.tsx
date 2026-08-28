import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../app/runtime-context";
import {
  applyDownloadedOta,
  checkAndDownloadOta,
  getCurrentUpdateMetadata,
  openFullUpdate,
  type OtaCheckResult,
} from "../../core/updates/update-service";
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
  SectionTitle,
  Stack,
} from "../../design-system";
import type { RootStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "UpdateCenter"> & {
  locked?: boolean;
};

export function UpdateCenterScreen({ navigation, locked = false }: Props) {
  const insets = useSafeAreaInsets();
  const { config, t } = useFoundationRuntime();
  const [ota, setOta] = useState<OtaCheckResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [fullMessage, setFullMessage] = useState<string | null>(null);
  const currentUpdate = getCurrentUpdateMetadata();
  const nativeOta = useUpdateStatus();
  const displayedOta = ota ?? nativeOta;

  const checkOta = async (): Promise<void> => {
    setBusy(true);
    try {
      setOta(
        await checkAndDownloadOta(config, {
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

  const openFull = async (): Promise<void> => {
    setBusy(true);
    const opened = await openFullUpdate(config);
    setFullMessage(
      opened ? t("update.fullOpened") : t("update.fullUnavailable"),
    );
    setBusy(false);
  };

  const applyOta = async (): Promise<void> => {
    setBusy(true);
    try {
      await applyDownloadedOta();
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
          {!locked ? (
            <SecondaryButton
              alignSelf="flex-start"
              onPress={() => navigation.goBack()}
            >
              {t("action.back")}
            </SecondaryButton>
          ) : null}
          <Stack gap="$2" paddingVertical="$3">
            <Label>{t("update.releaseControl")}</Label>
            <Heading>{t("home.update")}</Heading>
            <Body>{t(`update.${config.update.decision}`)}</Body>
          </Stack>

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
            <PrimaryButton disabled={busy} onPress={() => void checkOta()}>
              {busy ? t("update.checking") : t("action.checkupdate")}
            </PrimaryButton>
            {displayedOta.status === "ready" ||
            displayedOta.status === "rollback" ? (
              <SecondaryButton disabled={busy} onPress={() => void applyOta()}>
                {t(
                  displayedOta.status === "rollback"
                    ? "update.rollbackApply"
                    : "update.apply",
                )}
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
            <PrimaryButton disabled={busy} onPress={() => void openFull()}>
              {t("action.install")}
            </PrimaryButton>
          </Card>

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
        </Content>
      </PageScroll>
    </Page>
  );
}
