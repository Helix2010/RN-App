import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import {
  initialWindowMetrics,
  SafeAreaProvider,
} from "react-native-safe-area-context";
import { FoundationRuntimeProvider } from "./src/app/runtime-context";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { GatewayProvider } from "./src/core/gateways/gateway-context";
import { OverlayLayer } from "./src/design-system";
import { AppLockGate } from "./src/features/security/app-lock-gate";
import { FoundationNavigator } from "./src/navigation/foundation-navigator";
import { UpdateModal } from "./src/features/updates/update-modal";
import { RootErrorBoundary } from "./src/app/root-error-boundary";
import { installGlobalCrashCapture } from "./src/core/diagnostics/crash-capture";

// 模块顶层装：要赶在第一次渲染之前，否则启动期的异常记不到（设计 diagnostic-report §4.2）
installGlobalCrashCapture();

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
        {/*
          initialMetrics 是原生常量，模块加载时同步读到，不走 onInsetsChange 的异步
          往返。不传的话 SafeAreaProvider 的 insets 初值是 null，而它在 null 时
          整棵子树都不渲染（SafeAreaContext.tsx），冷启动要多等一帧才开始画。
        */}
        <SafeAreaProvider initialMetrics={initialWindowMetrics}>
          <QueryClientProvider client={queryClient}>
            <FoundationRuntimeProvider>
              <GatewayProvider>
                <BottomSheetModalProvider>
                  <StatusBar style="auto" />
                  <FoundationNavigator />
                  <UpdateModal />
                  <AppLockGate />
                </BottomSheetModalProvider>
                {/* 覆盖层必须在 BottomSheetModalProvider 之外且之后：
                    弹层宿主渲染在 Provider 的 children 之后，放在里面的 toast / loading 会被弹层压住 */}
                <OverlayLayer />
              </GatewayProvider>
            </FoundationRuntimeProvider>
          </QueryClientProvider>
        </SafeAreaProvider>
      </RootErrorBoundary>
    </GestureHandlerRootView>
  );
}
