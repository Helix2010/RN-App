import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { fill } from "../../core/i18n/format";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRef } from "react";
import { useFoundationRuntime } from "../../app/runtime-context";
import {
  Body,
  BrandMark,
  Content,
  InlineText,
  Page,
  PageScroll,
  PrimaryButton,
  Row,
  ScreenHeader,
  SectionTitle,
  Stack,
  Sheet,
  type SheetHandle,
  toast,
} from "../../design-system";
import type { RootStackParamList } from "../../navigation/types";
import { useTenantLogoUri } from "../../app/use-tenant-logo";
import { Group, SRow } from "../profile/profile-screen";
import { useManualUpdateCheck } from "../updates/use-manual-update-check";
import { getCurrentUpdateMetadata } from "../../core/updates/update-service";

/** S-06 关于：租户品牌、当前版本、版本检查和只读版本信息。 */
export function AboutScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList, "About">) {
  const insets = useSafeAreaInsets();
  const { config, t } = useFoundationRuntime();
  const {
    state: updateCheckState,
    checking: checkingUpdate,
    check: checkUpdate,
  } = useManualUpdateCheck();
  const versionInfo = useRef<SheetHandle>(null);
  const hasUpdate = config.update.decision !== "none";
  const logoUri = useTenantLogoUri();
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
              <PrimaryButton
                onPress={() => void checkUpdate()}
                testID="about-update-now"
              >
                {t("update.viewNow")}
              </PrimaryButton>
            </Stack>
          ) : (
            <Group title="">
              <SRow
                title={t("settings.upToDate")}
                value={
                  checkingUpdate
                    ? t("update.checking")
                    : updateCheckState === "error"
                      ? t("status.error")
                      : updateCheckState === "latest"
                        ? t("settings.upToDate")
                        : t("settings.checkUpdate")
                }
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
      >
        <VersionInfoRow
          label={t("update.currentVersion")}
          value={`${config.app.version} (${config.app.buildNumber})`}
        />
        <VersionInfoRow
          label={t("update.minimumVersion")}
          value={config.update.minSupportedVersion}
        />
        <VersionInfoRow
          label={t("update.latestVersion")}
          value={config.update.latestVersion}
        />
        <VersionInfoRow
          label={t("update.channel")}
          value={config.update.full.channel}
        />
        <VersionInfoRow
          label={t("update.requestId")}
          value={config.support.diagnosticId}
        />
        <VersionInfoRow
          label={t("update.release")}
          value={config.update.full.releaseId ?? t("update.notConfigured")}
        />
        <VersionInfoRow
          label={t("update.runtime")}
          value={config.app.runtimeVersion}
        />
        <VersionInfoRow
          label={t("update.otaTitle")}
          value={
            getCurrentUpdateMetadata().isEmbedded
              ? t("update.embedded")
              : (getCurrentUpdateMetadata().updateId ??
                t("update.notConfigured"))
          }
        />
      </Sheet>
    </Page>
  );
}

function VersionInfoRow({ label, value }: { label: string; value: string }) {
  return (
    <Row justifyContent="space-between" alignItems="flex-start" gap="$3">
      <Body flex={1}>{label}</Body>
      <Body flex={1} textAlign="right" color="$color">
        {value}
      </Body>
    </Row>
  );
}
