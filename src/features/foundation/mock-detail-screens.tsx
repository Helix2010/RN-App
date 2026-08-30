import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../app/runtime-context";
import {
  AmountText,
  Body,
  Card,
  Content,
  InlineText,
  Label,
  Page,
  PageScroll,
  PrimaryButton,
  Row,
  ScreenHeader,
  SectionTitle,
  Stack,
} from "../../design-system";
import type { RootStackParamList } from "../../navigation/types";
import { useEdgeBackGesture } from "../../navigation/edge-back-gesture";
import {
  mockSecurity,
  mockNotificationSettings,
  mockProfile,
} from "../demo-data";

type DetailRoute = "NotificationSettings" | "About" | "SecurityCenter";
type Props<R extends DetailRoute> = NativeStackScreenProps<
  RootStackParamList,
  R
>;

function DetailPage({
  title,
  navigation,
  children,
}: {
  title: string;
  navigation: { goBack: () => void };
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const { t } = useFoundationRuntime();
  const edgeBack = useEdgeBackGesture(navigation.goBack);
  return (
    <Page {...edgeBack}>
      <PageScroll>
        <Content paddingTop={insets.top + 16}>
          <ScreenHeader
            title={title}
            onBack={() => navigation.goBack()}
            backLabel={t("action.back")}
          />
          {children}
        </Content>
      </PageScroll>
    </Page>
  );
}
function DataRow({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: "$success" | "$danger" | "$warning" | "$info";
}) {
  return (
    <Row justifyContent="space-between" gap="$3">
      <Body>{label}</Body>
      <InlineText
        color={color ?? "$color"}
        fontWeight="700"
        textAlign="right"
        flexShrink={1}
      >
        {value}
      </InlineText>
    </Row>
  );
}

export function NotificationSettingsScreen({
  navigation,
}: Props<"NotificationSettings">) {
  const { t } = useFoundationRuntime();
  return (
    <DetailPage title={t("notif.title")} navigation={navigation}>
      {mockNotificationSettings.map((item) => (
        <Card key={item.key} shadowOpacity={0}>
          <Row justifyContent="space-between">
            <SectionTitle>{t(`notif.${item.key}`)}</SectionTitle>
            <InlineText color={item.enabled ? "$primary" : "$textMuted"}>
              {item.enabled ? "●" : "○"}
            </InlineText>
          </Row>
        </Card>
      ))}
    </DetailPage>
  );
}

export function AboutScreen({ navigation }: Props<"About">) {
  const { config, t } = useFoundationRuntime();
  return (
    <DetailPage title={t("about.title")} navigation={navigation}>
      <Stack alignItems="center" gap="$2" padding="$4">
        <Stack
          width={72}
          height={72}
          borderRadius="$5"
          backgroundColor="$primary"
          alignItems="center"
          justifyContent="center"
        >
          <InlineText color="$onPrimary" fontSize={28} fontWeight="900">
            {mockProfile.displayName.slice(0, 1)}
          </InlineText>
        </Stack>
        <SectionTitle>{t("app.name")}</SectionTitle>
        <Body>
          {config.app.version} ({config.app.buildNumber})
        </Body>
      </Stack>
      <Card shadowOpacity={0}>
        <SectionTitle>
          {config.update.decision === "none"
            ? t("about.upToDate")
            : t("update.noticeTitle")}
        </SectionTitle>
        <Body>{config.update.releaseNotes.join("\n")}</Body>
        <PrimaryButton>{t("settings.checkUpdate")}</PrimaryButton>
      </Card>
    </DetailPage>
  );
}

export function SecurityCenterScreen({ navigation }: Props<"SecurityCenter">) {
  const { t } = useFoundationRuntime();
  return (
    <DetailPage title={t("security.title")} navigation={navigation}>
      <Card shadowOpacity={0}>
        <Label>{t("security.level")}</Label>
        <AmountText color="$success">
          {t(`security.level.${mockSecurity.level}`)}
        </AmountText>
        <Body>
          {mockSecurity.protections} {t("security.protections")}
        </Body>
      </Card>
      <Card shadowOpacity={0}>
        <DataRow label={t("security.password")} value={t("settings.enabled")} />
        <DataRow label={t("security.email")} value={mockSecurity.email} />
        <DataRow
          label={t("security.totp")}
          value={t("security.bound")}
          color="$success"
        />
        <DataRow
          label={t("security.antiPhishing")}
          value={t("security.notSet")}
          color="$warning"
        />
      </Card>
      <Card shadowOpacity={0}>
        <DataRow label={t("security.devices")} value={mockSecurity.devices} />
        <DataRow label={t("security.loginHistory")} value="›" />
        <DataRow
          label={t("security.addressBook")}
          value={mockSecurity.addresses}
        />
      </Card>
    </DetailPage>
  );
}
