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
        <NumberField label="Gel width (mm)" value={d.widthMm} positive onCommit={(v) => v !== null && setD({ ...d, widthMm: v })} title="Width w: peel strength and peel energy are force / w" />
        <NumberField label="Gel thickness (mm)" value={d.thicknessMm} positive onCommit={(v) => v !== null && setD({ ...d, thicknessMm: v })} />
        <NumberField label="Peel angle (°)" value={d.angleDeg} positive onCommit={(v) => v !== null && setD({ ...d, angleDeg: v })} title="90 for a 90° peel; Γ = F/w · (1 − cos θ)" />
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
  const { filesByMode } = useApp();
  const { ps, runs, picked, pick, options, setPick, selectedIds, setPickedSelected } = usePeel();
  const off = new Set(ps.disabledFiles);
  const pickedFiles = new Set(picked.map((r) => r.file.fileId));
  const files = filesByMode.peel.filter((l) => !off.has(l.parsed.fileId) && pickedFiles.has(l.parsed.fileId));
  const names = uniqueFileNames(files.map((l) => l.parsed));
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
            hint="Every file of the chosen experiment is listed. Untick a file, or open it (▸) to untick single runs, to leave it out of the graph and results. Compare charge ratios uses the ticked runs of every experiment."
          />
        </section>
      )}
      {runs.length > 0 && <GelDimensions />}
    </nav>
  );
}
