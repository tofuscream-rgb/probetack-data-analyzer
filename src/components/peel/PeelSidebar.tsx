import { useEffect, useState } from 'react';
import { useApp } from '../../state/AppContext';
import { usePeel } from '../../state/peel';
import { ImportStep } from '../Sidebar';
import { RunPicker } from '../RunPicker';
import { NumberField } from '../lapShear/NumberField';
import { fmt } from '../common';

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
      <h2>3. Gel dimensions</h2>
      <div className="gel-dims">
        <NumberField label="Gel length (mm)" value={d.lengthMm} positive onCommit={(v) => v !== null && setD({ ...d, lengthMm: v })} title="Bonded length of the gel strip" />
        <NumberField label="Gel width (mm)" value={d.widthMm} positive onCommit={(v) => v !== null && setD({ ...d, widthMm: v })} title="Width w: peel strength and toughness are force / w" />
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

export function PeelSidebar() {
  const { filesByMode } = useApp();
  const { ps, runs, selectedIds, setSelected } = usePeel();
  const off = new Set(ps.disabledFiles);
  return (
    <nav className="sidebar" aria-label="Open 90° peel files and choose runs">
      <ImportStep />
      <section className="step">
        <h2>2. Choose files and runs to analyse</h2>
        {!runs.length ? (
          <p className="hint">
            Open your 90° peel TXT files first. Each <em>&lt;Scripts&gt;</em> or <em>&lt;Move&gt;</em> section with data is one run.
          </p>
        ) : (
          <RunPicker
            files={filesByMode.peel.filter((l) => !off.has(l.parsed.fileId))}
            runs={runs.map((r) => ({ id: r.id, fileId: r.file.fileId, cycleNumber: r.cycle.cycleNumber, ok: r.result.ok, error: r.result.error, peakGf: r.result.peak?.forceGf ?? null }))}
            selectedIds={selectedIds}
            setSelected={setSelected}
            hint="Tick any number of files (all their runs) or open a file (▸) to tick single runs. Ticked runs are drawn on the graph, listed in the results and used in Compare."
          />
        )}
      </section>
      {runs.length > 0 && <GelDimensions />}
    </nav>
  );
}
