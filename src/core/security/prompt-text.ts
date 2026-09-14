import type { SupportedLocale } from "../config/bootstrap.schema";
import {
  builtinMessages,
  hasBuiltinMessages,
} from "../config/builtin-messages";
import { normalizeMessageKey } from "../config/localization";
import { systemLocale } from "../config/system-locale";
import { usePreferencesStore } from "../preferences/preferences-store";

/**
 * 系统认证弹窗文案（安全评审 N12）。
 *
 * 生物识别 / 设备密码弹窗是唯一由操作系统渲染的可信界面，它显示的那句话不能来自
 * 服务端字典或远程语言包：调用方只传内置字典的 key，这里只从内置字典取文案。
 * key 不存在是编码错误：直接抛错，不把裸 key、远程字符串或"通用文案"放进弹窗。
 */

let appLocale: SupportedLocale | null = null;

/** 应用当前实际显示的语言（服务端选定的 selectedLocale），运行时在每份下发生效后登记 */
export function setPromptAppLocale(locale: SupportedLocale | null): void {
  appLocale = locale;
}

/**
 * 用户选定了语言就用它；默认语言 / 跟随系统时跟应用当前显示的语言走——那是服务端选的，
 * 可能是租户的回退语言。那种语言没有内置字典、或还没拿到下发时，取设备语言
 * （`deviceLocale` 可注入，便于单测）。
 */
export function promptLocale(
  deviceLocale: () => SupportedLocale = systemLocale,
): SupportedLocale {
  const preference = usePreferencesStore.getState().locale;
  if (preference !== "default" && preference !== "system") return preference;
  return hasBuiltinMessages(appLocale) ? appLocale : deviceLocale();
}

export function builtinPromptText(
  key: string,
  locale: SupportedLocale = promptLocale(),
): string {
  const text = builtinMessages(locale)[normalizeMessageKey(key)];
  if (text === undefined)
    // key 是编码期常量：查不到就是代码错误，抛出而不是换一句顶上（否则错误会被静默掩盖）
    throw new Error(`unknown biometric prompt key "${key}"`);
  return text;
}
