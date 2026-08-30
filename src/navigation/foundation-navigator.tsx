import {
  NavigationContainer,
  useNavigationContainerRef,
  type Theme as NavigationTheme,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { BackHandler } from "react-native";
import { useEffect } from "react";
import { useTheme } from "tamagui";
import { useFoundationRuntime } from "../app/runtime-context";
import { AppShellScreen } from "../features/foundation/app-shell-screen";
import { UpdateCenterScreen } from "../features/updates/update-center-screen";
import { SettingsScreen } from "../features/settings/settings-screen";
import { LanguageSettingsScreen } from "../features/settings/language-settings-screen";
import { AppearanceSettingsScreen } from "../features/settings/appearance-settings-screen";
import {
  AboutScreen,
  DexTokenScreen,
  SwapDetailScreen,
  NotificationSettingsScreen,
  SecurityCenterScreen,
  SwapHistoryScreen,
} from "../features/foundation/mock-detail-screens";
import { ProfileScreen } from "../features/profile/profile-screen";
import { ConnectWalletSheet } from "../features/session/ui/connect-wallet-sheet";
import { AccountDetailScreen } from "../features/assets/ui/account-detail-screen";
import { SendScreen } from "../features/assets/ui/send-screen";
import { TransferScreen } from "../features/assets/ui/transfer-screen";
import { EventDetailScreen } from "../features/predict/ui/event-detail-screen";
import { SettlementScreen } from "../features/predict/ui/settlement-screen";
import { LeaderboardScreen } from "../features/predict/ui/leaderboard-screen";
import { PositionsScreen } from "../features/predict/ui/positions-screen";
import type { RootStackParamList } from "./types";
import { resolveSystemBack } from "./system-back";

const Stack = createNativeStackNavigator<RootStackParamList>();

export function FoundationNavigator() {
  const theme = useTheme();
  const { config } = useFoundationRuntime();
  const navigationRef = useNavigationContainerRef<RootStackParamList>();
  const navigationTheme: NavigationTheme = {
    dark: theme.background.val === config.theme.dark.background,
    colors: {
      primary: theme.primary.val,
      background: theme.background.val,
      card: theme.surface.val,
      text: theme.color.val,
      border: theme.borderColor.val,
      notification: theme.danger.val,
    },
    fonts: {
      regular: { fontFamily: "System", fontWeight: "400" },
      medium: { fontFamily: "System", fontWeight: "500" },
      bold: { fontFamily: "System", fontWeight: "700" },
      heavy: { fontFamily: "System", fontWeight: "800" },
    },
  };

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        const route = navigationRef.getCurrentRoute();
        const action = resolveSystemBack(
          route?.name,
          navigationRef.canGoBack(),
          config.update.decision === "required",
        );
        if (action === "navigate") {
          navigationRef.goBack();
          return true;
        }
        return action === "consume";
      },
    );
    return () => subscription.remove();
  }, [config.update.decision, navigationRef]);

  if (config.update.decision === "required" && config.update.full.actionUrl) {
    return (
      <NavigationContainer ref={navigationRef} theme={navigationTheme}>
        <Stack.Navigator
          screenOptions={{
            headerShown: false,
            gestureEnabled: true,
            fullScreenGestureEnabled: true,
            animation: "slide_from_right",
            animationMatchesGesture: true,
          }}
        >
          <Stack.Screen name="UpdateCenter">
            {(props) => <UpdateCenterScreen {...props} locked />}
          </Stack.Screen>
        </Stack.Navigator>
      </NavigationContainer>
    );
  }

  return (
    <NavigationContainer ref={navigationRef} theme={navigationTheme}>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          gestureEnabled: true,
          fullScreenGestureEnabled: true,
          animation: "slide_from_right",
          animationMatchesGesture: true,
        }}
      >
        <Stack.Screen name="AppShell" component={AppShellScreen} />
        <Stack.Screen name="Profile">
          {(props) => (
            <ProfileScreen
              onBack={() => props.navigation.goBack()}
              onOpenSettings={() => props.navigation.navigate("Settings")}
              onOpenUpdates={() => props.navigation.navigate("UpdateCenter")}
              onOpenSecurity={() => props.navigation.navigate("SecurityCenter")}
              onOpenNotifications={() =>
                props.navigation.navigate("NotificationSettings")
              }
            />
          )}
        </Stack.Screen>
        <Stack.Screen name="UpdateCenter" component={UpdateCenterScreen} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
        <Stack.Screen
          name="LanguageSettings"
          component={LanguageSettingsScreen}
        />
        <Stack.Screen
          name="AppearanceSettings"
          component={AppearanceSettingsScreen}
        />
        <Stack.Screen name="PredictEvent">
          {(props) => (
            <EventDetailScreen
              eventId={props.route.params.eventId}
              marketId={props.route.params.marketId}
              initialOutcome={props.route.params.outcome}
              onBack={() => props.navigation.goBack()}
              onOpenSettlement={(marketId) =>
                props.navigation.navigate("PredictSettlement", { marketId })
              }
              onOpenTransfer={(amount) =>
                props.navigation.navigate("Transfer", {
                  direction: "deposit",
                  amount,
                })
              }
            />
          )}
        </Stack.Screen>
        <Stack.Screen name="Leaderboard">
          {(props) => (
            <LeaderboardScreen
              onBack={() => props.navigation.goBack()}
              onOpenPositions={() => props.navigation.navigate("Positions")}
            />
          )}
        </Stack.Screen>
        <Stack.Screen name="Positions">
          {(props) => (
            <PositionsScreen
              onBack={() => props.navigation.goBack()}
              onOpenEvent={(eventId, marketId) =>
                props.navigation.navigate("PredictEvent", { eventId, marketId })
              }
              onOpenSettlement={(marketId) =>
                props.navigation.navigate("PredictSettlement", { marketId })
              }
              onOpenTransfer={() => props.navigation.navigate("Transfer")}
            />
          )}
        </Stack.Screen>
        <Stack.Screen name="PredictSettlement">
          {(props) => (
            <SettlementScreen
              marketId={props.route.params.marketId}
              onBack={() => props.navigation.goBack()}
            />
          )}
        </Stack.Screen>
        <Stack.Screen name="DexToken" component={DexTokenScreen} />
        <Stack.Screen name="Swap" component={SwapDetailScreen} />
        <Stack.Screen name="SwapHistory" component={SwapHistoryScreen} />
        <Stack.Screen name="Transfer">
          {(props) => (
            <TransferScreen
              direction={props.route.params?.direction}
              amount={props.route.params?.amount}
              onBack={() => props.navigation.goBack()}
            />
          )}
        </Stack.Screen>
        <Stack.Screen name="Send">
          {(props) => (
            <SendScreen
              initialChain={props.route.params?.chain}
              onBack={() => props.navigation.goBack()}
            />
          )}
        </Stack.Screen>
        <Stack.Screen name="AccountDetail">
          {(props) => (
            <AccountDetailScreen
              kind={props.route.params.kind}
              onBack={() => props.navigation.goBack()}
              onOpenSend={() => props.navigation.navigate("Send")}
              onOpenSwap={() => props.navigation.navigate("Swap")}
            />
          )}
        </Stack.Screen>
        <Stack.Screen
          name="NotificationSettings"
          component={NotificationSettingsScreen}
        />
        <Stack.Screen name="About" component={AboutScreen} />
        <Stack.Screen name="SecurityCenter" component={SecurityCenterScreen} />
      </Stack.Navigator>
      <ConnectWalletSheet />
    </NavigationContainer>
  );
}
