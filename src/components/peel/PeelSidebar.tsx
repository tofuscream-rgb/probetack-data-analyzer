import { useEffect, useState } from 'react';
import { useApp } from '../../state/AppContext';
import { usePeel } from '../../state/peel';
import { ImportStep } from '../Sidebar';
import { groupedRunFiles, RunPicker } from '../RunPicker';
import { NumberField } from '../lapShear/NumberField';
import { fmt } from '../common';
import { ExperimentPicker } from '../ExperimentPicker';

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
      <p className="hint">Each run keeps its own dimensions; change a single run in the Peel metrics tab. The force curve never changes.</p>
    </section>
  );
}

export function PeelSidebar() {
  const { filesByMode, meta } = useApp();
  const { runs, picked, pick, options, setPick, selectedIds, setPickedSelected } = usePeel();
  const { files, names, groupOf } = groupedRunFiles(filesByMode.peel, picked, meta);
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
            <ExperimentPicker pick={pick} options={options} setPick={setPick} />
            <p className="hint">
              {files.length} file(s), {picked.length} run(s) in this choice. Choose <em>All</em> to put several conditions on one graph.
            </p>
          </>
        )}
      </section>
      {runs.length > 0 && (
        <section className="step">
          <h2>3. Runs on the graph</h2>
          <RunPicker
            files={files}
            runs={picked.map((r) => ({ id: r.id, fileId: r.file.fileId, cycleNumber: r.cycle.cycleNumber, ok: r.result.ok, error: r.result.error, peakGf: r.result.peak?.forceGf ?? null }))}
            selectedIds={selectedIds}
            setSelected={setPickedSelected}
            nameOf={(l) => names.get(l.parsed.fileId) ?? l.parsed.name}
            groupOf={groupOf}
            hint="Repeat files of one condition are grouped (PET, PETv2, PET v3 → PET). Tick a group or open it (▾) to tick files, and open a file to tick single runs. Unticking only removes a run from the graph; to leave it out of the averages, untick In average in Data analysis."
          />
        </section>
      )}
      {runs.length > 0 && <GelDimensions />}
    </nav>
  );
}
