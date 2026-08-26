export function normalizeMessageKey(key: string): string {
  return key.trim().toLowerCase();
}

export function normalizeMessages(
  messages: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(messages).map(([key, value]) => [
      normalizeMessageKey(key),
      value,
    ]),
  );
}

export function translateMessage(
  messages: Record<string, string>,
  key: string,
): string {
  const normalizedKey = normalizeMessageKey(key);
  return messages[normalizedKey] ?? normalizedKey;
}
