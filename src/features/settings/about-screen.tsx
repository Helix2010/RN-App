import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { fill } from "../../core/i18n/format";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRef, type ReactNode } from "react";
import { Platform } from "react-native";
import { useFoundationRuntime } from "../../app/runtime-context";
import {
  Body,
  BrandMark,
  Content,
  DetailRow,
  InlineText,
  Label,
  Page,
  PageScroll,
  Row,
  ScreenHeader,
  SecondaryButton,
  SectionTitle,
  Stack,
  Sheet,
  type SheetHandle,
  toast,
} from "../../design-system";
import type { RootStackParamList } from "../../navigation/types";
import { useTenantLogoUri } from "../../app/use-tenant-logo";
import { Group, SRow } from "../profile/profile-screen";
import { ApkUpdateButton } from "../updates/apk-update-button";
import { updateCheckRowValue } from "../updates/update-check-row";
import { useManualUpdateCheck } from "../updates/use-manual-update-check";
import { useApkDownloadStore } from "../../core/updates/apk-download-manager";
import { getCurrentUpdateMetadata } from "../../core/updates/update-service";
import { otaRevisionState } from "./version-info";

/** S-06 关于：租户品牌、当前版本、版本检查和只读版本信息。 */
export function AboutScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList, "About">) {
  const insets = useSafeAreaInsets();
  const { config, t, otaResult } = useFoundationRuntime();
  const { state: updateCheckState, check: checkUpdate } =
    useManualUpdateCheck();
  const download = useApkDownloadStore((state) => state.state);
  const versionInfo = useRef<SheetHandle>(null);
  const hasUpdate = config.update.decision !== "none";
  const logoUri = useTenantLogoUri();
  const revision = otaRevisionState(
    getCurrentUpdateMetadata(),
    config.update.ota,
  );
  const otaRevisionText =
    revision.kind === "embedded"
      ? t("update.embedded")
      : revision.kind === "revision"
        ? fill(t("update.otaRevisionValue"), { revision: revision.revision })
        : revision.kind === "pending"
          ? fill(t("update.otaRevisionPending"), {
              revision: revision.revision,
            })
          : t("update.otaRevisionUnknown");
  const size = config.update.full.size
    ? `${(config.update.full.size / 1024 / 1024).toFixed(1)} MB`
    : "";
  return (
    <Page>
      <Content paddingTop={insets.top + 8} paddingBottom={0}>
        <ScreenHeader
          title={t("profile.about")}
          onBack={() => navigation.goBack()}
          backLabel={t("action.back")}
        />
      </Content>
      <PageScroll>
        <Content paddingTop="$2" gap="$4" paddingBottom={40}>
          <Stack alignItems="center" gap="$2" paddingVertical="$3">
            <BrandMark size={72} uri={logoUri} />
            <SectionTitle fontSize={20}>
              {config.branding?.launch.title || t("app.name")}
            </SectionTitle>
            <Body fontSize={12}>
              {
                fill(t("settings.footer"), {
                  version: config.app.version,
                  build: config.app.buildNumber,
                  deviceId: "",
                }).split(" · ")[0]
              }
            </Body>
          </Stack>
          {hasUpdate ? (
            <Stack
              padding="$3"
              borderRadius="$4"
              borderWidth={1.5}
              borderColor="$primary"
              gap="$2"
              testID="about-update-card"
            >
              <Row alignItems="center" justifyContent="space-between">
                <SectionTitle>
                  {fill(t("settings.newVersion"), {
                    version: config.update.latestVersion,
                  })}
                </SectionTitle>
                {size ? <Body fontSize={12}>{size}</Body> : null}
              </Row>
              {config.update.releaseNotes.slice(0, 3).map((note) => (
                <Row key={note} gap="$2" alignItems="flex-start">
                  <InlineText color="$primary">•</InlineText>
                  <Body flex={1}>{note}</Body>
                </Row>
              ))}
              <ApkUpdateButton
                onCheck={() => void checkUpdate()}
                testID="about-update-now"
              />
            </Stack>
          ) : (
            <Group title="">
              <SRow
                title={t("settings.checkUpdate")}
                value={updateCheckRowValue({
                  t,
                  state: updateCheckState,
                  hasUpdate,
                  latestVersion: config.update.latestVersion,
                  otaResult,
                  download,
                })}
                onPress={() => void checkUpdate()}
                testID="about-check-update"
              />
            </Group>
          )}
          <Group title="">
            <SRow
              title={t("update.versionInfo")}
              onPress={() => versionInfo.current?.present()}
              testID="about-changelog"
            />
            <SRow
              title={t("settings.terms")}
              onPress={() => toast(t("state.empty"), "info")}
              testID="about-terms"
            />
            <SRow
              title={t("settings.privacy")}
              onPress={() => toast(t("state.empty"), "info")}
              testID="about-privacy"
            />
          </Group>
          <Body fontSize={11} textAlign="center">
            Build {config.app.buildNumber} · {config.app.runtimeVersion} · ©
            2026 {config.branding?.launch.title || t("app.name")}
          </Body>
        </Content>
      </PageScroll>
      <Sheet
        ref={versionInfo}
        title={t("update.versionInfo")}
        closeLabel={t("action.close")}
        scroll
        testID="version-info-sheet"
        footer={
          config.features.diagnosticsEnabled ? (
            <SecondaryButton
              onPress={() => {
                versionInfo.current?.dismiss();
                navigation.navigate("ReportProblem");
              }}
              testID="version-info-report"
            >
              {t("diagnostics.report")}
            </SecondaryButton>
          ) : undefined
        }
      >
        <VersionInfoGroup title={t("update.groupApp")}>
          <DetailRow
            label={t("update.currentVersion")}
            value={fill(t("update.versionValue"), {
              version: config.app.version,
              build: config.app.buildNumber,
            })}
          />
          <DetailRow
            label={t("update.channel")}
            value={t(`update.distribution.${config.app.distribution}`)}
          />
          <DetailRow
            label={t("update.platform")}
            // Android 上 Platform.Version 是 API 级别（35 = Android 15），不能写成"Android 35"
            value={
              config.app.platform === "ios"
                ? `iOS ${String(Platform.Version)}`
                : `Android API ${String(Platform.Version)}`
            }
          />
        </VersionInfoGroup>
        <VersionInfoGroup title={t("update.groupOta")}>
          <DetailRow label={t("update.otaRevision")} value={otaRevisionText} />
          <DetailRow
            label={t("update.runtime")}
            value={config.app.runtimeVersion}
          />
          <DetailRow
            label={t("update.otaChannel")}
            value={config.update.ota.channel}
          />
          {config.update.canary?.enrolled ? (
            <DetailRow
              label={t("update.canary")}
              value={t("update.canaryEnrolled")}
            />
          ) : null}
        </VersionInfoGroup>
        <VersionInfoGroup title={t("update.groupDiagnostics")}>
          <DetailRow
            label={t("update.latestVersion")}
            value={config.update.latestVersion}
          />
          <DetailRow
            label={t("update.minimumVersion")}
            value={config.update.minSupportedVersion}
          />
          <DetailRow
            label={t("update.requestId")}
            value={config.support.diagnosticId}
          />
        </VersionInfoGroup>
      </Sheet>
    </Page>
  );
}

function VersionInfoGroup({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <Stack gap="$1" marginBottom="$3">
      <Label>{title}</Label>
      {children}
    </Stack>
  );
}
