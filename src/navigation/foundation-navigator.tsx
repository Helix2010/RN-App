import {
  NavigationContainer,
  useNavigationContainerRef,
  type Theme as NavigationTheme,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useTheme } from "tamagui";
import { useFoundationRuntime } from "../app/runtime-context";
import { AppShellScreen } from "../features/foundation/app-shell-screen";
import { SettingsScreen } from "../features/settings/settings-screen";
import { LanguageSettingsScreen } from "../features/settings/language-settings-screen";
import { AppearanceSettingsScreen } from "../features/settings/appearance-settings-screen";
import { NotificationSettingsScreen } from "../features/settings/notification-settings-screen";
import { SecurityCenterScreen } from "../features/settings/security-center-screen";
import { AboutScreen } from "../features/settings/about-screen";
import { WalletsScreen } from "../features/wallet/ui/wallets-screen";
import { BackupScreen } from "../features/wallet/ui/backup-screen";
import { ProfileScreen } from "../features/profile/profile-screen";
import { ConnectWalletSheet } from "../features/session/ui/connect-wallet-sheet";
import { SessionRevalidator } from "../features/session/ui/session-revalidator";
import { WalletConnectSheet } from "../features/wallet/ui/walletconnect-sheet";
import { WalletImportScreen } from "../features/wallet/ui/wallet-import-screen";
import { WalletSetupScreen } from "../features/wallet/ui/wallet-setup-screen";
import { AccountDetailScreen } from "../features/assets/ui/account-detail-screen";
import { SendScreen } from "../features/assets/ui/send-screen";
import { TransferScreen } from "../features/assets/ui/transfer-screen";
import { EventDetailScreen } from "../features/predict/ui/event-detail-screen";
import { SettlementScreen } from "../features/predict/ui/settlement-screen";
import { LeaderboardScreen } from "../features/predict/ui/leaderboard-screen";
import { PositionsScreen } from "../features/predict/ui/positions-screen";
import { PredictEnableScreen } from "../features/predict/ui/predict-enable-screen";
import { TokenDetailScreen } from "../features/dex/ui/token-detail-screen";
import { SwapScreen } from "../features/dex/ui/swap-screen";
import { SwapHistoryScreen } from "../features/dex/ui/swap-history-screen";
import { ApprovalsScreen } from "../features/dex/ui/approvals-screen";
import { TOKENS } from "../features/wallet/fixtures/wallet";
import type { TokenRef } from "../core/gateways/types";
import type { RootStackParamList } from "./types";
import { useSystemBackHandler } from "./use-system-back";

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

  useSystemBackHandler({
    // 强制升级时吞掉返回键。这里以前硬编码 false，`resolveSystemBack` 的
    // updateLocked 分支从来没被调用过——强更弹窗顶住返回键全靠原生 Modal 的
    // onRequestClose 是空实现，换个实现方式就会被无声绕过。
    updateLocked: config.update.decision === "required",
    getRouteName: () => navigationRef.getCurrentRoute()?.name,
    canGoBack: () => navigationRef.canGoBack(),
    goBack: () => navigationRef.goBack(),
  });

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
        <Stack.Screen name="Profile" component={ProfileScreen} />
        <Stack.Screen name="Wallets" component={WalletsScreen} />
        <Stack.Screen name="WalletSetup" component={WalletSetupScreen} />
        <Stack.Screen name="WalletImport" component={WalletImportScreen} />
        <Stack.Screen name="WalletBackup" component={BackupScreen} />
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
              onOpenSettlement={(marketId, eventId) =>
                props.navigation.navigate("PredictSettlement", {
                  marketId,
                  eventId,
                })
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
              onOpenSettlement={(marketId, eventId) =>
                props.navigation.navigate("PredictSettlement", {
                  marketId,
                  eventId,
                })
              }
              onOpenTransfer={() => props.navigation.navigate("Transfer")}
            />
          )}
        </Stack.Screen>
        <Stack.Screen name="PredictSettlement">
          {(props) => (
            <SettlementScreen
              marketId={props.route.params.marketId}
              eventId={props.route.params.eventId}
              onBack={() => props.navigation.goBack()}
            />
          )}
        </Stack.Screen>
        <Stack.Screen name="DexToken">
          {(props) => (
            <TokenDetailScreen
              chain={props.route.params.chain}
              address={props.route.params.address}
              onBack={() => props.navigation.goBack()}
              onSwap={(side) =>
                props.navigation.navigate(
                  "Swap",
                  side === "buy"
                    ? {
                        chain: props.route.params.chain,
                        buyAddress: props.route.params.address,
                      }
                    : {
                        chain: props.route.params.chain,
                        sellAddress: props.route.params.address,
                      },
                )
              }
            />
          )}
        </Stack.Screen>
        <Stack.Screen name="Swap">
          {(props) => {
            const find = (address?: string): TokenRef | undefined =>
              address
                ? Object.values(TOKENS as Record<string, TokenRef>).find(
                    (token) =>
                      token.address.toLowerCase() === address.toLowerCase() &&
                      token.chain ===
                        (props.route.params?.chain ?? token.chain),
                  )
                : undefined;
            return (
              <SwapScreen
                onBack={() => props.navigation.goBack()}
                onOpenHistory={() => props.navigation.navigate("SwapHistory")}
                onOpenTransfer={() => props.navigation.navigate("Transfer")}
                initialChain={props.route.params?.chain}
                initialSell={find(props.route.params?.sellAddress)}
                initialBuy={find(props.route.params?.buyAddress)}
              />
            );
          }}
        </Stack.Screen>
        <Stack.Screen name="Approvals">
          {(props) => (
            <ApprovalsScreen onBack={() => props.navigation.goBack()} />
          )}
        </Stack.Screen>
        <Stack.Screen name="SwapHistory">
          {(props) => (
            <SwapHistoryScreen
              onBack={() => props.navigation.goBack()}
              onOpenApprovals={() => props.navigation.navigate("Approvals")}
            />
          )}
        </Stack.Screen>
        <Stack.Screen name="PredictEnable">
          {(props) => (
            <PredictEnableScreen
              onBack={() => props.navigation.goBack()}
              onDone={() => props.navigation.goBack()}
            />
          )}
        </Stack.Screen>
        <Stack.Screen name="Transfer">
          {(props) => (
            <TransferScreen
              direction={props.route.params?.direction}
              amount={props.route.params?.amount}
              onBack={() => props.navigation.goBack()}
              onOpenEnable={() => props.navigation.navigate("PredictEnable")}
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
              onOpenPredictEnable={() =>
                props.navigation.navigate("PredictEnable")
              }
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
      <SessionRevalidator />
      <ConnectWalletSheet />
      <WalletConnectSheet />
    </NavigationContainer>
  );
}
