import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useEffect, type PropsWithChildren } from "react";
import { useFoundationRuntime } from "../../app/runtime-context";
import type { RootStackParamList } from "../../navigation/types";

export type AppModule = "predict" | "dex";

/**
 * 模块开关的最后一道闸：包住只属于某个模块的栈内页面。
 *
 * 入口（底部页签、首页快捷入口、资产页账户卡）已经按 `config.modules` 隐藏，但栈内页面
 * 本身是无条件注册的——bootstrap 刷新把模块关掉时用户可能正停在预测详情页，将来接推送
 * 深链也可能直接打开这些页面。开关关闭时这里不渲染任何模块内容并退回首页，
 * 页面里的行情 / 账户请求随之卸载，不会再打到平台。
 */
export function ModuleGate({
  module,
  children,
}: PropsWithChildren<{
  /** `null` 表示这个页面不属于任何模块（如钱包账户详情），直接放行 */
  module: AppModule | null;
}>) {
  const { config } = useFoundationRuntime();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const enabled = module === null ? true : config.modules[module];

  useEffect(() => {
    if (enabled) return;
    if (navigation.canGoBack()) navigation.popToTop();
  }, [enabled, navigation]);

  if (!enabled) return null;
  return <>{children}</>;
}
