import { getLocales } from "expo-localization";
import type { SupportedLocale } from "./bootstrap.schema";

/** 设备语言映射到内置支持的语言：只有英文走 en-US，其余都用 zh-CN。 */
export function systemLocale(): SupportedLocale {
  return getLocales()[0]?.languageCode === "en" ? "en-US" : "zh-CN";
}
