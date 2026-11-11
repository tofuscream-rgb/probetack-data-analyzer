import { LOW_RESOLUTION_STEPS, TACK_DEFAULTS } from '../../analysis/tackMetrics';
import { KATEX_SOURCE } from '../../plotting/katex';
import { Tex } from '../Tex';
import { REFERENCES } from '../../analysis/references';

const pct = (f: number) => `${f * 100}%`;

/** One entry: a rendered equation, a plain-language definition of every symbol, and how it is computed. */
interface Source {
  /** Cited works (keys of REFERENCES), in the order given. */
  refs: string[];
  /** What is taken from them, and what is defined by this analyzer. */
  note: string;
}
export const TACK_METHOD_ITEMS: { title: string; tex: string; text: string; source: Source }[] = [
  {
    title: 'Contact area',
    tex: String.raw`A = \frac{\pi d^{2}}{4}`,
    text: 'd = probe diameter (mm, default 5.5 mm); A in mm². The flat probe is assumed to be in full contact.',
    source: { refs: ['creton2016'], note: `nominal stress uses the contact area A_max of the probe (Creton & Ciccotti 2016, eq. 9); A = πd²/4 is the area of a flat circular probe in full contact.` },
  },
  {
    title: 'Tensile force and displacement',
    tex: String.raw`F = -F_z,\qquad \delta = \lvert z - z_0\rvert - \delta_{\text{onset}}`,
    text: 'F_z = recorded force (pulling is recorded as negative; files in gf or N, single- or multi-axis, are converted to N). z = stage position, z₀ = first position of the run. δ is measured from the tensile onset: the point before the peak where F first becomes positive (zero crossing, linear interpolation). Only the tensile part of the pull is used.',
    source: { refs: ['creton2016'], note: `force and displacement of the probe-tack pull as in Creton & Ciccotti (2016); taking δ from the tensile onset (zero crossing) is defined by this analyzer.` },
  },
  {
    title: 'Peak force and peak stress',
    tex: String.raw`F_{\max} = \max_{\delta} F(\delta),\qquad \sigma_{\max} = \frac{F_{\max}}{A},\qquad \delta_{\text{peak}} = \delta\!\left(F_{\max}\right),\qquad \varepsilon_{\text{peak}} = \frac{\delta_{\text{peak}}}{h_0}`,
    text: 'σ_max in kPa (N/mm² × 1000). δ_peak = displacement at F_max; ε_peak = the strain at peak stress. h₀ = gel thickness of the Repeat (mm); without h₀ the strains are not computed.',
    source: { refs: ['creton2016'], note: `peak stress σ_max = F_max/A and nominal strain ε = Δh/h₀ (Creton & Ciccotti 2016, eq. 9 and the peak-stress parameter σ_max).` },
  },
  {
    title: 'Failure point',
    tex: String.raw`F\!\left(\delta_{\text{failure}}\right) = ${TACK_DEFAULTS.endFraction}\,F_{\max},\qquad \varepsilon_{\text{failure}} = \frac{\delta_{\text{failure}}}{h_0}`,
    text: `δ_failure = first displacement after the peak where F falls to ≤ ${pct(TACK_DEFAULTS.endFraction)} of F_max (linear interpolation): full detachment. If that never happens, true failure displacement and strain are left blank; the end of the recording is used only as the lower-bound work-integration limit.`,
    source: { refs: ['creton2016'], note: `maximum extension ε_max of the nominal stress–strain curve (Creton & Ciccotti 2016); the end-of-detachment threshold F ≤ ${pct(TACK_DEFAULTS.endFraction)} F_max is defined by this analyzer.` },
  },
  {
    title: 'Work of adhesion (debonding)',
    tex: String.raw`W_{\text{adh}} = \frac{1}{A}\int_{0}^{\delta_{\text{end}}} F\,\mathrm{d}\delta \;\approx\; \frac{1}{A}\sum_{i} \frac{F_i + F_{i-1}}{2}\,\left(\delta_i - \delta_{i-1}\right)`,
    text: 'Trapezoidal rule over the recorded points, from the tensile onset (δ = 0, F = 0) to δ_end = δ_failure, or to the end of the recording when detachment is incomplete (then W_adh is a lower bound). N·mm / mm² × 1000 = J/m².',
    source: { refs: ['creton2016', 'bartlett2023'], note: `work of debonding W_deb = h₀∫σ dε = (1/A)∫F dδ, the area under the loading curve (Creton & Ciccotti 2016); energy-per-area background: Bartlett et al. (2023). The trapezoidal rule is the numerical method used here.` },
  },
  {
    title: 'Plateau after the peak',
    tex: String.raw`\left\lvert F - F_p \right\rvert \le ${TACK_DEFAULTS.plateauTol}\,F_p \;\;\text{over}\;\; \Delta\delta_p > ${TACK_DEFAULTS.plateauMinMm}\ \text{mm},\qquad \sigma_p = \frac{F_p}{A}`,
    text: `Between the peak and the end of detachment, the longest stretch in which every force lies within ±${pct(TACK_DEFAULTS.plateauTol)} of one level F_p. If it is longer than ${TACK_DEFAULTS.plateauMinMm} mm, the plateau stress σ_p (mean F in the stretch / A) and plateau length Δδ_p are reported; otherwise they are blank. The curve is not classified: a plateau does not by itself mean fibrillation.`,
    source: { refs: ['creton2016'], note: `plateau stress σ_p of the probe-tack curve (Creton & Ciccotti 2016); the detection criterion (±${pct(TACK_DEFAULTS.plateauTol)} of a level over > ${TACK_DEFAULTS.plateauMinMm} mm) is defined by this analyzer.` },
  },
  {
    title: 'Failure mode and debonding morphology',
    tex: String.raw`\text{failure mode} \perp \text{debonding morphology}`,
    text: 'Failure mode (adhesive/interfacial, cohesive, mixed, other) and debonding morphology (none, cavitation, fibrillation, cavitation + fibrillation, other) are entered separately from observation/video, one run at a time or in bulk. Neither is inferred from the force curve. Each term is defined, with its source, in section 9 (Definitions & References).',
    source: { refs: ['iso10365', 'lakrout1999', 'creton2016'], note: `failure patterns from ISO 10365; cavitation and fibrillation from Lakrout et al. (1999) and Creton & Ciccotti (2016). Full definitions in section 9.` },
  },
  {
    title: 'Data-quality flags (warnings only)',
    tex: String.raw`n_{\text{steps}} = \frac{F_{\max}}{\Delta F_{\text{res}}} < ${LOW_RESOLUTION_STEPS}\;\Rightarrow\;\text{Low force resolution}`,
    text: `ΔF_res = smallest step between distinct recorded force values in the run. Low force resolution: fewer than ${LOW_RESOLUTION_STEPS} steps at F_max, so the plateau and relaxation may be approximate. Incomplete detachment: F never fell to ≤ ${pct(TACK_DEFAULTS.endFraction)} F_max before the file ended, so W_adh is a lower bound and the failure displacement/strain are blank. Load tared after dwell: a Zero Load step between the Wait and the pull reset the load cell, so the pull force is referenced to the new zero. Flagged runs are never excluded automatically.`,
    source: { refs: [], note: `criteria defined by this analyzer (no literature source).` },
  },
  {
    title: 'Statistics and exclusions',
    tex: String.raw`\bar{x} = \frac{1}{n}\sum_{j=1}^{n} x_j,\qquad s = \sqrt{\frac{1}{n-1}\sum_{j=1}^{n} \left(x_j - \bar{x}\right)^2}`,
    text: 'Per Repeat: mean ± sample SD over its runs. Per condition (substrate × dwell): mean ± SD over the Repeat means of the included Repeats, so each Repeat counts once. Nothing is excluded by default; you may exclude a whole Repeat, a test session (recording date) or a single run, each with a reason. Points are never removed.',
    source: { refs: [], note: `standard sample mean and standard deviation (n − 1); not adhesion-specific. The Repeat-level averaging is defined by this analyzer.` },
  },
  {
    title: 'Advanced: dwell relaxation',
    tex: String.raw`\text{relaxation} = \frac{F_{\text{start}} - F_{\text{end}}}{F_{\text{start}}}\times 100\%`,
    text: 'F_start, F_end = F_z at the first and last point of the Wait section before the pull (compression positive, in N). Dwell time = Wait duration recorded in the file.',
    source: { refs: [], note: `defined by this analyzer (no literature source).` },
  },
];

