import { usePeel } from '../../state/peel';
import { INTEGRATION_LABEL } from '../../analysis/lapShear';
import { defaultPeel } from '../../state/defaults';
import type { IntegrationMode, PeelSettings as Settings } from '../../types';
import { Section } from '../common';
import { NumberField } from '../lapShear/NumberField';

export function PeelSettings() {
  const { ps, setSettings, set } = usePeel();
  const s = ps.settings;
  const sub = <K extends keyof Settings>(k: K, patch: Partial<Settings[K]>) => setSettings({ [k]: { ...(s[k] as object), ...patch } } as Partial<Settings>);
  return (
    <div className="settings-panel">
      <div className="settings-grid">
        <Section title="Steady-state (plateau) window">
          <label className="field">
            <span>Window</span>
            <select value={s.plateau.mode} onChange={(e) => sub('plateau', { mode: e.target.value as 'auto' | 'custom' })}>
              <option value="auto">Fraction of each run's peeled length</option>
              <option value="custom">Custom displacement range</option>
            </select>
          </label>
          {s.plateau.mode === 'auto' ? (
            <div className="pair">
              <NumberField label="From (% of peeled length)" value={+(s.plateau.startFrac * 100).toFixed(4)} min={0} onCommit={(v) => v !== null && sub('plateau', { startFrac: Math.min(v, 100) / 100 })} />
              <NumberField label="To (% of peeled length)" value={+(s.plateau.endFrac * 100).toFixed(4)} min={0} onCommit={(v) => v !== null && sub('plateau', { endFrac: Math.min(v, 100) / 100 })} />
            </div>
          ) : (
            <div className="pair">
              <NumberField label="From (mm)" value={s.plateau.fromMm} min={0} onCommit={(v) => v !== null && sub('plateau', { fromMm: v })} />
              <NumberField label="To (mm)" value={s.plateau.toMm} min={0} onCommit={(v) => v !== null && sub('plateau', { toMm: v })} />
            </div>
          )}
          <p className="note">
            The average peel force is taken where peeling is steady, leaving out the initiation peak and the final release. Standards use a fixed length
            (ASTM D6862: disregard the first 25 mm and average at least 76 mm); for short gel strips a fraction of the peeled length (default 20–80%) keeps the
            same idea. State the window when you report results.
          </p>
        </Section>
        <Section title="Detachment (end of peeling)">
          <label className="check-row"><input type="checkbox" checked={s.detach.auto} onChange={(e) => sub('detach', { auto: e.target.checked })} /> Detect detachment automatically</label>
          <div className="pair">
            <NumberField label="Below this % of the peak" value={+(s.detach.fraction * 100).toFixed(4)} positive onCommit={(v) => v !== null && sub('detach', { fraction: v / 100 })} />
            <NumberField label="for this many consecutive points" value={s.detach.consecutive} positive onCommit={(v) => v !== null && sub('detach', { consecutive: Math.round(v) })} />
          </div>
          <p className="note">Sets the peeled length (for the automatic window and the work per peeled area). If no detachment is found, the end of the recording is used and the run says so.</p>
        </Section>
        <Section title="Work">
          <label className="field">
            <span>Selected integration</span>
            <select value={s.integration.mode} onChange={(e) => sub('integration', { mode: e.target.value as IntegrationMode })}>
              {(Object.keys(INTEGRATION_LABEL) as IntegrationMode[]).map((k) => <option key={k} value={k}>{INTEGRATION_LABEL[k]}</option>)}
            </select>
          </label>
          {s.integration.mode === 'custom' && (
            <div className="pair">
              <NumberField label="From (mm)" value={s.integration.fromMm} min={0} onCommit={(v) => v !== null && sub('integration', { fromMm: v })} />
              <NumberField label="To (mm)" value={s.integration.toMm} min={0} onCommit={(v) => v !== null && sub('integration', { toMm: v })} />
            </div>
          )}
          <NumberField label="Treat a time step longer than … × the median as a gap" value={s.gapFactor} positive onCommit={(v) => v !== null && setSettings({ gapFactor: v })} />
        </Section>
        <Section title="Force">
          <label className="check-row"><input type="checkbox" checked={s.baseline.enabled} onChange={(e) => sub('baseline', { enabled: e.target.checked })} /> Apply zero-force baseline correction</label>
          <div className="pair">
            <NumberField label="Points at the start" value={s.baseline.points} positive onCommit={(v) => v !== null && sub('baseline', { points: Math.round(v) })} />
            <NumberField label="Max. force spread allowed (gf)" value={s.baseline.maxSpreadGf} positive onCommit={(v) => v !== null && sub('baseline', { maxSpreadGf: v })} />
          </div>
          <label className="field">
            <span>Loading direction</span>
            <select value={s.direction} onChange={(e) => setSettings({ direction: e.target.value as Settings['direction'] })}>
              <option value="auto">Detect from the data (recommended)</option>
              <option value="negative">Negative recorded force is loading</option>
              <option value="positive">Positive recorded force is loading</option>
            </select>
          </label>
          <p className="note">Peel force is shown as a positive magnitude; the original signed values are kept and exported. 1 gf = 0.00980665 N.</p>
        </Section>
        <Section title="Default gel dimensions">
          <div className="pair">
            <NumberField label="Gel length (mm)" value={s.defaults.lengthMm} positive onCommit={(v) => v !== null && sub('defaults', { lengthMm: v })} />
            <NumberField label="Gel width (mm)" value={s.defaults.widthMm} positive onCommit={(v) => v !== null && sub('defaults', { widthMm: v })} />
            <NumberField label="Gel thickness (mm)" value={s.defaults.thicknessMm} positive onCommit={(v) => v !== null && sub('defaults', { thicknessMm: v })} />
            <NumberField label="Peel angle (°)" value={s.defaults.angleDeg} positive onCommit={(v) => v !== null && sub('defaults', { angleDeg: v })} />
          </div>
          <p className="note">Used for runs whose dimensions you have not set.</p>
        </Section>
      </div>
      <button className="link" onClick={() => set({ settings: defaultPeel().settings })}>Reset 90° peel settings to defaults</button>
    </div>
  );
}
