import { useEffect } from "react";
import { BackHandler } from "react-native";
import { resolveSystemBack, type RootRouteName } from "./system-back";

/**
 * Android 硬件返回键 / 手势返回的处理。
 *
 * 单独抽出来是为了能测**接线本身**：`resolveSystemBack` 的 updateLocked 分支
 * 曾经因为调用处硬编码 `false` 而成为死代码，纯函数的单测完全测不出来。
 */
export function useSystemBackHandler(input: {
  /** 强制升级进行中：返回键必须被吞掉，不能让用户绕过弹窗 */
  updateLocked: boolean;
  getRouteName: () => RootRouteName | undefined;
  canGoBack: () => boolean;
  goBack: () => void;
}): void {
  const { updateLocked, getRouteName, canGoBack, goBack } = input;
  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        const action = resolveSystemBack(
          getRouteName(),
          canGoBack(),
          updateLocked,
        );
        if (action === "navigate") {
          goBack();
          return true;
        }
        return action === "consume";
      },
    );
    return () => subscription.remove();
  }, [canGoBack, getRouteName, goBack, updateLocked]);
}
