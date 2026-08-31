import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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
  toast,
} from "../../design-system";
import type { RootStackParamList } from "../../navigation/types";
import { Group, SRow } from "../profile/profile-screen";

function fill(
  template: string,
  values: Record<string, string | number>,
): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replace(`{${key}}`, String(value)),
    template,
  );
}

/** S-06 关于：品牌（来自 RN-Server branding）+ 版本；有更新时品牌色描边更新卡 → 升级中心；链接组；页脚 Build 信息。 */
export function AboutScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList, "About">) {
  const insets = useSafeAreaInsets();
  const { config, t } = useFoundationRuntime();
  const hasUpdate = config.update.decision !== "none";
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
            <BrandMark size={72} />
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
                onPress={() => navigation.navigate("UpdateCenter")}
                testID="about-update-now"
              >
                {t("update.viewNow")}
              </PrimaryButton>
            </Stack>
          ) : (
            <Group title="">
              <SRow
                title={t("settings.upToDate")}
                value={t("settings.checkUpdate")}
                onPress={() => navigation.navigate("UpdateCenter")}
                testID="about-check-update"
              />
            </Group>
          )}
          <Group title="">
            <SRow
              title={t("update.release")}
              onPress={() => navigation.navigate("UpdateCenter")}
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
    </Page>
  );
}