/** References in the order they are first cited. */
const CITED = [...new Set(TACK_METHOD_ITEMS.flatMap((it) => it.source.refs))].map((k) => REFERENCES.find((r) => r.key === k)!).filter(Boolean);
const num = (key: string) => CITED.findIndex((r) => r.key === key) + 1;

export function TackMethods({ n }: { n?: number }) {
  return (
    <details className="section methods">
      <summary>{n ? `${n}. ` : ''}Methods, equations, definitions and references</summary>
      <div className="section-body">
        {TACK_METHOD_ITEMS.map((it) => (
          <div key={it.title} className="method-item">
            <h4>{it.title}</h4>
            <Tex tex={it.tex} display />
            <p className="note">{it.text}</p>
            <p className="note source">
              <strong>Source:</strong> {it.source.refs.length ? <>{it.source.refs.map(num).sort((x, y) => x - y).map((n) => `[${n}]`).join(' ')} — </> : null}{it.source.note}
            </p>
          </div>
        ))}
        <h4>References</h4>
        <ol className="citations">
          {CITED.map((r) => <li key={r.key}>{r.citation} <a href={r.url} target="_blank" rel="noreferrer noopener">{r.linkText}</a></li>)}
        </ol>
        <p className="note">Equations are typeset with {KATEX_SOURCE}.</p>
      </div>
    </details>
  );
}
