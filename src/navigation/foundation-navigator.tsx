import {
  NavigationContainer,
  type Theme as NavigationTheme,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useTheme } from "tamagui";
import { useFoundationRuntime } from "../app/runtime-context";
import { FoundationHomeScreen } from "../features/foundation/foundation-home-screen";
import { UpdateCenterScreen } from "../features/updates/update-center-screen";
import type { RootStackParamList } from "./types";

const Stack = createNativeStackNavigator<RootStackParamList>();

export function FoundationNavigator() {
  const theme = useTheme();
  const { config } = useFoundationRuntime();
  const navigationTheme: NavigationTheme = {
    dark: false,
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

  if (config.update.decision === "required" && config.update.full.actionUrl) {
    return (
      <NavigationContainer theme={navigationTheme}>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="UpdateCenter">
            {(props) => <UpdateCenterScreen {...props} locked />}
          </Stack.Screen>
        </Stack.Navigator>
      </NavigationContainer>
    );
  }

  return (
    <NavigationContainer theme={navigationTheme}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="FoundationHome" component={FoundationHomeScreen} />
        <Stack.Screen name="UpdateCenter" component={UpdateCenterScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
