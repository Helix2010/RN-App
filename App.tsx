import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { FoundationRuntimeProvider } from "./src/app/runtime-context";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { GatewayProvider } from "./src/core/gateways/gateway-context";
import { ToastHost } from "./src/design-system";
import { AppLockGate } from "./src/features/security/app-lock-gate";
import { FoundationNavigator } from "./src/navigation/foundation-navigator";
import { UpdateModal } from "./src/features/updates/update-modal";
import { RootErrorBoundary } from "./src/app/root-error-boundary";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnReconnect: true, refetchOnWindowFocus: false },
  },
});

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* 根级错误边界：任何渲染期异常都变成可重试、可复制诊断信息的界面，而不是白屏 */}
      <RootErrorBoundary>
        <SafeAreaProvider>
          <QueryClientProvider client={queryClient}>
            <FoundationRuntimeProvider>
              <GatewayProvider>
                <BottomSheetModalProvider>
                  <StatusBar style="auto" />
                  <FoundationNavigator />
                  <UpdateModal />
                  <AppLockGate />
                  <ToastHost />
                </BottomSheetModalProvider>
              </GatewayProvider>
            </FoundationRuntimeProvider>
          </QueryClientProvider>
        </SafeAreaProvider>
      </RootErrorBoundary>
    </GestureHandlerRootView>
  );
}
