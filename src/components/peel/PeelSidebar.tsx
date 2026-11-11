import { useEffect, useState } from 'react';
import { useApp } from '../../state/AppContext';
import { usePeel } from '../../state/peel';
import { ImportStep } from '../Sidebar';
import { RunPicker } from '../RunPicker';
import { NumberField } from '../lapShear/NumberField';
import { fmt } from '../common';
import { uniqueFileNames } from '../../state/experiment';
import type { ExperimentPick } from '../../types';

type Dims = { lengthMm: number; widthMm: number; thicknessMm: number; angleDeg: number };

/** Gel dimensions box: shows the first selected run's values and applies edits to every selected run. */
function GelDimensions() {
  const { ps, selected, setMeta } = usePeel();
  const ids = selected.filter((r) => r.result.ok).map((r) => r.id);
  const first = selected[0]?.meta ?? ps.settings.defaults;
  const [d, setD] = useState<Dims>({ lengthMm: first.lengthMm, widthMm: first.widthMm, thicknessMm: first.thicknessMm, angleDeg: first.angleDeg });
  const firstKey = selected[0]?.id ?? '';
  useEffect(() => {
    setD({ lengthMm: first.lengthMm, widthMm: first.widthMm, thicknessMm: first.thicknessMm, angleDeg: first.angleDeg });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstKey, first.lengthMm, first.widthMm, first.thicknessMm, first.angleDeg]);
  const differ = selected.some((r) => r.meta.lengthMm !== first.lengthMm || r.meta.widthMm !== first.widthMm || r.meta.thicknessMm !== first.thicknessMm || r.meta.angleDeg !== first.angleDeg);
  return (
    <section className="step">
      <h2>4. Gel dimensions</h2>
      <div className="gel-dims">
        <NumberField label="Gel length (mm)" value={d.lengthMm} positive onCommit={(v) => v !== null && setD({ ...d, lengthMm: v })} title="Bonded length of the gel strip" />
        <NumberField label="Gel width (mm)" value={d.widthMm} positive onCommit={(v) => v !== null && setD({ ...d, widthMm: v })} title="Width w: peel energy G_peel = F̄/w · (1 − cos θ) (Kendall 1975; Creton & Ciccotti 2016)" />
        <NumberField label="Gel thickness (mm)" value={d.thicknessMm} positive onCommit={(v) => v !== null && setD({ ...d, thicknessMm: v })} />
        <NumberField label="Peel angle (°)" value={d.angleDeg} positive onCommit={(v) => v !== null && setD({ ...d, angleDeg: v })} title="90 for a 90° peel; θ enters G_peel = F̄/w · (1 − cos θ) (Kendall 1975)" />
      </div>
      <p className="hint">
        Bonded area {fmt(d.lengthMm * d.widthMm, 1)} mm². {differ ? 'The selected runs have different dimensions; Apply sets all of them to these values.' : ''}
      </p>
      <button className="primary browse" disabled={!ids.length} onClick={() => setMeta(ids, d)}>
        Apply to {ids.length} selected run(s)
      </button>
      <p className="hint">Each run keeps its own dimensions; change a single run in the Results tab. The force curve never changes.</p>
    </section>
  );
}

const ALL = '__all__';

