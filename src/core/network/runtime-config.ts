export function resolveApiBaseUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\/$/, "");
  return normalized === "" ? null : normalized;
}

export function resolveRuntimeVersion(value: unknown): string {
  if (typeof value !== "string") return "embedded";
  const normalized = value.trim();
  return normalized === "" ? "embedded" : normalized;
}
