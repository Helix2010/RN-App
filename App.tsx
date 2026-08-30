import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { FoundationRuntimeProvider } from "./src/app/runtime-context";
import { GatewayProvider } from "./src/core/gateways/gateway-context";
import { FoundationNavigator } from "./src/navigation/foundation-navigator";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnReconnect: true, refetchOnWindowFocus: false },
  },
});

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <FoundationRuntimeProvider>
            <GatewayProvider>
              <StatusBar style="auto" />
              <FoundationNavigator />
            </GatewayProvider>
          </FoundationRuntimeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
