import { useLapShear } from '../../state/lapShear';
import { defaultLapShear } from '../../state/defaults';
import type { LapShearSettings as Settings } from '../../types';
import { Section } from '../common';
import { NumberField } from './NumberField';

export function LapShearSettings() {
  const { ls, setSettings, set } = useLapShear();
  const s = ls.settings;
  const sub = <K extends keyof Settings>(k: K, patch: Partial<Settings[K]>) => setSettings({ [k]: { ...(s[k] as object), ...patch } } as Partial<Settings>);
  return (
    <div className="settings-panel">
      <div className="settings-grid">
        <Section title="Work / integration">
          <p className="note">The Lap Shear metrics tab reports apparent work to failure per bonded area. Use the Graph tab to choose an integration interval for shading and Excel diagnostics.</p>
          <NumberField label="Treat a time step longer than … × the median step as a gap" value={s.gapFactor} positive onCommit={(v) => v !== null && setSettings({ gapFactor: v })} />
        </Section>

        <Section title="Complete failure">
          <label className="check-row">
            <input type="checkbox" checked={s.failure.auto} onChange={(e) => sub('failure', { auto: e.target.checked })} /> Detect complete failure automatically
          </label>
          <div className="pair">
            <NumberField label="Below this % of the peak" value={+(s.failure.fraction * 100).toFixed(4)} positive onCommit={(v) => v !== null && sub('failure', { fraction: v / 100 })} />
            <NumberField label="for this many consecutive points" value={s.failure.consecutive} positive onCommit={(v) => v !== null && sub('failure', { consecutive: Math.round(v) })} />
          </div>
          <p className="note">
            Searched only after the peak. If the force never stays below the threshold (for example because of frictional sliding), the failure
            displacement is left blank. The end of machine travel is never taken as separation. A value typed in the Lap Shear metrics tab always wins.
          </p>
        </Section>

        <Section title="Force">
          <label className="check-row">
            <input type="checkbox" checked={s.baseline.enabled} onChange={(e) => sub('baseline', { enabled: e.target.checked })} /> Apply zero-force baseline correction
          </label>
          <div className="pair">
            <NumberField label="Points at the start" value={s.baseline.points} positive onCommit={(v) => v !== null && sub('baseline', { points: Math.round(v) })} />
            <NumberField label="Max. force spread allowed (gf)" value={s.baseline.maxSpreadGf} positive onCommit={(v) => v !== null && sub('baseline', { maxSpreadGf: v })} />
          </div>
          <p className="note">
            Off by default. When on, the median force of the first points is subtracted only if they look unloaded (spread within the limit and small
            compared with the largest force); otherwise no correction is applied and the run says why. Raw data are never changed.
          </p>
          <label className="field">
            <span>Loading direction</span>
            <select value={s.direction} onChange={(e) => setSettings({ direction: e.target.value as Settings['direction'] })}>
              <option value="auto">Detect from the data (recommended)</option>
              <option value="negative">Negative recorded force is loading</option>
              <option value="positive">Positive recorded force is loading</option>
            </select>
          </label>
          <p className="note">The loading force is shown as a positive magnitude; the original signed values are kept and exported. 1 gf = 0.00980665 N.</p>
        </Section>

        <Section title="Default specimen dimensions">
          <div className="pair three">
            <NumberField label="Overlap length (mm)" value={s.defaults.lengthMm} positive onCommit={(v) => v !== null && sub('defaults', { lengthMm: v })} />
            <NumberField label="Overlap width (mm)" value={s.defaults.widthMm} positive onCommit={(v) => v !== null && sub('defaults', { widthMm: v })} />
            <NumberField label="Gel thickness (mm)" value={s.defaults.thicknessMm} positive onCommit={(v) => v !== null && sub('defaults', { thicknessMm: v })} />
          </div>
          <p className="note">Used for runs whose dimensions you have not edited. Each run's own dimensions are set in the Lap Shear metrics tab.</p>
        </Section>
      </div>
      <button className="link" onClick={() => set({ settings: defaultLapShear().settings })}>Reset lap-shear settings to defaults</button>
    </div>
  );
}
