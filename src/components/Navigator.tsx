import { useEffect, useMemo, useRef, useState } from 'react';
import { filterValue, useApp, useGraphActions, type FilterKey } from '../state/AppContext';
import type { CycleResult } from '../analysis/engine';
import { QC_COLORS } from '../plotting/colors';

const FILTERS: { key: FilterKey; label: string; unit?: string }[] = [
  { key: 'chargeRatio', label: 'Charge ratio' },
  { key: 'concentrationM', label: 'Concentration', unit: 'M' },
  { key: 'substrate', label: 'Substrate' },
  { key: 'holdTimeS', label: 'Holding time', unit: 's' },
  { key: 'repeat', label: 'Repeat' },
  { key: 'date', label: 'Test date' },
  { key: 'qc', label: 'Run QC' },
];

function TriCheck({ state, onChange, label }: { state: 'all' | 'some' | 'none'; onChange: () => void; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === 'some';
  }, [state]);
  return <input ref={ref} type="checkbox" checked={state === 'all'} onChange={onChange} aria-label={label} />;
}

interface FileNode {
  fileId: string;
  name: string;
  path: string;
  status: string;
  cycles: CycleResult[];
}
interface GroupNode {
  key: string;
  title: string;
  subtitle: string;
  files: FileNode[];
}

export function QcRibbon({ cycles }: { cycles: CycleResult[] }) {
  return (
    <span className="ribbon" aria-label="Run QC summary">
      {cycles.map((c) => (
        <i key={c.cycle.cycleId} style={{ background: c.cycleExcluded ? 'transparent' : QC_COLORS[c.qc], borderColor: QC_COLORS[c.qc] }} title={`Run ${c.cycle.cycleNumber}: ${c.qc}${c.cycleExcluded ? ' (excluded)' : ''}`} />
      ))}
    </span>
  );
}

