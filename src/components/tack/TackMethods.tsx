import { TACK_DEFAULTS } from '../../analysis/tackMetrics';
import { KATEX_SOURCE } from '../../plotting/katex';
import { Tex } from '../Tex';

const pct = (f: number) => `${f * 100}%`;

const ITEMS: { title: string; tex: string; text: string }[] = [
  {
    title: 'Contact area',
    tex: String.raw`A = \frac{\pi d^{2}}{4}`,
    text: 'd = probe diameter (mm, default 5.5 mm); A in mm². The flat probe is assumed to be in full contact.',
  },
  {
    title: 'Tensile force and displacement',
    tex: String.raw`F = -F_z,\qquad \delta = \lvert z - z_0\rvert - \delta_{\text{onset}}`,
    text: 'Fz = recorded force (pulling is recorded as negative; files in gf or N are converted to N). z = stage position, z₀ = first position of the run. δ is measured from the tensile onset: the point before the peak where F first becomes positive (zero crossing, linear interpolation). Only the tensile part of the pull is used.',
  },
  {
    title: 'Peak force and peak stress',
    tex: String.raw`F_{\max} = \max F(\delta),\qquad \sigma_{\max} = \frac{F_{\max}}{A},\qquad \delta_{\text{peak}} = \delta\big(F_{\max}\big)`,
    text: 'σ_max in kPa (N/mm² × 1000). δ_peak = displacement at F_max.',
  },
  {
    title: 'End of detachment and maximum strain',
    tex: String.raw`F(\delta_{\max}) = ${TACK_DEFAULTS.endFraction}\,F_{\max},\qquad \varepsilon_{\max} = \frac{\delta_{\max}}{h_0}`,
    text: `δ_max = first displacement after the peak where F falls to ≤ ${pct(TACK_DEFAULTS.endFraction)} of F_max (linear interpolation). If that never happens, δ_max is the end of the data and the run is flagged “detachment incomplete – W underestimated”. h₀ = gel thickness of the Repeat (mm); without h₀, ε_max is not computed.`,
  },
  {
    title: 'Work of debonding',
    tex: String.raw`W = \frac{1}{A}\int_{0}^{\delta_{\max}} F\,\mathrm{d}\delta \;\approx\; \frac{1}{A}\sum_i \frac{F_i + F_{i-1}}{2}\,(\delta_i - \delta_{i-1})`,
    text: 'Trapezoidal rule over the recorded points, from the tensile onset (δ = 0, F = 0) to δ_max. N·mm / mm² × 1000 = J/m². Points are used in recorded order.',
  },
  {
    title: 'Initial stiffness, compliance and apparent modulus',
    tex: String.raw`k = \frac{\mathrm{d}F}{\mathrm{d}\delta}\Big|_{${TACK_DEFAULTS.slopeFrom}F_{\max} \le F \le ${TACK_DEFAULTS.slopeTo}F_{\max}},\qquad C = \frac{1}{k},\qquad E_{\text{app}} = \frac{k\,h_0}{A}`,
    text: `k = least-squares slope of F against δ on the loading branch (onset to peak) using the points between ${pct(TACK_DEFAULTS.slopeFrom)} and ${pct(TACK_DEFAULTS.slopeTo)} of F_max (at least 3). k in N/mm, C in mm/N, E_app in kPa. E_app treats the gel as a uniform layer under the probe; confinement and instrument compliance are not corrected, so it is an apparent value.`,
  },
  {
    title: 'Plateau after the peak',
    tex: String.raw`\lvert F - F_p \rvert \le ${TACK_DEFAULTS.plateauTol}\,F_p \;\text{ over }\; \Delta\delta_p > ${TACK_DEFAULTS.plateauMinMm}\ \text{mm},\qquad \sigma_p = \frac{F_p}{A}`,
    text: `Between the peak and δ_max, the longest stretch in which every force lies within ±${pct(TACK_DEFAULTS.plateauTol)} of one level F_p (largest/smallest ≤ ${((1 + TACK_DEFAULTS.plateauTol) / (1 - TACK_DEFAULTS.plateauTol)).toFixed(2)}). If it is longer than ${TACK_DEFAULTS.plateauMinMm} mm: plateau stress σ_p = mean F in the stretch / A, plateau length Δδ_p, flag “possible fibrillation”; otherwise “sharp detachment”. The flag describes the curve shape only.`,
  },
  {
    title: 'Dwell relaxation',
    tex: String.raw`\text{relaxation} = \frac{F_{\text{start}} - F_{\text{end}}}{F_{\text{start}}}\times 100\%`,
    text: 'F_start and F_end = Fz at the first and last point of the Wait section before the pull (compression positive, as recorded, in N). Dwell time = Wait duration recorded in the file.',
  },
  {
    title: 'Statistics and exclusions',
    tex: String.raw`\bar{x} = \frac{1}{n}\sum x_j,\qquad s = \sqrt{\frac{\sum (x_j - \bar{x})^2}{n-1}}`,
    text: 'Per Repeat: mean ± sample SD over its runs. Per condition (substrate × dwell): mean ± SD over the Repeat means of the included Repeats, so each Repeat counts once. Only whole Repeats (files) or whole test sessions (recording date) can be excluded, each with a reason; single runs and points are never removed.',
  },
  {
    title: 'Force capacity (interpretation only, not computed)',
    tex: String.raw`F_c = \sqrt{\frac{G_c\,A}{C}}`,
    text: 'For a given critical energy release rate G_c, a larger contact area A or a stiffer (lower-compliance C) loading system gives a higher detachment force (Bartlett et al. 2012).',
  },
];

const CITATIONS: { ref: string; note: string }[] = [
  { ref: 'C. Creton, M. Ciccotti, “Fracture and adhesion of soft materials: a review,” Rep. Prog. Phys. 79, 046601 (2016).', note: 'Interpretation of probe-tack curves: peak stress, plateau (fibrillation), maximum extension and work of debonding.' },
  { ref: 'M.D. Bartlett et al., Prog. Mater. Sci. 137, 101086 (2023).', note: 'Energy release rate concepts.' },
  { ref: 'M.D. Bartlett et al., Adv. Mater. 24, 1078 (2012).', note: 'F_c = √(G_c A / C) and the role of compliance.' },
];

export function TackMethods() {
  return (
    <details className="section methods" open>
      <summary>Methods: equations, definitions and sources</summary>
      <div className="section-body">
        {ITEMS.map((it) => (
          <div key={it.title} className="method-item">
            <h4>{it.title}</h4>
            <Tex tex={it.tex} display />
            <p className="note">{it.text}</p>
          </div>
        ))}
        <h4>Sources</h4>
        <ol className="citations">
          {CITATIONS.map((c) => (
            <li key={c.ref}>{c.ref} <span className="note">— {c.note}</span></li>
          ))}
        </ol>
        <p className="note">Equations are typeset with {KATEX_SOURCE} (checked with Subresource Integrity); without a connection they are shown as LaTeX text.</p>
      </div>
    </details>
  );
}
