import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../app/runtime-context";
import {
  AppHeader,
  AppIcon,
  type AppIconName,
  Body,
  Card,
  Content,
  HairlineCard,
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
import { mockProfile, mockText } from "../demo-data";
import { useEdgeBackGesture } from "../../navigation/edge-back-gesture";

export function ProfileScreen({
  onBack,
  onOpenSettings,
  onOpenUpdates,
  onOpenSecurity,
  onOpenNotifications,
}: {
  onBack: () => void;
  onOpenSettings: () => void;
  onOpenUpdates: () => void;
  onOpenSecurity: () => void;
  onOpenNotifications: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { config, snapshot, t } = useFoundationRuntime();
  const locale = config.localization.selectedLocale;
  const serviceState =
    snapshot.source === "remote" && !snapshot.stale
      ? t("profile.connected")
      : t("profile.cached");
  const edgeBack = useEdgeBackGesture(onBack);
  return (
    <Page {...edgeBack}>
      <PageScroll>
        <Content paddingTop={insets.top + 20} gap="$4">
          <AppHeader
            eyebrow={t("profile.eyebrow")}
            title={t("profile.title")}
            subtitle={t("profile.subtitle")}
            action={
              <IconButton
                label={t("action.settings")}
                icon="cog-outline"
                onPress={onOpenSettings}
              />
            }
          />
          <Card
            backgroundColor="$surfaceVariant"
            shadowOpacity={0}
            padding="$4"
          >
            <Row alignItems="center" gap="$3">
              <Stack
                width={64}
                height={64}
                borderRadius={999}
                alignItems="center"
                justifyContent="center"
                backgroundColor="$primary"
              >
                <InlineText color="$onPrimary" fontSize={25} fontWeight="900">
                  {mockProfile.displayName.slice(0, 1)}
                </InlineText>
              </Stack>
              <Stack flex={1} gap="$1">
                <SectionTitle>{mockProfile.displayName}</SectionTitle>
                <Body fontSize={12}>{mockProfile.walletAddress}</Body>
                <Row alignItems="center" gap="$2" marginTop="$1">
                  <Stack
                    width={7}
                    height={7}
                    borderRadius={999}
                    backgroundColor="$success"
                  />
                  <Body color="$success" fontSize={12} fontWeight="700">
                    {serviceState}
                  </Body>
                </Row>
              </Stack>
              <InlineText color="$textMuted" fontSize={24}>
                ›
              </InlineText>
            </Row>
            <Row
              borderTopWidth={1}
              borderColor="$borderColor"
              paddingTop="$3"
              marginTop="$3"
              gap="$3"
            >
              <ProfileMetric
                label={t("profile.network")}
                value={mockText(mockProfile.network, locale)}
              />
              <ProfileMetric
                label={t("settings.language")}
                value={config.localization.selectedLocale}
              />
              <ProfileMetric
                label={t("settings.version")}
                value={config.app.version}
              />
            </Row>
          </Card>
          <Stack gap="$2">
            <Label>{t("profile.quickActions")}</Label>
            <Row gap="$2">
              <QuickAction
                label={t("settings.title")}
                icon="cog-outline"
                onPress={onOpenSettings}
              />
              <QuickAction
                label={t("profile.securityCenter")}
                icon="shield-check-outline"
                onPress={onOpenSecurity}
              />
              <QuickAction
                label={t("settings.notifications")}
                icon="bell-outline"
                onPress={onOpenNotifications}
              />
              {config.features.updateCenter ? (
                <QuickAction
                  label={t("settings.updateCenter")}
                  icon="update"
                  onPress={onOpenUpdates}
                />
              ) : null}
            </Row>
          </Stack>
          <HairlineCard gap="$2">
            <Label>{t("profile.preferences")}</Label>
            <ListRow
              title={t("settings.title")}
              subtitle={t("profile.settingsHint")}
              onPress={onOpenSettings}
              leading={<LeadingIcon icon="cog-outline" />}
              trailing={<Chevron />}
            />
            {config.features.updateCenter ? (
              <ListRow
                title={t("settings.updateCenter")}
                subtitle={t("profile.updateHint")}
                onPress={onOpenUpdates}
                leading={<LeadingIcon icon="update" />}
                trailing={<Chevron />}
              />
            ) : null}
          </HairlineCard>
          <HairlineCard gap="$2">
            <Label>{t("profile.security")}</Label>
            <ListRow
              title={t("profile.securityCenter")}
              subtitle={t("profile.securityHint")}
              onPress={onOpenSecurity}
              leading={<LeadingIcon icon="shield-check-outline" />}
              trailing={<Chevron />}
            />
            <ListRow
              title={t("settings.notifications")}
              subtitle={
                snapshot.source === "remote"
                  ? t("settings.notificationsEnabled")
                  : t("settings.notificationsOff")
              }
              onPress={onOpenNotifications}
              leading={<LeadingIcon icon="bell-outline" />}
              trailing={<Chevron />}
            />
          </HairlineCard>
          <Stack alignItems="center" paddingVertical="$2" gap="$1">
            <Body fontSize={12}>
              {config.app.version} ({config.app.buildNumber}) ·{" "}
              {config.app.platform}
            </Body>
            <Body color="$textMuted" fontSize={11}>
              {t("profile.runtime")} {config.app.runtimeVersion}
            </Body>
          </Stack>
        </Content>
      </PageScroll>
    </Page>
  );
}

function ProfileMetric({ label, value }: { label: string; value: string }) {
  return (
    <Stack flex={1} gap="$1">
      <Body fontSize={11}>{label}</Body>
      <InlineText fontSize={12} fontWeight="700" numberOfLines={1}>
        {value}
      </InlineText>
    </Stack>
  );
}

function LeadingIcon({ icon }: { icon: AppIconName }) {
  return (
    <Stack
      width={34}
      height={34}
      borderRadius="$3"
      alignItems="center"
      justifyContent="center"
      backgroundColor="$surfaceVariant"
    >
      <AppIcon name={icon} size={17} />
    </Stack>
  );
}

function Chevron() {
  return <AppIcon name="chevron-right" size={22} colorToken="textMuted" />;
}

function QuickAction({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon: AppIconName;
  onPress: () => void;
}) {
  return (
    <Stack flex={1} alignItems="center" gap="$1">
      <IconButton label={label} icon={icon} onPress={onPress} size={44} />
      <Body fontSize={11} numberOfLines={1}>
        {label}
      </Body>
    </Stack>
  );
}
