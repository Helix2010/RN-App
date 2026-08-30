/** 内容多语言：来自服务端的字段级翻译串（市场标题 / 标签 / 代币名）。 */
export type LocalizedText = Partial<Record<string, string>>;

/**
 * 回退链：精确 locale → 短语言（zh-CN → zh）→ 同前缀任意变体 → default → en → 首个非空。
 * 与 UI 文案 key 体系分层，见 rn-implementation-plan §5.5。
 */
export function pickTranslation(
  value: LocalizedText | string | undefined,
  locale: string,
): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  const exact = value[locale] ?? value[locale.replace("-", "_")];
  if (exact) return exact;
  const short = locale.split(/[-_]/)[0] ?? locale;
  if (value[short]) return value[short] as string;
  const prefixed = Object.keys(value).find((key) =>
    key.toLowerCase().startsWith(short.toLowerCase()),
  );
  if (prefixed && value[prefixed]) return value[prefixed] as string;
  if (value.default) return value.default;
  if (value.en) return value.en;
  const first = Object.values(value).find((text) => Boolean(text));
  return first ?? "";
}

export function localized(zh: string, en: string): LocalizedText {
  return { "zh-CN": zh, "en-US": en };
}
