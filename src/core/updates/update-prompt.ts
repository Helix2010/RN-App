export type FullUpdatePromptInput = {
  pending: boolean;
  signalType?: string;
  signalEventId?: string;
  dismissedSignalEventId: string;
  decision: "none" | "optional" | "recommended" | "required";
  actionUrl: string | null;
  directInstallEnabled: boolean;
};

/** A push opens consent; it never starts an APK download by itself. */
export function shouldShowFullUpdatePrompt(
  input: FullUpdatePromptInput,
): boolean {
  if (input.pending)
    return input.directInstallEnabled && Boolean(input.actionUrl);
  return (
    input.signalType === "app_update_available" &&
    Boolean(input.signalEventId) &&
    input.signalEventId !== input.dismissedSignalEventId &&
    input.decision !== "none" &&
    input.directInstallEnabled &&
    Boolean(input.actionUrl)
  );
}
