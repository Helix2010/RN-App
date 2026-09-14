import { getLocales } from "expo-localization";
import type { SupportedLocale } from "./bootstrap.schema";

/**
 * 设备语言映射到**内置字典**的两种语言：英文走 en-US，其余 zh-CN。
 * 只给拿不到服务端配置的地方用（崩溃页、系统验证弹窗兜底、下发到达前的启动门禁）；
 * 应用用哪种语言由服务端决定，见 locale-change.ts 的 requestLocale。
 */
export function systemLocale(): SupportedLocale {
  return getLocales()[0]?.languageCode === "en" ? "en-US" : "zh-CN";
}

/**
 * 设备首选语言的「语言-地区」标签（zh-CN / en-US / ja-JP），交给服务端去匹配租户开启的语言。
 * 不带文字变体（zh-Hans-CN 只取 zh-CN）：服务端的语言码就是这种形式。
 */
export function deviceLanguageTag(): SupportedLocale | null {
  const preferred = getLocales()[0];
  if (!preferred?.languageCode) return null;
  const language = preferred.languageCode.toLowerCase();
  return preferred.regionCode
    ? `${language}-${preferred.regionCode.toUpperCase()}`
    : language;
}
