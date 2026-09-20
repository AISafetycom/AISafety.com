/**
 * Round a count to a few significant figures for display, e.g. 14,356 → 14,000
 * with the default two. For numbers a reader will quote ("about 14,000
 * visitors a month"), where the exact figure suggests a precision it doesn't
 * have. Rounds to the nearest, not up. Never returns a fraction.
 */
export function roundToFigures(value: number, figures = 2): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  const exponent = Math.floor(Math.log10(value)) + 1 - figures
  if (exponent <= 0) return Math.round(value)
  const step = 10 ** exponent
  return Math.round(value / step) * step
}
