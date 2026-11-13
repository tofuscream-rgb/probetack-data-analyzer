import type { ReactNode } from 'react';
import { download } from '../state/AppContext';
import { describe } from '../analysis/lapShear';
import { fmt } from './common';

/** Numbered, collapsible section of a metrics tab (open by default). */
export function Section({ n, title, children, extra, open = true, id }: { n: number; title: string; children: ReactNode; extra?: ReactNode; open?: boolean; id?: string }) {
  return (
    <details className="section tack-section" open={open} id={id}>
      <summary>{n}. {title}{extra}</summary>
      <div className="section-body">{children}</div>
    </details>
  );
}

/** "Expand all sections / Collapse all" for the sections inside the nearest `.metrics-tab`. */
export function SectionToggles() {
  const all = (e: { currentTarget: HTMLElement }, open: boolean) =>
    e.currentTarget.closest('.metrics-tab')?.querySelectorAll<HTMLDetailsElement>(':scope > details.section').forEach((d) => (d.open = open));
  return (
    <div className="table-actions section-toggles">
      <button className="link small" onClick={(e) => all(e, true)}>Expand all sections</button>
      <button className="link small" onClick={(e) => all(e, false)}>Collapse all</button>
    </div>
  );
}

const csvCell = (v: unknown) => {
  if (v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v))) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
/** Download rows as a UTF-8 CSV file (with BOM, so Excel reads µ, ², ± correctly). */
export const saveCsv = (rows: unknown[][], name: string) =>
  download(new Blob(['﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' }), name);

export interface SummaryProperty { key: string; label: string; unit: string; digits: number }
export interface SummaryRun {
  id: string;
  fileId: string;
  fileName: string;
  path: string;
  /** Data analysis condition (substrate × charge ratio × concentration × gel × dwell). */
  condKey: string;
  condTitle: string;
  included: boolean;
  values: Record<string, number>;
}

const ms = (v: number[], d: number) => {
  const s = describe(v);
  return s.n ? `${fmt(s.mean, d)} ± ${s.n > 1 ? fmt(s.sd, d) : '—'} (n = ${s.n})` : '—';
};

/** Repeats (files) grouped by condition; each repeat's mean over its runs, included runs only or all. */
export function summarize(runs: SummaryRun[], props: SummaryProperty[]) {
  const byFile = new Map<string, SummaryRun[]>();
  for (const r of runs) byFile.set(r.fileId, [...(byFile.get(r.fileId) ?? []), r]);
  const repeats = [...byFile.values()].map((list) => {
    const used = list.filter((r) => r.included);
    const meanOf = (rs: SummaryRun[], k: string) => describe(rs.map((r) => r.values[k])).mean;
    return {
      fileId: list[0].fileId, name: list[0].fileName, path: list[0].path, condKey: list[0].condKey, condTitle: list[0].condTitle, runs: list, used,
      after: Object.fromEntries(props.map((p) => [p.key, meanOf(used, p.key)])) as Record<string, number>,
      before: Object.fromEntries(props.map((p) => [p.key, meanOf(list, p.key)])) as Record<string, number>,
    };
  });
  const conditions = [...new Set(repeats.map((r) => r.condKey))].map((key) => {
    const reps = repeats.filter((r) => r.condKey === key);
    return { key, title: reps[0].condTitle, reps, used: reps.filter((r) => r.used.length > 0) };
  });
  return { repeats, conditions };
}

/** Mean ± SD after review (bold) and over all valid runs (grey), as in Tack metrics. */
function Both({ after, before, d }: { after: number[]; before: number[]; d: number }) {
  return (
    <>
      <div title="Included runs after review">{ms(after, d)}</div>
      <div className="note before" title="All valid runs">all: {ms(before, d)}</div>
    </>
  );
}

/** Sections "Mean ± SD per Repeat" and "per condition", after review with all valid runs below. */
export function ReviewSummaries({ runs, props, first }: { runs: SummaryRun[]; props: SummaryProperty[]; first: number }) {
  const { repeats, conditions } = summarize(runs, props);
  return (
    <>
      <Section n={first} title="Mean ± SD per Repeat (included runs after review; all valid runs below)">
        <div className="table-scroll">
          <table className="grid ls-summary">
            <thead><tr><th>Repeat/file</th><th>Condition</th><th className="num" title="Included runs / all valid runs">Runs</th>{props.map((p) => <th key={p.key}>{p.label}<br /><small>({p.unit})</small></th>)}</tr></thead>
            <tbody>
              {repeats.map((rp) => (
                <tr key={rp.fileId} className={rp.used.length ? '' : 'excluded'}>
                  <td title={rp.path}>{rp.name}</td><td>{rp.condTitle}</td><td className="num">{rp.used.length} / {rp.runs.length}</td>
                  {props.map((p) => <td key={p.key} className="num"><Both after={rp.used.map((r) => r.values[p.key])} before={rp.runs.map((r) => r.values[p.key])} d={p.digits} /></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      <Section n={first + 1} title="Mean ± SD per condition (over Repeat means; all valid runs below)">
        <div className="table-scroll">
          <table className="grid ls-summary">
            <thead><tr><th>Condition</th><th className="num" title="Repeats with included runs / all Repeats">Repeats</th><th className="num" title="Included runs / all valid runs">Runs</th>{props.map((p) => <th key={p.key}>{p.label}<br /><small>({p.unit})</small></th>)}</tr></thead>
            <tbody>
              {conditions.map((c) => (
                <tr key={c.key}>
                  <td className="strong">{c.title}</td><td className="num">{c.used.length} / {c.reps.length}</td>
                  <td className="num">{c.reps.reduce((n, r) => n + r.used.length, 0)} / {c.reps.reduce((n, r) => n + r.runs.length, 0)}</td>
                  {props.map((p) => <td key={p.key} className="num"><Both after={c.used.map((r) => r.after[p.key])} before={c.reps.map((r) => r.before[p.key])} d={p.digits} /></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="note">Each file/Repeat counts once at condition level. Leave a run out with <em>In average</em> (here or in Data analysis).</p>
      </Section>
    </>
  );
}

/** CSV of the Repeat and condition summaries (after review and all valid runs). */
export function summaryCsv(runs: SummaryRun[], props: SummaryProperty[]): unknown[][] {
  const { repeats, conditions } = summarize(runs, props);
  const cols = (prefix: string) => props.flatMap((p) => [`${p.label} mean${prefix} (${p.unit})`, `${p.label} SD${prefix} (${p.unit})`]);
  const stats = (v: number[]) => { const s = describe(v); return [s.mean, s.n > 1 ? s.sd : null]; };
  return [
    ['Mean ± SD per Repeat over its runs: included runs after review, then all valid runs'],
    ['Repeat (file)', 'Path', 'Condition', 'Runs included', 'Runs (all)', ...cols(''), ...cols(', all runs')],
    ...repeats.map((rp) => [rp.name, rp.path, rp.condTitle, rp.used.length, rp.runs.length, ...props.flatMap((p) => stats(rp.used.map((r) => r.values[p.key]))), ...props.flatMap((p) => stats(rp.runs.map((r) => r.values[p.key])))]),
    [],
    ['Mean ± SD per condition over the Repeat means: after review, then all valid runs'],
    ['Condition', 'Repeats included', 'Repeats (all)', ...cols(''), ...cols(', all runs')],
    ...conditions.map((c) => [c.title, c.used.length, c.reps.length, ...props.flatMap((p) => stats(c.used.map((r) => r.after[p.key]))), ...props.flatMap((p) => stats(c.reps.map((r) => r.before[p.key])))]),
  ];
}
