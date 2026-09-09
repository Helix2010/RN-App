import { useCallback, useState } from "react";
import {
  useFoundationRuntime,
  type UpdateCheckResult,
} from "../../app/runtime-context";

export type ManualUpdateCheckState =
  "idle" | "checking" | "latest" | "available" | "error";

/** 第一次失败后隔多久再试一次；网络抖动通常一两秒就过去了 */
const RETRY_DELAY_MS = 1_500;

/**
 * 手动"检查更新"：失败先静默重试一次再报错（真机上一次网络抖动就让这一行停在"无法获取远程配置"），
 * 报错文案本身是"点击重试"的邀请，行仍可点。
 */
export function useManualUpdateCheck() {
  const { checkForUpdates } = useFoundationRuntime();
  const [state, setState] = useState<ManualUpdateCheckState>("idle");

  const check = useCallback(async (): Promise<UpdateCheckResult> => {
    if (state === "checking")
      return {
        kind: "error",
        error: new Error("Update check already in progress"),
      };
    setState("checking");
    let result = await checkForUpdates();
    if (result.kind === "error") {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      result = await checkForUpdates();
    }
    setState(
      result.kind === "error"
        ? "error"
        : result.kind === "none"
          ? "latest"
          : "available",
    );
    return result;
  }, [checkForUpdates, state]);

  return { state, checking: state === "checking", check };
}
