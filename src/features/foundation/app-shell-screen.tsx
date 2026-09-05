import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useIsFocused } from "@react-navigation/native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BackHandler, Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../app/runtime-context";
import {
  AppIcon,
  type AppIconName,
  InlineText,
  Page,
  Row,
  SecondaryButton,
  Stack,
  toast,
} from "../../design-system";
import type { RootStackParamList } from "../../navigation/types";
import { AssetsScreen } from "../assets/ui/assets-screen";
import { FoundationHomeScreen } from "./foundation-home-screen";
import {
  resolveAppShellBack,
  resolveExitAttempt,
  type AppTab,
} from "./app-shell-back";
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
  const { config, t } = useFoundationRuntime();
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
  /**
   * 首页上的返回（边缘滑动 / 返回键）：第一次提示，2 秒内再来一次退出应用。
   * iOS 没有"退出应用"这回事（系统不允许），首页上的返回什么都不做。
   */
  const lastExitAttempt = useRef<number | null>(null);
  const attemptExit = useCallback(() => {
    if (Platform.OS !== "android") return;
    const now = Date.now();
    if (resolveExitAttempt(lastExitAttempt.current, now) === "exit") {
      BackHandler.exitApp();
      return;
    }
    lastExitAttempt.current = now;
    toast(t("app.exitHint"), "info");
  }, [t]);
  const handleShellBack = useCallback(() => {
    const action = resolveAppShellBack(effectiveTab);
    if (action === "home") {
      setTab("home");
      return;
    }
    attemptExit();
  }, [attemptExit, effectiveTab]);
  const edgeBack = useEdgeBackGesture(handleShellBack);
  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        if (!isFocused) return false;
        handleShellBack();
        return true;
      },
    );
    return () => subscription.remove();
  }, [handleShellBack, isFocused]);

  return (
    <Page {...edgeBack}>
      <View style={{ flex: 1 }}>
        {effectiveTab === "home" ? (
          <FoundationHomeScreen
            onOpenAssets={() => setTab("assets")}
            onOpenProfile={() => navigation.navigate("Profile")}
            onOpenPredict={() => setTab("predict")}
            onOpenPredictPositions={() =>
              config.modules.dex
                ? navigation.navigate("Positions")
                : setTab("positions")
            }
            onOpenLeaderboard={() => navigation.navigate("Leaderboard")}
            onOpenDex={() => setTab(config.modules.predict ? "dex" : "market")}
            onOpenSwap={() => setTab("swap")}
          />
        ) : effectiveTab === "assets" ? (
          <AssetsScreen
            onOpenAccount={(kind) =>
              navigation.navigate("AccountDetail", { kind })
            }
            onOpenSend={() => navigation.navigate("Send")}
            onOpenSwap={() => setTab("swap")}
            onOpenPredictEnable={() => navigation.navigate("PredictEnable")}
            onOpenRecords={() => navigation.navigate("Records")}
          />
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
