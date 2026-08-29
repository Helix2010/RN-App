import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useState } from "react";
import { Modal } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../app/runtime-context";
import {
  Body,
  Card,
  Label,
  Page,
  PrimaryButton,
  Row,
  SecondaryButton,
  SectionTitle,
  Stack,
} from "../../design-system";
import type { RootStackParamList } from "../../navigation/types";
import { AssetsScreen } from "../portfolio/assets-screen";
import { ProfileScreen } from "../profile/profile-screen";
import { FoundationHomeScreen } from "./foundation-home-screen";

type Props = NativeStackScreenProps<RootStackParamList, "AppShell">;
type AppTab = "home" | "assets" | "profile";

export function AppShellScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { config, t } = useFoundationRuntime();
  const [tab, setTab] = useState<AppTab>("home");
  const updateKey = `${config.update.full.releaseId ?? "none"}:${config.update.latestVersion}`;
  const [dismissedUpdateKey, setDismissedUpdateKey] = useState("");
  const updateNoticeVisible =
    config.update.full.actionUrl !== null &&
    (config.update.decision === "optional" ||
      config.update.decision === "recommended") &&
    dismissedUpdateKey !== updateKey;

  return (
    <Page>
      {tab === "home" ? (
        <FoundationHomeScreen
          onOpenAssets={() => setTab("assets")}
          onOpenUpdates={() => navigation.navigate("UpdateCenter")}
          onOpenProfile={() => setTab("profile")}
        />
      ) : tab === "assets" ? (
        <AssetsScreen
          onOpenUpdates={() => navigation.navigate("UpdateCenter")}
        />
      ) : (
        <ProfileScreen
          onOpenSettings={() => navigation.navigate("Settings")}
          onOpenUpdates={() => navigation.navigate("UpdateCenter")}
        />
      )}
      <Row
        paddingTop="$2"
        paddingHorizontal="$3"
        paddingBottom={Math.max(insets.bottom, 10)}
        gap="$2"
        borderTopWidth={1}
        borderColor="$borderColor"
        backgroundColor="$surface"
      >
        <TabButton
          selected={tab === "home"}
          label={t("nav.home")}
          symbol="⌂"
          onPress={() => setTab("home")}
        />
        <TabButton
          selected={tab === "assets"}
          label={t("nav.assets")}
          symbol="◫"
          onPress={() => setTab("assets")}
        />
        <TabButton
          selected={tab === "profile"}
          label={t("nav.profile")}
          symbol="○"
          onPress={() => setTab("profile")}
        />
      </Row>
      <Modal
        visible={updateNoticeVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setDismissedUpdateKey(updateKey)}
      >
        <Stack
          flex={1}
          justifyContent="flex-end"
          padding="$4"
          backgroundColor="$backdrop"
        >
          <Card padding="$5" gap="$4">
            <Label color="$primary">
              {t(`update.${config.update.decision}`)}
            </Label>
            <SectionTitle>{t("update.noticeTitle")}</SectionTitle>
            <Body>{t("update.noticeDescription")}</Body>
            <Body>
              {config.app.version} → {config.update.latestVersion}
            </Body>
            <Stack gap="$2">
              <PrimaryButton
                onPress={() => {
                  setDismissedUpdateKey(updateKey);
                  navigation.navigate("UpdateCenter");
                }}
              >
                {t("update.viewNow")}
              </PrimaryButton>
              <SecondaryButton onPress={() => setDismissedUpdateKey(updateKey)}>
                {t("action.later")}
              </SecondaryButton>
            </Stack>
          </Card>
        </Stack>
      </Modal>
    </Page>
  );
}

function TabButton({
  selected,
  label,
  symbol,
  onPress,
}: {
  selected: boolean;
  label: string;
  symbol: string;
  onPress: () => void;
}) {
  return (
    <SecondaryButton
      flex={1}
      height={54}
      borderRadius="$5"
      borderWidth={0}
      backgroundColor={selected ? "$surfaceVariant" : "$surface"}
      color={selected ? "$primary" : "$textMuted"}
      fontWeight={selected ? "800" : "600"}
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      pressStyle={{ opacity: 0.78 }}
    >
      {symbol} {label}
    </SecondaryButton>
  );
}
