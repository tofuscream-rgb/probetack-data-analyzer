import { useApp } from '../state/AppContext';
import { GROUP_LABEL } from '../analysis/engine';
import { DISPLACEMENT_LABEL, PEAK_LABEL } from '../analysis/cycleMetrics';
import { QC_LABEL } from '../analysis/pointOutliers';
import type { AnalysisSettings, GroupKey, PeakMetric, QCClass } from '../types';
import { defaultSettings } from '../state/defaults';
import { Section } from './common';

function Num({ label, value, onChange, step = 0.1, min, max, help }: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; help?: string }) {
  return (
    <label className="field" title={help}>
      <span>{label}</span>
      <input type="number" value={value} step={step} min={min} max={max} onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) onChange(v); }} />
    </label>
  );
}

const COMPARE_KEYS: GroupKey[] = ['chargeRatio', 'concentrationM', 'substrate', 'holdTimeS', 'amplitudeMm', 'velocityMmS'];
const AUTO_CLASSES: QCClass[] = ['red', 'orange', 'yellow'];

export function SettingsPanel() {
  const { project, update } = useApp();
  const s = project.settings;
  const set = (patch: Partial<AnalysisSettings>) => update((p) => ({ ...p, settings: { ...p.settings, ...patch } }));
  const setP = (patch: Partial<AnalysisSettings['point']>) => set({ point: { ...s.point, ...patch } });
  const setC = (patch: Partial<AnalysisSettings['cycle']>) => set({ cycle: { ...s.cycle, ...patch } });
  const toggleClass = (c: QCClass, on: boolean) => {
    const cur = s.runExclusion.excludeClasses.filter((x) => x !== c);
    set({ runExclusion: { excludeClasses: on ? [...cur, c] : cur } });
  };
  return (
    <div className="settings-panel">
      <div className="settings-grid">
        <Section title="Outliers">
          {AUTO_CLASSES.map((c) => (
            <label key={c} className="check-row">
              <input type="checkbox" checked={s.runExclusion.excludeClasses.includes(c)} onChange={(e) => toggleClass(c, e.target.checked)} />
              <span className={`qc-dot ${c}`} /> Leave {c} runs out of the averages <small>({QC_LABEL[c]})</small>
            </label>
          ))}
          <p className="note">
            These runs stay highlighted but are left out of the “without outliers” averages; the “all runs” averages always use every run. Your own
            choice in the Data analysis tab (the In average tick box) always wins over these rules. Flags themselves never depend on this setting.
          </p>
        </Section>

        <Section title="How outliers are detected" open={false}>
          <p className="note">Runs are compared with other runs that share these conditions:</p>
          <div className="chips">
            {COMPARE_KEYS.map((k) => (
              <button key={k} className={`chip ${s.cycle.compareBy.includes(k) ? 'on' : ''}`} onClick={() => setC({ compareBy: s.cycle.compareBy.includes(k) ? s.cycle.compareBy.filter((x) => x !== k) : [...s.cycle.compareBy, k] })}>
                {GROUP_LABEL[k]}
              </button>
            ))}
          </div>
          <div className="pair three">
            <Num label="|mod. Z| yellow" value={s.cycle.modZYellow} step={0.5} onChange={(v) => setC({ modZYellow: v })} />
            <Num label="orange" value={s.cycle.modZOrange} step={0.5} onChange={(v) => setC({ modZOrange: v })} />
            <Num label="red" value={s.cycle.modZRed} step={0.5} onChange={(v) => setC({ modZRed: v })} />
          </div>
          <div className="pair">
            <Num label="Min. runs for mod. Z" value={s.cycle.minGroupSize} step={1} min={3} onChange={(v) => setC({ minGroupSize: Math.round(v) })} />
            <Num label="Weak if below (fraction)" value={s.cycle.weakFraction} step={0.05} min={0} max={1} onChange={(v) => setC({ weakFraction: v })} />
          </div>
          <div className="pair">
            <Num label="Missing peak (steps)" value={s.cycle.noPeakSteps} step={1} min={0} onChange={(v) => setC({ noPeakSteps: v })} />
            <Num label="Repeat difference" value={s.cycle.repeatDiffFraction} step={0.05} min={0} onChange={(v) => setC({ repeatDiffFraction: v })} />
          </div>
          <Num label="Start-position difference (mm, 0 = off)" value={s.cycle.startOffsetMm} step={0.1} min={0} onChange={(v) => setC({ startOffsetMm: v })} />
          <Num label="Incomplete if travel below (fraction)" value={s.cycle.completeFraction} step={0.01} min={0} max={1} onChange={(v) => setC({ completeFraction: v })} />
        </Section>

        <Section title="Force and displacement" open={false}>
          <label className="field">
            <span>Peak metric</span>
            <select value={s.peakMetric} onChange={(e) => set({ peakMetric: e.target.value as PeakMetric })}>
              {(Object.keys(PEAK_LABEL) as PeakMetric[]).map((k) => <option key={k} value={k}>{PEAK_LABEL[k]}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Force unit</span>
            <select value={s.forceUnit} onChange={(e) => set({ forceUnit: e.target.value as 'gf' | 'N' })}>
              <option value="gf">gram-force (gf)</option>
              <option value="N">newton (N)</option>
            </select>
          </label>
          <p className="note">1 gf = 0.00980665 N. This is a unit conversion only; the load-cell calibration factor is already applied by the instrument.</p>
          <label className="field">
            <span>Relative displacement</span>
            <select value={s.displacementMode} onChange={(e) => set({ displacementMode: e.target.value as AnalysisSettings['displacementMode'] })}>
              {Object.entries(DISPLACEMENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <p className="note">z₀ is the first recorded z of each movement. Check against Mach-1 Analysis before relying on equivalence.</p>
          <label className="field">
            <span>Baseline</span>
            <select value={s.baselineMode} onChange={(e) => set({ baselineMode: e.target.value as AnalysisSettings['baselineMode'] })}>
              <option value="none">Off (raw force)</option>
              <option value="holdMean">Mean of the end of the preceding hold</option>
              <option value="moveInterval">Mean of a time interval in the movement</option>
            </select>
          </label>
          {s.baselineMode === 'holdMean' && <Num label="Last seconds of hold" value={s.baselineHoldLastS} step={0.1} min={0.01} onChange={(v) => set({ baselineHoldLastS: v })} />}
          {s.baselineMode === 'moveInterval' && (
            <div className="pair">
              <Num label="From (s)" value={s.baselineInterval[0]} step={0.01} onChange={(v) => set({ baselineInterval: [v, s.baselineInterval[1]] })} />
              <Num label="To (s)" value={s.baselineInterval[1]} step={0.01} onChange={(v) => set({ baselineInterval: [s.baselineInterval[0], v] })} />
            </div>
          )}
          <p className="note">The baseline region is never chosen automatically. Raw forces are kept; corrected values appear separately.</p>
        </Section>

        <Section title="Advanced: single-point screening" open={false}>
          <p className="note">
            Detects one-point recording glitches inside a curve (Hampel-type rolling median with an isolation check). This does not decide whether a
            run is an outlier. Scores are a 0–1 severity index for review, not probabilities. No smoothing or extra filtering is applied.
          </p>
          <div className="pair">
            <Num label="Half-window (points)" value={s.point.halfWindow} step={1} min={1} max={50} onChange={(v) => setP({ halfWindow: Math.round(v) })} />
            <Num label="Scale floor (gf, 0 = auto)" value={s.point.scaleFloorGf} step={0.05} min={0} onChange={(v) => setP({ scaleFloorGf: v })} />
          </div>
          <Num label="z at score 0.5 (zHalf)" value={s.point.zHalf} step={0.5} min={0.5} onChange={(v) => setP({ zHalf: v })} />
          <div className="pair three">
            <Num label="Yellow ≥" value={s.point.yellow} step={0.05} min={0} max={1} onChange={(v) => setP({ yellow: v })} />
            <Num label="Orange ≥" value={s.point.orange} step={0.05} min={0} max={1} onChange={(v) => setP({ orange: v })} />
            <Num label="Red ≥" value={s.point.red} step={0.05} min={0} max={1} onChange={(v) => setP({ red: v })} />
          </div>
          <label className="field">
            <span>Automatic point exclusion</span>
            <select value={s.exclusionRule} onChange={(e) => set({ exclusionRule: e.target.value as AnalysisSettings['exclusionRule'] })}>
              <option value="keepAll">Keep all points</option>
              <option value="excludeRed">Exclude red points only</option>
              <option value="excludeYellowUp">Exclude yellow, orange and red points</option>
            </select>
          </label>
          <p className="note">Excluded points are left as gaps in the processed curve. Manual point exclusions (in the run details) are added on top. Nothing is deleted.</p>
        </Section>
      </div>
      <button className="link" onClick={() => update((p) => ({ ...p, settings: defaultSettings() }))}>
        Reset all settings to defaults
      </button>
    </div>
  );
}
