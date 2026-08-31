/** 语言本地名 + 英文名；副标题用当前界面语言的译名（fallback 到英文）。 */
export const LANGUAGE_NAMES: Record<
  string,
  { native: string; en: string; zh: string }
> = {
  "zh-CN": { native: "简体中文", en: "Simplified Chinese", zh: "简体中文" },
  "en-US": { native: "English", en: "English", zh: "英语" },
  "zh-TW": { native: "繁體中文", en: "Traditional Chinese", zh: "繁体中文" },
  "ja-JP": { native: "日本語", en: "Japanese", zh: "日语" },
  "ko-KR": { native: "한국어", en: "Korean", zh: "韩语" },
  "vi-VN": { native: "Tiếng Việt", en: "Vietnamese", zh: "越南语" },
};
