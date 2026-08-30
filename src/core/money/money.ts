/**
 * Money：链上/账本金额的领域表示。
 * raw 是最小单位的十进制整数字符串（如 USDC 6 位小数时 1 USDC = "1000000"），
 * 所有运算走 BigInt，禁止用 JS number 做金额计算（WEB3_UI_STANDARD §2）。
 */
export type Money = {
  raw: string;
  decimals: number;
  symbol: string;
};

const DIGITS = /^-?\d+$/;

export function money(
  raw: string | bigint,
  decimals: number,
  symbol: string,
): Money {
  const value = typeof raw === "bigint" ? raw.toString() : raw;
  if (!DIGITS.test(value)) throw new Error(`Invalid raw amount: ${value}`);
  return { raw: value, decimals, symbol };
}

/** 从人类可读的小数字符串构造，如 fromDecimal("12.5", 6, "USDC") */
export function fromDecimal(
  text: string,
  decimals: number,
  symbol: string,
): Money {
  const trimmed = text.trim().replace(/,/g, "");
  if (!/^-?\d*(\.\d*)?$/.test(trimmed) || trimmed === "" || trimmed === "-")
    throw new Error(`Invalid decimal amount: ${text}`);
  const negative = trimmed.startsWith("-");
  const [intPart = "0", fracPart = ""] = trimmed.replace("-", "").split(".");
  const frac = (fracPart + "0".repeat(decimals)).slice(0, decimals);
  const raw =
    BigInt(intPart || "0") * 10n ** BigInt(decimals) + BigInt(frac || "0");
  return money((negative ? -raw : raw).toString(), decimals, symbol);
}

export function toBigInt(value: Money): bigint {
  return BigInt(value.raw);
}

function assertSame(a: Money, b: Money): void {
  if (a.symbol !== b.symbol || a.decimals !== b.decimals)
    throw new Error(
      `Money mismatch: ${a.symbol}/${a.decimals} vs ${b.symbol}/${b.decimals}`,
    );
}

export function add(a: Money, b: Money): Money {
  assertSame(a, b);
  return money(toBigInt(a) + toBigInt(b), a.decimals, a.symbol);
}

export function sub(a: Money, b: Money): Money {
  assertSame(a, b);
  return money(toBigInt(a) - toBigInt(b), a.decimals, a.symbol);
}

export function isZero(value: Money): boolean {
  return toBigInt(value) === 0n;
}

export function isNegative(value: Money): boolean {
  return toBigInt(value) < 0n;
}

export function compare(a: Money, b: Money): -1 | 0 | 1 {
  assertSame(a, b);
  const x = toBigInt(a);
  const y = toBigInt(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** 按万分比（bps）缩放，四舍五入到最小单位。用于手续费、滑点。 */
export function scaleBps(value: Money, bps: number): Money {
  if (!Number.isInteger(bps) || bps < 0) throw new Error(`Invalid bps: ${bps}`);
  const scaled = (toBigInt(value) * BigInt(bps) + 5_000n) / 10_000n;
  return money(scaled, value.decimals, value.symbol);
}

/**
 * 按有理数比例缩放：value * numerator / denominator，四舍五入。
 * 用于按价格换算份额等，不引入浮点。
 */
export function scaleRatio(
  value: Money,
  numerator: bigint,
  denominator: bigint,
): Money {
  if (denominator === 0n) throw new Error("Division by zero");
  const product = toBigInt(value) * numerator;
  const rounded = (product * 2n + denominator) / (denominator * 2n);
  return money(rounded, value.decimals, value.symbol);
}

/** 转成十进制字符串（不做本地化，不丢精度），maxFraction 截断小数位。 */
export function toDecimalString(
  value: Money,
  maxFraction = value.decimals,
): string {
  const negative = isNegative(value);
  const abs = negative ? -toBigInt(value) : toBigInt(value);
  const base = 10n ** BigInt(value.decimals);
  const intPart = (abs / base).toString();
  let frac = (abs % base).toString().padStart(value.decimals, "0");
  frac = frac
    .slice(0, Math.max(0, Math.min(maxFraction, value.decimals)))
    .replace(/0+$/, "");
  return `${negative ? "-" : ""}${intPart}${frac ? `.${frac}` : ""}`;
}

/** 近似换成 number，只允许用于展示/排序/图表，禁止回写为金额。 */
export function toApproxNumber(value: Money): number {
  return Number(toDecimalString(value));
}

export function zero(decimals: number, symbol: string): Money {
  return money("0", decimals, symbol);
}
