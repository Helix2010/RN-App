import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Linking } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../app/runtime-context";
import {
  useAccountPreferences,
  useAccountPrefs,
  type NotificationKey,
} from "../../core/preferences/account-preferences-store";
import {
  AppIcon,
  Body,
  Content,
  InlineText,
  Page,
  PageScroll,
  Row,
  ScreenHeader,
  Stack,
  Switch,
  toast,
  useTheme,
} from "../../design-system";
import type { RootStackParamList } from "../../navigation/types";
import { Group, SRow } from "../profile/profile-screen";
import { useSession } from "../session/hooks/use-session";

/** S-05 推送通知：权限 warn 横条、分组随模块开关、安全提醒不可关闭、免打扰。 */
export function NotificationSettingsScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList, "NotificationSettings">) {
  const insets = useSafeAreaInsets();
  const { config, notificationStatus, t } = useFoundationRuntime();
  const theme = useTheme();
  const session = useSession();
  const address = session.data?.address ?? "guest";
  const prefs = useAccountPrefs(address);
  const setNotification = useAccountPreferences(
    (state) => state.setNotification,
  );
  const patch = useAccountPreferences((state) => state.patch);
  const denied = notificationStatus === "denied";

  const row = (
    key: NotificationKey,
    title: string,
    hint?: string,
    testID?: string,
  ) => (
    <SRow
      key={key}
      title={title}
      subtitle={hint}
      trailing={
        key === "security" ? (
          <Stack
            opacity={0.5}
            onPress={() => toast(t("notif.securityLocked"), "info")}
            accessibilityRole="button"
            accessibilityLabel={t("notif.securityLocked")}
            testID={testID}
          >
            <Switch
              value
              onValueChange={() => toast(t("notif.securityLocked"), "info")}
              disabled
              accessibilityLabel={title}
            />
          </Stack>
        ) : (
          <Switch
            value={prefs.notifications[key]}
            onValueChange={(next) => setNotification(address, key, next)}
            accessibilityLabel={title}
            testID={testID}
          />
        )
      }
    />
  );

  return (
    <Page>
      <Content paddingTop={insets.top + 8} paddingBottom={0}>
        <ScreenHeader
          title={t("notif.title")}
          onBack={() => navigation.goBack()}
          backLabel={t("action.back")}
        />
      </Content>
      <PageScroll>
        <Content paddingTop="$1" gap="$4" paddingBottom={40}>
          {denied ? (
            <Row
              alignItems="center"
              gap="$2"
              padding="$3"
              borderRadius="$4"
              style={{ backgroundColor: `${theme.warning.val}22` }}
            >
              <AppIcon name="bell-off-outline" size={18} colorToken="warning" />
              <Body flex={1} fontSize={12} color="$warning">
                {t("notif.permissionDenied")}
              </Body>
              <InlineText
                fontSize={12}
                fontWeight="800"
                color="$primary"
                onPress={() => void Linking.openSettings()}
              >
                {t("notif.openSettings")}
              </InlineText>
            </Row>
          ) : null}
          <Group title={t("notif.section.trading")}>
            {row(
              "orderFilled",
              t("notif.orderFilled"),
              undefined,
              "notif-order-filled",
            )}
            {row(
              "orderCancelled",
              t("notif.orderCancelled"),
              t("notif.orderCancelled.hint"),
              "notif-order-cancelled",
            )}
          </Group>
          {config.modules.predict ? (
            <Group title={t("notif.section.predict")}>
              {row(
                "predictSettled",
                t("notif.predictSettled"),
                undefined,
                "notif-predict-settled",
              )}
              {row(
                "predictClaimable",
                t("notif.predictClaimable"),
                undefined,
                "notif-predict-claimable",
              )}
              {row(
                "predictDispute",
                t("notif.predictDispute"),
                t("notif.predictDispute.hint"),
                "notif-predict-dispute",
              )}
              {row(
                "predictClosingSoon",
                t("notif.predictClosingSoon"),
                t("notif.predictClosingSoon.hint"),
                "notif-predict-closing",
              )}
            </Group>
          ) : null}
          {config.modules.dex ? (
            <Group title={t("notif.section.dex")}>
              {row(
                "swapResult",
                t("notif.swapResult.label"),
                undefined,
                "notif-swap-result",
              )}
              {row(
                "priceAlert",
                t("notif.priceAlert"),
                t("notif.priceAlert.hint"),
                "notif-price-alert",
              )}
            </Group>
          ) : null}
          <Group title={t("notif.section.other")}>
            {row("promo", t("notif.promo.label"), undefined, "notif-promo")}
            {row(
              "security",
              t("notif.security.label"),
              t("notif.security.hint"),
              "notif-security",
            )}
            <SRow
              title={t("notif.dnd")}
              value={
                prefs.dnd.enabled
                  ? `${prefs.dnd.start} – ${prefs.dnd.end}`
                  : t("settings.notificationsOff")
              }
              onPress={() =>
                patch(address, {
                  dnd: { ...prefs.dnd, enabled: !prefs.dnd.enabled },
                })
              }
              testID="notif-dnd"
            />
          </Group>
        </Content>
      </PageScroll>
    </Page>
  );
}
