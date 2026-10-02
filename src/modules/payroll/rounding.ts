import type { Chhertum, RoundingMode } from "@/modules/rules/types";

/**
 * numerator ÷ denominator, rounded to a whole multiple of `unit` (all in chhertum).
 * Exact: works in bigint so no float ever touches money. "nearest" rounds half up.
 */
export function divideAndRound(numerator: bigint, denominator: bigint, unit: Chhertum, mode: RoundingMode): Chhertum {
  if (numerator < 0n || denominator <= 0n || unit <= 0) {
    throw new Error("Rounding needs a non-negative amount and a positive divisor and unit");
  }
  const divisor = denominator * BigInt(unit);
  const whole = numerator / divisor;
  const remainder = numerator % divisor;

  let units = whole;
  if (remainder > 0n) {
    if (mode === "up") units = whole + 1n;
    // Half up: the remainder is at least half the divisor.
    if (mode === "nearest" && remainder * 2n >= divisor) units = whole + 1n;
  }
  return toChhertum(units * BigInt(unit));
}

export function toChhertum(value: bigint): Chhertum {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new Error("Amount is too large to calculate safely");
  return result;
}
