/**
 * "Choose your experiment" dropdowns of the 90° Peel mode: charge ratio, then
 * concentration (those measured at that charge ratio), then substrate (those
 * measured at that charge ratio and concentration). Each can also be "all".
 * Values come from the folder and file names (RunCondition).
 */
import type { ExperimentPick } from '../types';
import type { RunCondition } from './runCompare';

export interface PickOption {
  value: string;
  label: string;
}

/** Substrates that differ only in capitals or spaces ("ss", "SS ") are the same. */
export const substrateKey = (s: string) => s.trim().toLowerCase();

export function matchesPick(c: RunCondition, p: ExperimentPick): boolean {
  return (
    (p.chargeRatio === null || c.chargeRatio === p.chargeRatio) &&
    (p.concentration === null || c.concentration === p.concentration) &&
    (p.substrate === null || substrateKey(c.substrate) === p.substrate)
  );
}

const numericFirst = (a: string, b: string) => {
  const x = Number(a);
  const y = Number(b);
  if (Number.isFinite(x) && Number.isFinite(y)) return x - y;
  if (Number.isFinite(x)) return -1;
  if (Number.isFinite(y)) return 1;
  return a.localeCompare(b, undefined, { numeric: true });
};

export function pickOptions(conds: RunCondition[], p: ExperimentPick): { chargeRatios: PickOption[]; concentrations: PickOption[]; substrates: PickOption[] } {
  const inCr = conds.filter((c) => p.chargeRatio === null || c.chargeRatio === p.chargeRatio);
  const inConc = inCr.filter((c) => p.concentration === null || c.concentration === p.concentration);
  const chargeRatios = [...new Set(conds.map((c) => c.chargeRatio))].sort(numericFirst).map((v) => ({ value: v, label: v === '—' ? 'unknown' : v }));
  const concentrations = [...new Set(inCr.map((c) => c.concentration))].sort(numericFirst).map((v) => ({
    value: v,
    label: v === '—' ? 'unknown' : `${v} M${inCr.filter((c) => c.concentration === v).every((c) => c.concentrationDefault) ? ' (default)' : ''}`,
  }));
  const subs = new Map<string, string>();
  for (const c of inConc) if (!subs.has(substrateKey(c.substrate))) subs.set(substrateKey(c.substrate), c.substrate.trim());
  const substrates = [...subs.entries()].sort((a, b) => numericFirst(a[0], b[0])).map(([value, label]) => ({ value, label: value === '—' ? 'unknown' : label }));
  return { chargeRatios, concentrations, substrates };
}

/** Drop choices that no longer exist (e.g. a concentration not measured at the newly chosen charge ratio). */
export function normalizePick(conds: RunCondition[], p: ExperimentPick): ExperimentPick {
  const out = { ...p };
  let o = pickOptions(conds, out);
  if (out.chargeRatio !== null && !o.chargeRatios.some((x) => x.value === out.chargeRatio)) out.chargeRatio = null;
  o = pickOptions(conds, out);
  if (out.concentration !== null && !o.concentrations.some((x) => x.value === out.concentration)) out.concentration = null;
  o = pickOptions(conds, out);
  if (out.substrate !== null && !o.substrates.some((x) => x.value === out.substrate)) out.substrate = null;
  return out;
}
