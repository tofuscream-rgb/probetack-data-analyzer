import { useApp } from '../state/AppContext';
import { probeAreaMm2 } from '../plotting/axes';
import type { AnalysisSettings } from '../types';
import { NumberField } from './lapShear/NumberField';

/** Probe diameter and gel thickness for the nominal stress–strain curve (0 = not entered). */
export function ProbeFields({ compact = false }: { compact?: boolean }) {
  const { project, update } = useApp();
  const p = project.settings.probe;
  const set = (patch: Partial<AnalysisSettings['probe']>) => update((x) => ({ ...x, settings: { ...x.settings, probe: { ...x.settings.probe, ...patch } } }));
  const a = probeAreaMm2(project.settings);
  return (
    <>
      <NumberField
        compact={compact}
        label="Probe diameter d (mm)"
        title="Diameter of the flat probe; Amax = π (d/2)²"
        value={p.diameterMm > 0 ? p.diameterMm : null}
        positive
        allowEmpty
        placeholder="enter"
        onCommit={(v) => set({ diameterMm: v ?? 0 })}
      />
      <NumberField
        compact={compact}
        label="Gel thickness h₀ (mm)"
        title="Initial thickness of the gel layer; ε = Δh / h₀"
        value={p.thicknessMm > 0 ? p.thicknessMm : null}
        positive
        allowEmpty
        placeholder="enter"
        onCommit={(v) => set({ thicknessMm: v ?? 0 })}
      />
      {a !== null && <span className="note">Amax = {a.toFixed(a < 10 ? 3 : 2)} mm²</span>}
    </>
  );
}
