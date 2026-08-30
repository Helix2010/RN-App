import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../app/runtime-context";
import {
  AppHeader,
  Body,
  Card,
  Content,
  InlineText,
  IconButton,
  Label,
  ListRow,
  Page,
  PageScroll,
  Row,
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
            action={
              <IconButton
                label={t("action.settings")}
                symbol="⚙"
                onPress={onOpenSettings}
              />
            }
          />
          <Card backgroundColor="$primary" shadowOpacity={0}>
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
                <SectionTitle color="$onPrimary">AnyFun User</SectionTitle>
                <Body color="$onPrimary" opacity={0.78} fontSize={12}>
                  0x71C7…F8A2
                </Body>
              </Stack>
              <InlineText color="$onPrimary" fontSize={24}>
                ›
              </InlineText>
            </Row>
          </Card>
          <Card>
            <Label>{t("profile.preferences")}</Label>
            <ListRow
              title={t("settings.title")}
              subtitle={t("profile.settingsHint")}
              onPress={onOpenSettings}
              trailing={
                <InlineText color="$textMuted" fontSize={22}>
                  ›
                </InlineText>
              }
            />
            {config.features.updateCenter ? (
              <ListRow
                title={t("settings.updateCenter")}
                subtitle={t("profile.updateHint")}
                onPress={onOpenUpdates}
                trailing={
                  <InlineText color="$textMuted" fontSize={22}>
                    ›
                  </InlineText>
                }
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
