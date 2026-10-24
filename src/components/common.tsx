import { useCallback, type ReactNode } from 'react';
import { useApp } from '../state/AppContext';
import { QC_LABEL, QC_ORDER } from '../analysis/pointOutliers';
import type { ForceUnit } from '../types';

export const fmt = (v: number | null | undefined, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(d));

/** Decimals for a force value in the chosen unit. */
export const forceDigits = (u: ForceUnit) => (u === 'N' ? 4 : 2);

/** "mean ± SD (n = k)" for display; the inputs are already in the display unit. */
export function meanSd(mean: number, sd: number, n: number, d: number): string {
  if (n === 0) return 'no runs';
  return `${fmt(mean, d)} ± ${n > 1 ? fmt(sd, d) : '—'} (n = ${n})`;
}

export function QcLegend({ compact = false }: { compact?: boolean }) {
  return (
    <span className="qc-legend">
      {QC_ORDER.map((c) => (
        <span key={c}>
          <span className={`qc-dot ${c}`} /> {compact ? QC_LABEL[c].split(' —')[0] : QC_LABEL[c]}
        </span>
      ))}
    </span>
  );
}

export function Section({ title, children, open = true }: { title: string; children: ReactNode; open?: boolean }) {
  return (
    <details className="section" open={open}>
      <summary>{title}</summary>
      <div className="section-body">{children}</div>
    </details>
  );
}

/** Opens one run in the detail pane of the Data analysis tab. */
export function useOpenRun() {
  const { setUi, update } = useApp();
  return useCallback(
    (id: string) => {
      setUi({ focusId: id });
      update((p) => ({ ...p, mainTab: 'analysis' }));
    },
    [setUi, update],
  );
}

export type RunChoice = 'auto' | 'include' | 'exclude';

/** Writes or removes the manual override of one run. Returns false if the user cancelled. */
export function useSetRunChoice() {
  const { update } = useApp();
  return useCallback(
    (id: string, choice: RunChoice): boolean => {
      let reason = '';
      if (choice !== 'auto') {
        const answer = window.prompt(choice === 'include' ? 'Keep this run anyway. Reason (optional):' : 'Exclude this run anyway. Reason (optional):', '');
        if (answer === null) return false;
        reason = answer.trim() || (choice === 'include' ? 'Kept after review' : 'Excluded after review');
      }
      update((p) => {
        const ro = { ...p.runOverrides };
        if (choice === 'auto') delete ro[id];
        else ro[id] = { action: choice, reason, at: new Date().toISOString() };
        return { ...p, runOverrides: ro };
      });
      return true;
    },
    [update],
  );
}

/** Orders "a | b | c" condition keys part by part, numerically where both parts are numbers (0.25 before 0.5). */
export function compareConditionKeys(a: string, b: string): number {
  const pa = a.split(' | ');
  const pb = b.split(' | ');
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? '';
    const y = pb[i] ?? '';
    const nx = Number(x);
    const ny = Number(y);
    const c = x !== '' && y !== '' && Number.isFinite(nx) && Number.isFinite(ny) ? nx - ny : x.localeCompare(y, undefined, { numeric: true });
    if (c !== 0) return c;
  }
  return 0;
}
