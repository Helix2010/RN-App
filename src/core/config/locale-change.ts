import type { LocalePreference } from "../preferences/preferences-store";
import type { SupportedLocale } from "./bootstrap.schema";

/**
 * 请求 bootstrap 时带哪种语言。null = 不带：服务端返回租户在管理端设的回退语言，
 * 这就是应用的默认语言。`system` 把设备语言交给服务端，租户没开这种语言时服务端
 * 同样退回回退语言——客户端不再自己猜"只有中文和英文"。
 */
export function requestLocale(
  preference: LocalePreference,
  deviceLocale: SupportedLocale | null,
): SupportedLocale | null {
  if (preference === "default") return null;
  if (preference === "system") return deviceLocale;
  return preference;
}

type ChangeLocaleOptions = {
  preference: LocalePreference;
  currentPreference: LocalePreference;
  deviceLocale: SupportedLocale | null;
  stage: (locale: SupportedLocale | null) => Promise<void>;
  commit: (preference: LocalePreference) => void;
};

export async function changeLocalePreference({
  preference,
  currentPreference,
  deviceLocale,
  stage,
  commit,
}: ChangeLocaleOptions): Promise<void> {
  if (preference === currentPreference) return;

  await stage(requestLocale(preference, deviceLocale));
  commit(preference);
}
