import { useCallback, useState } from "react";
import {
  useFoundationRuntime,
  type UpdateCheckResult,
} from "../../app/runtime-context";

export type ManualUpdateCheckState =
  "idle" | "checking" | "latest" | "available" | "error";

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
    const result = await checkForUpdates();
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
