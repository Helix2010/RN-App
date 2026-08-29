export type FullUpdatePromptInput = {
  pending: boolean;
  signalType?: string;
  signalEventId?: string;
  dismissedSignalEventId: string;
  decision: "none" | "optional" | "recommended" | "required";
  actionUrl: string | null;
};

/** A push opens consent; it never starts an APK download by itself. */
export function shouldShowFullUpdatePrompt(
  input: FullUpdatePromptInput,
): boolean {
  if (input.pending) return true;
  return (
    input.signalType === "app_update_available" &&
    Boolean(input.signalEventId) &&
    input.signalEventId !== input.dismissedSignalEventId &&
    input.decision !== "none" &&
    Boolean(input.actionUrl)
  );
}
