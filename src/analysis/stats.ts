/** Deterministic statistics helpers. All functions ignore NaN values. */

export function finite(values: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i])) out.push(values[i]);
  return out;
}

export function mean(values: ArrayLike<number>): number {
  let s = 0;
  let n = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (Number.isFinite(v)) {
      s += v;
      n++;
    }
  }
  return n > 0 ? s / n : NaN;
}

/** Sample standard deviation (n − 1). NaN when fewer than 2 values. */
export function sampleSD(values: ArrayLike<number>): number {
  const m = mean(values);
  let ss = 0;
  let n = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (Number.isFinite(v)) {
      ss += (v - m) ** 2;
      n++;
    }
  }
  return n > 1 ? Math.sqrt(ss / (n - 1)) : NaN;
}

export function median(values: ArrayLike<number>): number {
  const s = finite(values).sort((a, b) => a - b);
  if (s.length === 0) return NaN;
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Raw median absolute deviation (not scaled by 1.4826). */
export function mad(values: ArrayLike<number>, center?: number): number {
  const c = center ?? median(values);
  const dev = finite(values).map((v) => Math.abs(v - c));
  return median(dev);
}

/** Smallest positive difference between distinct values: the recorded force resolution. */
export function resolutionStep(values: ArrayLike<number>): number {
  const u = Array.from(new Set(finite(values))).sort((a, b) => a - b);
  let step = Infinity;
  for (let i = 1; i < u.length; i++) {
    const d = u[i] - u[i - 1];
    if (d > 1e-9 && d < step) step = d;
  }
  return Number.isFinite(step) ? step : NaN;
}

export function coefficientOfVariation(values: ArrayLike<number>): number {
  const m = mean(values);
  const sd = sampleSD(values);
  return Number.isFinite(m) && Number.isFinite(sd) && m !== 0 ? Math.abs(sd / m) : NaN;
}

/**
 * Modified Z-score (Iglewicz & Hoaglin): 0.6745 (x − median) / MAD.
 * When MAD is 0 (more than half the values identical) the mean absolute
 * deviation is used instead (scaled by 0.7979), and if that is also 0 the
 * scores are 0 for values equal to the median and ±Infinity otherwise.
 */
export function modifiedZScores(values: number[]): { z: number[]; median: number; mad: number; method: string } {
  const med = median(values);
  const m = mad(values, med);
  if (m > 0) return { z: values.map((v) => (0.6745 * (v - med)) / m), median: med, mad: m, method: 'MAD' };
  const meanAD = mean(values.map((v) => Math.abs(v - med)));
  if (meanAD > 0) {
    return { z: values.map((v) => (v - med) / (1.253314 * meanAD)), median: med, mad: m, method: 'meanAD' };
  }
  return { z: values.map((v) => (v === med ? 0 : v > med ? Infinity : -Infinity)), median: med, mad: m, method: 'none' };
}

export function round(v: number, digits = 6): number {
  if (!Number.isFinite(v)) return v;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}
