/**
 * Largest-Triangle-Three-Buckets downsampling. Used ONLY to draw very long
 * curves quickly; all calculations always use the full-resolution data.
 * Returns the indices of the points to draw (first and last are kept).
 */
export function lttbIndices(x: ArrayLike<number>, y: ArrayLike<number>, threshold: number): number[] {
  const n = x.length;
  if (threshold >= n || threshold < 3) return Array.from({ length: n }, (_, i) => i);
  const out = [0];
  const every = (n - 2) / (threshold - 2);
  let a = 0;
  for (let i = 0; i < threshold - 2; i++) {
    const avgStart = Math.floor((i + 1) * every) + 1;
    const avgEnd = Math.min(Math.floor((i + 2) * every) + 1, n);
    let ax = 0, ay = 0, cnt = 0;
    for (let j = avgStart; j < avgEnd; j++) {
      if (Number.isFinite(y[j])) { ax += x[j]; ay += y[j]; cnt++; }
    }
    ax /= cnt || 1; ay /= cnt || 1;
    const rs = Math.floor(i * every) + 1;
    const re = Math.floor((i + 1) * every) + 1;
    let best = rs, bestArea = -1;
    for (let j = rs; j < re; j++) {
      const area = Math.abs((x[a] - ax) * (y[j] - y[a]) - (x[a] - x[j]) * (ay - y[a]));
      if (area > bestArea) { bestArea = area; best = j; }
    }
    out.push(best);
    a = best;
  }
  out.push(n - 1);
  return out;
}
