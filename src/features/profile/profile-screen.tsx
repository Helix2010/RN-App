import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../app/runtime-context";
import {
  AppIcon,
  type AppIconName,
  Badge,
  Body,
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
import { mockProfile, mockSecurity, mockText } from "../demo-data";
import { useEdgeBackGesture } from "../../navigation/edge-back-gesture";

export function ProfileScreen({
  onBack,
  onOpenSettings,
  onOpenSecurity,
  onOpenNotifications,
  onOpenAbout,
  onOpenAccount,
  onOpenHistory,
}: {
  onBack: () => void;
  onOpenSettings: () => void;
  onOpenSecurity: () => void;
  onOpenNotifications: () => void;
  onOpenAbout: () => void;
  onOpenAccount: () => void;
  onOpenHistory: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { config, t } = useFoundationRuntime();
  const locale = config.localization.selectedLocale;
  const edgeBack = useEdgeBackGesture(onBack);
  return (
    <Page {...edgeBack}>
      <PageScroll>
        <Content paddingTop={insets.top + 20} gap="$4">
          <Row justifyContent="space-between" alignItems="center">
            <IconButton
              label={t("action.back")}
              icon="chevron-left"
              onPress={onBack}
            />
            <Row gap="$2">
              <IconButton
                label={t("settings.notifications")}
                icon="bell-outline"
                onPress={onOpenNotifications}
              />
              <IconButton
                label={t("action.settings")}
                icon="cog-outline"
                onPress={onOpenSettings}
              />
            </Row>
          </Row>
          <Row
            alignItems="center"
            gap="$3"
            paddingVertical="$2"
            onPress={onOpenAccount}
            accessibilityRole="button"
            accessibilityLabel={t("profile.account")}
          >
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
              <Row alignItems="center" gap="$2">
                <SectionTitle>{mockProfile.displayName}</SectionTitle>
                <Badge>
                  <InlineText color="$success" fontSize={11} fontWeight="700">
                    {t("profile.verified")}
                  </InlineText>
                </Badge>
              </Row>
              <Body fontSize={12}>
                UID 38291047 · {mockProfile.walletAddress}
              </Body>
              <Body fontSize={12}>{mockText(mockProfile.network, locale)}</Body>
            </Stack>
            <Chevron />
          </Row>
          <Stack gap="$2" paddingVertical="$2">
            <Row gap="$2">
              <QuickAction
                label={t("profile.identity")}
                icon="check-decagram-outline"
                onPress={onOpenAccount}
              />
              <QuickAction
                label={t("profile.securityCenter")}
                icon="shield-check-outline"
                onPress={onOpenSecurity}
              />
              <QuickAction
                label={t("profile.invite")}
                icon="gift-outline"
                onPress={onOpenSettings}
              />
              <QuickAction
                label={t("profile.help")}
                icon="headset"
                onPress={onOpenSettings}
              />
            </Row>
          </Stack>
          <HairlineCard gap="$2">
            <Label>{t("profile.account")}</Label>
            <ListRow
              title={t("profile.identity")}
              subtitle={t("profile.verified")}
              onPress={onOpenAccount}
              leading={<LeadingIcon icon="check-decagram-outline" />}
              trailing={<Chevron />}
            />
            <ListRow
              title={t("profile.securityCenter")}
              subtitle={t("security.level.high")}
              onPress={onOpenSecurity}
              leading={<LeadingIcon icon="shield-check-outline" />}
              trailing={<Chevron />}
            />
            <ListRow
              title={t("security.addressBook")}
              subtitle={mockSecurity.addresses}
              onPress={onOpenSecurity}
              leading={<LeadingIcon icon="wallet-outline" />}
              trailing={<Chevron />}
            />
          </HairlineCard>
          <HairlineCard gap="$2">
            <Label>{t("profile.mine")}</Label>
            {config.modules.predict ? (
              <ListRow
                title={t("assets.predictAccount")}
                subtitle="$2,340.12"
                onPress={onOpenAccount}
                leading={<LeadingIcon icon="chart-timeline-variant" />}
                trailing={<Chevron />}
              />
            ) : null}
            {config.modules.dex ? (
              <ListRow
                title={t("assets.dexWallet")}
                subtitle={mockProfile.walletAddress}
                onPress={onOpenAccount}
                leading={<LeadingIcon icon="cube-outline" />}
                trailing={<Chevron />}
              />
            ) : null}
            <ListRow
              title={t("profile.transactionHistory")}
              onPress={onOpenHistory}
              leading={<LeadingIcon icon="history" />}
              trailing={<Chevron />}
            />
          </HairlineCard>
          <HairlineCard gap="$2">
            <Label>{t("profile.more")}</Label>
            <ListRow
              title={t("profile.invite")}
              subtitle={t("profile.invitedCount")}
              onPress={onOpenSettings}
              leading={<LeadingIcon icon="gift-outline" />}
              trailing={<Chevron />}
            />
            <ListRow
              title={t("profile.help")}
              onPress={onOpenSettings}
              leading={<LeadingIcon icon="headset" />}
              trailing={<Chevron />}
            />
            <ListRow
              title={t("about.title")}
              subtitle={`${t("settings.version")} ${config.app.version}`}
              onPress={onOpenAbout}
              leading={<LeadingIcon icon="information-outline" />}
              trailing={<Chevron />}
            />
          </HairlineCard>
        </Content>
      </PageScroll>
    </Page>
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
