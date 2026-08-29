import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../app/runtime-context";
import {
  AppHeader,
  Body,
  Card,
  Content,
  InlineText,
  Label,
  Page,
  PageScroll,
  Row,
  SecondaryButton,
  SectionTitle,
  Stack,
} from "../../design-system";

export function ProfileScreen({
  onOpenSettings,
  onOpenUpdates,
}: {
  onOpenSettings: () => void;
  onOpenUpdates: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { config, t } = useFoundationRuntime();
  return (
    <Page>
      <PageScroll>
        <Content paddingTop={insets.top + 24}>
          <AppHeader
            eyebrow={t("profile.eyebrow")}
            title={t("profile.title")}
            subtitle={t("profile.subtitle")}
          />
          <Card>
            <Row alignItems="center" gap="$3">
              <Stack
                width={58}
                height={58}
                borderRadius={999}
                alignItems="center"
                justifyContent="center"
                backgroundColor="$primary"
              >
                <InlineText color="$onPrimary" fontSize={22} fontWeight="900">
                  A
                </InlineText>
              </Stack>
              <Stack flex={1} gap="$1">
                <SectionTitle>AnyFun User</SectionTitle>
                <Body fontSize={12}>0x71C7…F8A2</Body>
              </Stack>
            </Row>
          </Card>
          <Card>
            <Label>{t("profile.preferences")}</Label>
            <MenuRow
              title={t("settings.title")}
              subtitle={t("profile.settingsHint")}
              onPress={onOpenSettings}
            />
            {config.features.updateCenter ? (
              <MenuRow
                title={t("settings.updateCenter")}
                subtitle={t("profile.updateHint")}
                onPress={onOpenUpdates}
              />
            ) : null}
          </Card>
          <Card>
            <Label>{t("profile.security")}</Label>
            <InfoRow label={t("profile.network")} value={t("home.network")} />
            <InfoRow
              label={t("settings.language")}
              value={config.localization.selectedLocale}
            />
          </Card>
        </Content>
      </PageScroll>
    </Page>
  );
}

function MenuRow({
  title,
  subtitle,
  onPress,
}: {
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <SecondaryButton height="auto" minHeight={64} onPress={onPress}>
      <Row flex={1} justifyContent="space-between" alignItems="center">
        <Stack alignItems="flex-start" gap="$1" flex={1}>
          <SectionTitle>{title}</SectionTitle>
          <Body fontSize={12}>{subtitle}</Body>
        </Stack>
        <InlineText color="$textMuted" fontSize={20}>
          ›
        </InlineText>
      </Row>
    </SecondaryButton>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <Row justifyContent="space-between" alignItems="center" gap="$3">
      <Body>{label}</Body>
      <InlineText
        color="$color"
        fontWeight="700"
        flexShrink={1}
        textAlign="right"
      >
        {value}
      </InlineText>
    </Row>
  );
}
