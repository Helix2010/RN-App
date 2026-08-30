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
import { ProfileScreen } from "../features/profile/profile-screen";
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
              onOpenSettings={() => props.navigation.navigate("Settings")}
              onOpenUpdates={() => props.navigation.navigate("UpdateCenter")}
            />
          )}
        </Stack.Screen>
        <Stack.Screen name="UpdateCenter" component={UpdateCenterScreen} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
