import { toApproxNumber, type Money } from "../money/money";

/**
 * 展示格式化层：所有把数值变成文案的逻辑集中在这里。
 * 输入领域模型，输出字符串；不做业务计算。
 */

const intlLocale = (locale: string) => (locale === "zh-CN" ? "zh-CN" : "en-US");

export function formatUsd(
  value: number,
  locale: string,
  options?: { compact?: boolean; sign?: boolean },
): string {
  // Hermes 的 Intl 不支持 notation:"compact"，紧凑格式手动处理
  if (options?.compact) {
    const sign = value < 0 ? "-" : options.sign && value > 0 ? "+" : "";
    return `${sign}$${formatCompactNumber(Math.abs(value), locale)}`;
  }
  const formatter = new Intl.NumberFormat(intlLocale(locale), {
    style: "currency",
    currency: "USD",
    currencyDisplay: "narrowSymbol",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    signDisplay: options?.sign ? "exceptZero" : "auto",
  });
  return formatter.format(value);
}

export function formatTokenPrice(price: string, locale: string): string {
  const value = Number(price);
  if (!Number.isFinite(value)) return price;
  if (value === 0) return formatUsd(0, locale);
  if (value >= 1) return formatUsd(value, locale);
  const digits = Math.min(12, Math.max(4, -Math.floor(Math.log10(value)) + 3));
  return `$${value.toFixed(digits).replace(/0+$/, "")}`;
}

/** 返回前导零折叠的两段：{ head: "$0.0000", tail: "1234" }；无折叠时 tail 为空。 */
export function splitLeadingZeros(formatted: string): {
  head: string;
  tail: string;
} {
  const match = /^(\$0\.0{3,})(\d+)$/.exec(formatted);
  if (!match) return { head: formatted, tail: "" };
  return { head: match[1] ?? formatted, tail: match[2] ?? "" };
}

export function formatPercent(
  value: number,
  locale: string,
  options?: { sign?: boolean; digits?: number },
): string {
  return new Intl.NumberFormat(intlLocale(locale), {
    style: "percent",
    maximumFractionDigits: options?.digits ?? 2,
    minimumFractionDigits: options?.digits ?? 2,
    signDisplay: options?.sign ? "exceptZero" : "auto",
  }).format(value / 100);
}

/** 预测价格：0–100 的整数分 → "62¢"，支持 0.5 档。 */
export function formatCents(cents: number): string {
  return `${Number.isInteger(cents) ? cents : cents.toFixed(1)}¢`;
}

/** 概率：0–1 → "62%" */
export function formatProbability(probability: number): string {
  return `${Math.round(probability * 100)}%`;
}

export function formatMoney(
  value: Money,
  locale: string,
  options?: { maxFraction?: number; withSymbol?: boolean },
): string {
  const approx = toApproxNumber(value);
  const maxFraction =
    options?.maxFraction ?? Math.min(value.decimals, approx >= 1 ? 2 : 6);
  const text = new Intl.NumberFormat(intlLocale(locale), {
    maximumFractionDigits: maxFraction,
    minimumFractionDigits: approx >= 1 ? Math.min(2, maxFraction) : 0,
  }).format(approx);
  return options?.withSymbol === false ? text : `${text} ${value.symbol}`;
}

/** 紧凑数字：1.2K / 3.4M / 5.1B（Hermes Intl 对 compact 支持不完整，手动实现，跨引擎一致）。 */
export function formatCompactNumber(value: number, locale: string): string {
  const abs = Math.abs(value);
  const units: [number, string][] = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  for (const [threshold, suffix] of units) {
    if (abs >= threshold) {
      const scaled = abs / threshold;
      const text =
        scaled >= 100
          ? scaled.toFixed(0)
          : scaled.toFixed(1).replace(/\.0$/, "");
      return `${value < 0 ? "-" : ""}${text}${suffix}`;
    }
  }
  return new Intl.NumberFormat(intlLocale(locale), {
    maximumFractionDigits: 1,
  }).format(value);
}

export function shortenAddress(address: string, head = 6, tail = 4): string {
  if (address.length <= head + tail + 1) return address;
  return `${address.slice(0, head)}…${address.slice(-tail)}`;
}

/** 相对截止时间："1 天 4 小时后" / "in 1d 4h"；已过期返回空字符串由调用方处理。 */
export function formatTimeUntil(
  target: string,
  nowMs: number,
  locale: string,
): string {
  const diff = new Date(target).getTime() - nowMs;
  if (!Number.isFinite(diff) || diff <= 0) return "";
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const zh = locale === "zh-CN";
  if (days >= 1)
    return zh
      ? `${days} 天 ${hours % 24} 小时后`
      : `in ${days}d ${hours % 24}h`;
  if (hours >= 1)
    return zh
      ? `${hours} 小时 ${minutes % 60} 分后`
      : `in ${hours}h ${minutes % 60}m`;
  return zh ? `${Math.max(1, minutes)} 分钟后` : `in ${Math.max(1, minutes)}m`;
}

/** 倒计时 "21:14:38" */
export function formatCountdown(target: string, nowMs: number): string {
  const diff = Math.max(0, new Date(target).getTime() - nowMs);
  const total = Math.floor(diff / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((part) => String(part).padStart(2, "0")).join(":");
}

export function formatDateTime(
  iso: string,
  locale: string,
  options?: { withYear?: boolean },
): string {
  const date = new Date(iso);
  return new Intl.DateTimeFormat(intlLocale(locale), {
    month: locale === "zh-CN" ? "numeric" : "short",
    day: "numeric",
    year: options?.withYear ? "numeric" : undefined,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    month: locale === "zh-CN" ? "numeric" : "short",
    day: "numeric",
  }).format(new Date(iso));
}