export function Navigator() {
  const { derived, visible, ui, setUi, project, update, files, pending, importFiles, loadExample } = useApp();
  const { addToActive, newGraphWith, active } = useGraphActions();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const folderInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const zipInput = useRef<HTMLInputElement>(null);
  const selected = useMemo(() => new Set(project.selection), [project.selection]);

  const values = useMemo(() => {
    const out: Partial<Record<FilterKey, string[]>> = {};
    for (const f of FILTERS) {
      const set = new Set(derived.ordered.map((r) => filterValue(r, f.key)));
      out[f.key] = [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    }
    return out;
  }, [derived]);

  const tree = useMemo(() => {
    const groups = new Map<string, GroupNode>();
    for (const r of visible) {
      const m = r.meta;
      const key = `${m.concentrationM.value}|${m.chargeRatio.value}|${m.substrate.value}`;
      let g = groups.get(key);
      if (!g) {
        g = {
          key,
          title: `${m.chargeRatio.value !== null ? `Charge ratio ${m.chargeRatio.value}` : 'Charge ratio unknown'}, ${m.concentrationM.value} M${m.concentrationM.source === 'default' ? '*' : ''}`,
          subtitle: m.substrate.value ?? 'substrate unknown',
          files: [],
        };
        groups.set(key, g);
      }
      let f = g.files.find((x) => x.fileId === r.file.fileId);
      if (!f) {
        f = { fileId: r.file.fileId, name: r.file.name, path: r.file.path, status: r.file.status, cycles: [] };
        g.files.push(f);
      }
      f.cycles.push(r);
    }
    return [...groups.values()];
  }, [visible]);

  const emptyFiles = files.filter((l) => l.cycles.length === 0);

  const setSel = (ids: string[], on: boolean) =>
    update((p) => {
      const s = new Set(p.selection);
      ids.forEach((id) => (on ? s.add(id) : s.delete(id)));
      return { ...p, selection: [...s] };
    });
  const stateOf = (ids: string[]): 'all' | 'some' | 'none' => {
    const n = ids.filter((id) => selected.has(id)).length;
    return n === 0 ? 'none' : n === ids.length ? 'all' : 'some';
  };
  const toggleFilter = (k: FilterKey, v: string) =>
    setUi((u) => {
      const cur = u.filters[k] ?? [];
      return { filters: { ...u.filters, [k]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] } };
    });
  const activeFilters = Object.values(ui.filters).reduce((n, v) => n + (v?.length ?? 0), 0);

  return (
    <nav className="navigator" aria-label="Experiment navigator">
      <div className="nav-import">
        <button className="primary" onClick={() => folderInput.current?.click()}>
          Open folder
        </button>
        <button onClick={() => fileInput.current?.click()}>TXT files</button>
        <button onClick={() => zipInput.current?.click()}>ZIP archive</button>
        <input
          ref={folderInput}
          type="file"
          hidden
          multiple
          {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
          onChange={(e) => {
            if (e.target.files) importFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <input ref={fileInput} type="file" hidden multiple accept=".txt,text/plain" onChange={(e) => { if (e.target.files) importFiles(e.target.files); e.target.value = ''; }} />
        <input ref={zipInput} type="file" hidden accept=".zip,application/zip" onChange={(e) => { if (e.target.files) importFiles(e.target.files); e.target.value = ''; }} />
        <p className="hint">Files are read on this computer only. You can also drag a folder onto the page.</p>
      </div>

      {pending.length > 0 && (
        <div className="banner warn">
          <strong>{pending.length} project file(s) not connected.</strong> Select the original folder or files; they are matched by content (SHA-256), so moved files are found too.
        </div>
      )}

      {derived.ordered.length === 0 && pending.length === 0 && (
        <div className="nav-empty">
          <p>Start by opening the folder that holds your Mach-1 TXT files. Sub-folders such as <em>0.25/Glass/</em> are read as charge ratio and substrate.</p>
          <button className="link" onClick={loadExample}>
            Try it with synthetic example data
          </button>
        </div>
      )}

      {derived.ordered.length > 0 && (
        <>
          <div className="nav-search">
            <input type="search" placeholder="Search file or path" value={ui.search} onChange={(e) => setUi({ search: e.target.value })} aria-label="Search" />
          </div>
          <details className="filters" open>
            <summary>
              Filters {activeFilters > 0 && <span className="count">{activeFilters}</span>}
              {activeFilters > 0 && (
                <button className="link small" onClick={(e) => { e.preventDefault(); setUi({ filters: {}, search: '' }); }}>
                  Reset filters
                </button>
              )}
            </summary>
            {FILTERS.map((f) => {
              const vals = values[f.key] ?? [];
              if (vals.length < 2 && !(ui.filters[f.key]?.length)) return null;
              return (
                <div key={f.key} className="filter-row">
                  <span className="filter-label">{f.label}</span>
                  <div className="chips">
                    {vals.map((v) => (
                      <button key={v} className={`chip ${ui.filters[f.key]?.includes(v) ? 'on' : ''} ${f.key === 'qc' ? `qc-${v}` : ''}`} onClick={() => toggleFilter(f.key, v)} aria-pressed={!!ui.filters[f.key]?.includes(v)}>
                        {v}
                        {f.unit && v !== '—' ? ` ${f.unit}` : ''}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </details>

          <div className="sel-bar">
            <span>
              {project.selection.length} selected of {visible.length} shown
            </span>
            <button className="small" disabled={!project.selection.length} onClick={() => addToActive(project.selection)} title={`Add to “${active.title}”`}>
              Add to graph
            </button>
            <button className="small" disabled={!project.selection.length} onClick={() => newGraphWith(project.selection)}>
              New graph
            </button>
            <button className="link small" disabled={!project.selection.length} onClick={() => update((p) => ({ ...p, selection: [] }))}>
              Clear
            </button>
          </div>

          <div className="tree" role="tree">
            <label className="tree-all">
              <TriCheck state={stateOf(visible.map((r) => r.cycle.cycleId))} label="Select all shown" onChange={() => { const ids = visible.map((r) => r.cycle.cycleId); setSel(ids, stateOf(ids) !== 'all'); }} />
              Select all shown
            </label>
            {tree.map((g) => {
              const gIds = g.files.flatMap((f) => f.cycles.map((c) => c.cycle.cycleId));
              return (
                <div key={g.key} className="tree-group" role="treeitem" aria-expanded="true">
                  <div className="tree-group-head">
                    <TriCheck state={stateOf(gIds)} label={`Select ${g.title}`} onChange={() => setSel(gIds, stateOf(gIds) !== 'all')} />
                    <div>
                      <div className="tg-title">{g.title}</div>
                      <div className="tg-sub">{g.subtitle}</div>
                    </div>
                  </div>
                  {g.files.map((f) => {
                    const ids = f.cycles.map((c) => c.cycle.cycleId);
                    const isOpen = open[f.fileId] ?? false;
                    return (
                      <div key={f.fileId} className="tree-file">
                        <div className="tf-head">
                          <TriCheck state={stateOf(ids)} label={`Select ${f.name}`} onChange={() => setSel(ids, stateOf(ids) !== 'all')} />
                          <button className="disclose" aria-expanded={isOpen} onClick={() => setOpen((o) => ({ ...o, [f.fileId]: !isOpen }))}>
                            {isOpen ? '▾' : '▸'} {f.name}
                          </button>
                          {f.status !== 'ok' && <span className={`status ${f.status}`} title="See Import status">!</span>}
                          <QcRibbon cycles={f.cycles} />
                        </div>
                        {isOpen && (
                          <ul className="tf-cycles">
                            {f.cycles.map((c) => (
                              <li key={c.cycle.cycleId} className={ui.focusId === c.cycle.cycleId ? 'focus' : ''}>
                                <input type="checkbox" checked={selected.has(c.cycle.cycleId)} onChange={(e) => setSel([c.cycle.cycleId], e.target.checked)} aria-label={`Select run ${c.cycle.cycleNumber}`} />
                                <button className="link" onClick={() => setUi({ focusId: c.cycle.cycleId, rightTab: 'cycle' })}>
                                  Run {c.cycle.cycleNumber}
                                </button>
                                <span className="num">{Number.isFinite(c.peakProcessed) ? c.peakProcessed.toFixed(1) : '—'} gf</span>
                                <span className={`qc-dot ${c.qc}`} title={c.qc} />
                                {c.cycleExcluded && <span className="tag">excluded</span>}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
            {emptyFiles.length > 0 && (
              <div className="tree-group muted">
                <div className="tg-title">Files without runs</div>
                {emptyFiles.map((l) => (
                  <div key={l.parsed.fileId} className="tf-head">
                    <span className={`status ${l.parsed.status}`}>!</span> {l.parsed.path}
                  </div>
                ))}
              </div>
            )}
          </div>
          <p className="hint">* concentration is the default 2.1 M, not read from the folder name. Correct it under Metadata.</p>
        </>
      )}
    </nav>
  );
}