/** Dropdown with an "All" choice; null = all. */
function PickSelect({ label, value, options, allLabel, onChange }: { label: string; value: string | null; options: { value: string; label: string }[]; allLabel: string; onChange: (v: string | null) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value ?? ALL} onChange={(e) => onChange(e.target.value === ALL ? null : e.target.value)}>
        <option value={ALL}>{allLabel}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

export function PeelSidebar() {
  const { filesByMode, meta } = useApp();
  const { ps, runs, picked, pick, options, setPick, selectedIds, setPickedSelected } = usePeel();
  const off = new Set(ps.disabledFiles);
  const pickedFiles = new Set(picked.map((r) => r.file.fileId));
  // In version order within a substrate: PET, PETv2 (or PET-2), PET v3, …
  const repeatOf = (id: string) => meta.get(id)?.repeat.value ?? 1;
  const files = filesByMode.peel
    .filter((l) => !off.has(l.parsed.fileId) && pickedFiles.has(l.parsed.fileId))
    .sort((a, b) => repeatOf(a.parsed.fileId) - repeatOf(b.parsed.fileId) || a.parsed.name.localeCompare(b.parsed.name, undefined, { numeric: true }));
  const names = uniqueFileNames(files.map((l) => l.parsed));
  // Group files by their conditions; only what differs between the shown files is named
  // (PET.txt, PETv2.txt, PET v3.txt → "PET"; with All charge ratios → "CR 0.25 · PET").
  const condOf = new Map(picked.map((r) => [r.file.fileId, r.cond]));
  const parts = (fileId: string) => {
    const c = condOf.get(fileId);
    if (!c) return ['', '', 'unknown'];
    return [c.chargeRatio === '—' ? 'CR unknown' : `CR ${c.chargeRatio}`, c.concentration === '—' ? '' : `${c.concentration} M`, c.substrate === '—' ? 'substrate unknown' : c.substrate.trim()];
  };
  const allParts = files.map((l) => parts(l.parsed.fileId));
  const varies = [0, 1].filter((k) => new Set(allParts.map((p) => p[k])).size > 1);
  const subName = new Map<string, string>();
  for (const p of allParts) if (!subName.has(p[2].toLowerCase())) subName.set(p[2].toLowerCase(), p[2]);
  const groupOf = (l: { parsed: { fileId: string } }) => {
    const p = parts(l.parsed.fileId);
    return [...varies.map((k) => p[k]), subName.get(p[2].toLowerCase()) ?? p[2]].filter(Boolean).join(' · ');
  };
  const choose = (patch: Partial<ExperimentPick>) => setPick(patch);
  const defaultConc = pick.concentration !== null && options.concentrations.find((o) => o.value === pick.concentration)?.label.includes('default');
  return (
    <nav className="sidebar" aria-label="Open 90° peel files and choose runs">
      <ImportStep />
      <section className="step">
        <h2>2. Choose your experiment</h2>
        {!runs.length ? (
          <p className="hint">
            Open your 90° peel TXT files first. Folder names such as <em>0.25 2.98M/glass/</em> or <em>glass/0.25/</em> give the charge ratio, concentration and
            substrate. Each <em>&lt;Scripts&gt;</em> or <em>&lt;Move&gt;</em> section with data is one run.
          </p>
        ) : (
          <>
            <PickSelect label="Charge ratio" value={pick.chargeRatio} options={options.chargeRatios} allLabel="All charge ratios" onChange={(v) => choose({ chargeRatio: v })} />
            <PickSelect label="Total monomer concentration" value={pick.concentration} options={options.concentrations} allLabel="All concentrations" onChange={(v) => choose({ concentration: v })} />
            <PickSelect label="Substrate" value={pick.substrate} options={options.substrates} allLabel="All substrates" onChange={(v) => choose({ substrate: v })} />
            <p className="hint">
              {files.length} file(s), {picked.length} run(s) in this choice. Choose <em>All</em> to put several charge ratios, concentrations or substrates on one graph.
            </p>
            {defaultConc && <p className="hint warn">No concentration was found in the folder names, so 2.1 M is assumed.</p>}
          </>
        )}
      </section>
      {runs.length > 0 && (
        <section className="step">
          <h2>3. Files and runs</h2>
          <RunPicker
            files={files}
            runs={picked.map((r) => ({ id: r.id, fileId: r.file.fileId, cycleNumber: r.cycle.cycleNumber, ok: r.result.ok, error: r.result.error, peakGf: r.result.peak?.forceGf ?? null }))}
            selectedIds={selectedIds}
            setSelected={setPickedSelected}
            nameOf={(l) => names.get(l.parsed.fileId) ?? l.parsed.name}
            groupOf={groupOf}
            hint="Files of the same substrate are grouped (PET, PETv2, PET v3 → PET). Tick a group to use all its files, or open it (▾) to tick files one by one, and open a file to tick single runs. Results summarise each group. Compare charge ratios uses the ticked runs of every experiment."
          />
        </section>
      )}
      {runs.length > 0 && <GelDimensions />}
    </nav>
  );
}
