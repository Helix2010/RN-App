import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useIsFocused } from "@react-navigation/native";
import { useEffect, useMemo, useState } from "react";
import { BackHandler, Modal, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../app/runtime-context";
import {
  Body,
  AppIcon,
  type AppIconName,
  Card,
  InlineText,
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
import { FoundationHomeScreen } from "./foundation-home-screen";
import { resolveAppShellBack, type AppTab } from "./app-shell-back";
import {
  buildAppTabs,
  isAppContentAvailable,
  resolveBottomTab,
} from "./app-tabs";
import { ModuleOverviewScreen } from "./module-overview-screen";
import { useEdgeBackGesture } from "../../navigation/edge-back-gesture";

type Props = NativeStackScreenProps<RootStackParamList, "AppShell">;

export function AppShellScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const { config, t, notificationIntent } = useFoundationRuntime();
  const [tab, setTab] = useState<AppTab>("home");
  const tabs = useMemo(
    () =>
      buildAppTabs(config.modules).map((item) => ({
        ...item,
        label: t(item.labelKey),
      })),
    [config.modules, t],
  );
  const effectiveTab = isAppContentAvailable(tab, config.modules)
    ? tab
    : "home";
  const selectedBottomTab = resolveBottomTab(effectiveTab, config.modules);
  const updateKey = `${config.update.full.releaseId ?? "none"}:${config.update.latestVersion}`;
  const [dismissedUpdateKey, setDismissedUpdateKey] = useState("");
  const updateNoticeVisible =
    config.update.full.actionUrl !== null &&
    config.app.platform === "android" &&
    config.app.distribution === "direct" &&
    config.features.directUpdateEnabled &&
    (config.update.decision === "optional" ||
      config.update.decision === "recommended") &&
    notificationIntent?.type !== "app_update_available" &&
    dismissedUpdateKey !== updateKey;
  useEffect(() => {
    if (
      notificationIntent?.type === "app_update_available" ||
      notificationIntent?.type === "ota_updated"
    ) {
      if (navigation.getState().routes.at(-1)?.name === "UpdateCenter") return;
      navigation.navigate("UpdateCenter");
    }
  }, [navigation, notificationIntent]);
  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        if (!isFocused) return false;
        const action = resolveAppShellBack(effectiveTab);
        if (action === "consume") return true;
        setTab(action);
        return true;
      },
    );
    return () => subscription.remove();
  }, [effectiveTab, isFocused]);
  const edgeBack = useEdgeBackGesture(() => {
    const action = resolveAppShellBack(effectiveTab);
    if (action === "home") setTab("home");
  });

  return (
    <Page {...edgeBack}>
      <View style={{ flex: 1 }}>
        {effectiveTab === "home" ? (
          <FoundationHomeScreen
            onOpenAssets={() => setTab("assets")}
            onOpenProfile={() => navigation.navigate("Profile")}
            onOpenPredict={() => setTab("predict")}
            onOpenPredictPositions={() => setTab("positions")}
            onOpenDex={() => setTab(config.modules.predict ? "dex" : "market")}
            onOpenSwap={() => setTab("swap")}
          />
        ) : effectiveTab === "assets" ? (
          <AssetsScreen />
        ) : effectiveTab === "predict" ||
          effectiveTab === "positions" ||
          effectiveTab === "dex" ||
          effectiveTab === "market" ||
          effectiveTab === "swap" ? (
          <ModuleOverviewScreen kind={effectiveTab} />
        ) : null}
      </View>
      <Row
        paddingTop="$2"
        paddingHorizontal="$3"
        paddingBottom={Math.max(insets.bottom, 10)}
        gap="$2"
        borderTopWidth={1}
        borderColor="$borderColor"
        backgroundColor="$surface"
      >
        {tabs.map((item) => (
          <TabButton
            key={item.key}
            selected={selectedBottomTab === item.key}
            label={item.label}
            icon={item.icon}
            onPress={() => setTab(item.key)}
          />
        ))}
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
                  navigation.navigate("UpdateCenter", { autoPrompt: true });
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
  icon,
  onPress,
}: {
  selected: boolean;
  label: string;
  icon: AppIconName;
  onPress: () => void;
}) {
  return (
    <SecondaryButton
      flex={1}
      height={58}
      borderRadius={0}
      borderWidth={0}
      backgroundColor="$surface"
      color={selected ? "$color" : "$textMuted"}
      fontWeight={selected ? "800" : "600"}
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      pressStyle={{ opacity: 0.78 }}
    >
      <Stack alignItems="center" gap="$1">
        <AppIcon
          name={icon}
          size={23}
          colorToken={selected ? "color" : "textMuted"}
        />
        <InlineText color={selected ? "$color" : "$textMuted"} fontSize={11}>
          {label}
        </InlineText>
      </Stack>
    </SecondaryButton>
  );
}
