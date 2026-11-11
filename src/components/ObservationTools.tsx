import { useState } from 'react';
import {
  FAILURE_MODES, GLOSSARY, REFERENCES, bulkPatches,
  type BulkRow, type Option,
} from '../analysis/observations';
import type { FailureMode } from '../types';

export interface SelectableRow extends BulkRow {
  repeatKey: string;
  repeatLabel: string;
  conditionKey: string;
  conditionLabel: string;
}

/** Run checkboxes and the "current" run (the last one clicked), for bulk assignment. */
export function useRunSelection(rows: SelectableRow[]) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [currentId, setCurrentId] = useState<string | null>(null);
  const valid = new Set(rows.map((r) => r.id));
  const sel = new Set([...selected].filter((id) => valid.has(id)));
  const current = rows.find((r) => r.id === currentId) ?? rows[0] ?? null;
  const toggle = (id: string, on: boolean) => {
    setCurrentId(id);
    setSelected((s) => {
      const n = new Set(s);
      if (on) n.add(id); else n.delete(id);
      return n;
    });
  };
  return { selected: sel, setSelected, current, setCurrentId, toggle };
}

/**
 * Bulk assignment bar: select runs (all visible, the current Repeat or condition), choose a
 * Failure mode and/or Debonding morphology, and apply. "Only fill blank fields" is on by default.
 */
export function BulkAssignBar<M extends string>({ rows, selection, morphologies, onApply }: {
  rows: SelectableRow[];
  selection: ReturnType<typeof useRunSelection>;
  morphologies: Option<M>[];
  onApply: (patches: { id: string; mode?: FailureMode; morphology?: M }[]) => void;
}) {
  const [mode, setMode] = useState<FailureMode | ''>('');
  const [morph, setMorph] = useState<M | ''>('');
  const [onlyBlank, setOnlyBlank] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const { selected, setSelected, current } = selection;
  const pick = (ids: string[]) => { setSelected(new Set(ids)); setMessage(null); };
  const apply = () => {
    const r = bulkPatches(rows, [...selected], mode || null, morph || null, onlyBlank);
    onApply(r.patches as { id: string; mode?: FailureMode; morphology?: M }[]);
    setMessage(`Updated ${r.patches.length} run(s)${r.skipped ? `; ${r.skipped} field(s) already filled were kept` : ''}.`);
  };
  return (
    <div className="bulk-bar" role="group" aria-label="Bulk assignment">
      <div className="bulk-row">
        <strong>Bulk assign</strong>
        <span>{selected.size} of {rows.length} run(s) selected</span>
        <span className="bulk-select">
          Select:
          <button className="link small" onClick={() => pick(rows.map((r) => r.id))}>All visible</button>
          <button className="link small" disabled={!current} title={current ? `Runs of ${current.repeatLabel}` : ''} onClick={() => current && pick(rows.filter((r) => r.repeatKey === current.repeatKey).map((r) => r.id))}>
            Current Repeat{current ? ` (${current.repeatLabel})` : ''}
          </button>
          <button className="link small" disabled={!current} title={current ? `Runs of ${current.conditionLabel}` : ''} onClick={() => current && pick(rows.filter((r) => r.conditionKey === current.conditionKey).map((r) => r.id))}>
            Current condition{current ? ` (${current.conditionLabel})` : ''}
          </button>
          <button className="link small" onClick={() => pick([])}>None</button>
        </span>
      </div>
      <div className="bulk-row">
        <label className="field inline">
          <span>Failure mode</span>
          <select value={mode} onChange={(e) => setMode(e.target.value as FailureMode | '')} aria-label="Bulk failure mode">
            <option value="">— no change —</option>
            {FAILURE_MODES.filter((o) => o.value !== 'unspecified').map((o) => <option key={o.value} value={o.value} title={o.title}>{o.label}</option>)}
            <option value="unspecified">Clear (blank)</option>
          </select>
        </label>
        <label className="field inline">
          <span>Debonding morphology</span>
          <select value={morph} onChange={(e) => setMorph(e.target.value as M | '')} aria-label="Bulk debonding morphology">
            <option value="">— no change —</option>
            {morphologies.filter((o) => o.value !== 'unspecified').map((o) => <option key={o.value} value={o.value} title={o.title}>{o.label}</option>)}
            <option value="unspecified">Clear (blank)</option>
          </select>
        </label>
        <label className="check" title="Keep fields that already have a value">
          <input type="checkbox" checked={onlyBlank} onChange={(e) => setOnlyBlank(e.target.checked)} /> Only fill blank fields
        </label>
        <button className="primary small" disabled={!selected.size || (!mode && !morph)} onClick={apply}>Apply</button>
        {message && <span className="note">{message}</span>}
      </div>
      <p className="note">The current Repeat/condition is that of the last run you ticked or clicked.</p>
    </div>
  );
}

/** Definitions & References for failure modes and debonding morphologies. */
export function ObservationGlossary({ test, title = 'Definitions & References', hideTitle = false }: { test: 'tack' | 'peel' | 'lapShear'; title?: string; hideTitle?: boolean }) {
  const terms = GLOSSARY.filter((g) => g.tests.includes(test));
  const used = REFERENCES.filter((r) => terms.some((g) => g.refs.includes(r.key)));
  const num = (key: string) => used.findIndex((r) => r.key === key) + 1;
  return (
    <section className="glossary" aria-label={title}>
      {!hideTitle && <h3 className="ls-h">{title}</h3>}
      <p className="note">
        Failure mode (where the separation runs) and debonding morphology (how it proceeds) are recorded separately from observation, never inferred from the force curve.
      </p>
      <div className="table-scroll">
        <table className="grid glossary-table">
          <thead><tr><th>Term</th><th>Field</th><th>Definition</th><th>Source</th></tr></thead>
          <tbody>
            {terms.map((g) => (
              <tr key={g.term}>
                <td className="strong">{g.term}</td>
                <td>{g.field}</td>
                <td>{g.definition}{g.note && <div className="note">{g.note}</div>}</td>
                <td>{g.refs.length ? g.refs.map(num).sort((x, y) => x - y).map((n) => `[${n}]`).join(' ') : g.kind === 'analyzer' ? 'This analyzer' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h4>References</h4>
      <ol className="citations">
        {used.map((r) => (
          <li key={r.key}>{r.citation} <a href={r.url} target="_blank" rel="noreferrer noopener">{r.linkText}</a></li>
        ))}
      </ol>
    </section>
  );
}
