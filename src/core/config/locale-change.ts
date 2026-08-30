import type { LocalePreference } from "../preferences/preferences-store";
import type { SupportedLocale } from "./bootstrap.schema";

type ChangeLocaleOptions = {
  preference: LocalePreference;
  currentPreference: LocalePreference;
  systemLocale: SupportedLocale;
  stage: (locale: SupportedLocale) => Promise<void>;
  commit: (preference: LocalePreference) => void;
};

export function resolveLocalePreference(
  preference: LocalePreference,
  systemLocale: SupportedLocale,
): SupportedLocale {
  return preference === "system" ? systemLocale : preference;
}

export async function changeLocalePreference({
  preference,
  currentPreference,
  systemLocale,
  stage,
  commit,
}: ChangeLocaleOptions): Promise<void> {
  if (preference === currentPreference) return;

  const targetLocale = resolveLocalePreference(preference, systemLocale);
  await stage(targetLocale);
  commit(preference);
}
