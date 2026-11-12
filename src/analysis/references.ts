/** Sources cited in the app (equations, definitions, failure terms). */
export interface Reference {
  key: string;
  citation: string;
  url: string;
  linkText: string;
  /** Short form used in source lines, e.g. "Creton & Ciccotti (2016)". */
  short: string;
}

export const REFERENCES: Reference[] = [
  { key: 'nistOutliers', short: 'NIST/SEMATECH', citation: 'NIST/SEMATECH e-Handbook of Statistical Methods, §1.3.5.17, Detection of Outliers.', url: 'https://www.itl.nist.gov/div898/handbook/eda/section3/eda35h.htm', linkText: 'NIST handbook' },
  { key: 'wang2020', short: 'Wang et al. (2020)', citation: 'Y. Wang, X. Yang, G. Nian, Z. Suo, Strength and toughness of adhesion of soft materials measured in lap shear, J. Mech. Phys. Solids 143, 103988 (2020).', url: 'https://doi.org/10.1016/j.jmps.2020.103988', linkText: 'doi:10.1016/j.jmps.2020.103988' },
  { key: 'iso10365', short: 'ISO 10365', citation: 'ISO 10365, Adhesives — Designation of main failure patterns.', url: 'https://www.iso.org/search.html?q=ISO%2010365', linkText: 'iso.org' },
  {
    key: 'lakrout1999', short: 'Lakrout et al. (1999)',
    citation: 'H. Lakrout, P. Sergot, C. Creton, “Direct Observation of Cavitation and Fibrillation in a Probe Tack Experiment on Model Acrylic Pressure-Sensitive-Adhesives,” J. Adhesion 69 (1999).',
    url: 'https://doi.org/10.1080/00218469908017233', linkText: 'doi:10.1080/00218469908017233',
  },
  {
    key: 'creton2016', short: 'Creton & Ciccotti (2016)',
    citation: 'C. Creton, M. Ciccotti, “Fracture and adhesion of soft materials: a review,” Rep. Prog. Phys. 79, 046601 (2016).',
    url: 'https://doi.org/10.1088/0034-4885/79/4/046601', linkText: 'doi:10.1088/0034-4885/79/4/046601',
  },
  {
    key: 'chopin2018', short: 'Chopin et al. (2018)',
    citation: 'J. Chopin et al., “Nonlinear Viscoelastic Modeling of Adhesive Failure for Polyacrylate Pressure-Sensitive Adhesives,” Macromolecules 51 (2018).',
    url: 'https://doi.org/10.1021/acs.macromol.8b01374', linkText: 'doi:10.1021/acs.macromol.8b01374',
  },
  {
    key: 'kendall1975', short: 'Kendall (1975)',
    citation: 'K. Kendall, “Thin-film peeling — the elastic term,” J. Phys. D: Appl. Phys. 8, 1449–1452 (1975).',
    url: 'https://doi.org/10.1088/0022-3727/8/13/005', linkText: 'doi:10.1088/0022-3727/8/13/005',
  },
  {
    key: 'bartlett2023', short: 'Bartlett et al. (2023)',
    citation: 'M.D. Bartlett, S.W. Case, A.J. Kinloch, D.A. Dillard, “Peel tests for quantifying adhesion and toughness: A review,” Prog. Mater. Sci. 137, 101086 (2023).',
    url: 'https://par.nsf.gov/servlets/purl/10450439', linkText: 'open-access record (par.nsf.gov)',
  },
  { key: 'astmD6862', short: 'ASTM D6862', citation: 'ASTM D6862, Standard Test Method for 90 Degree Peel Resistance of Adhesives.', url: 'https://store.astm.org/d6862-11r21.html', linkText: 'astm.org' },
  {
    key: 'astmD1002', short: 'ASTM D1002',
    citation: 'ASTM D1002, Standard Test Method for Apparent Shear Strength of Single-Lap-Joint Adhesively Bonded Metal Specimens by Tension Loading (Metal-to-Metal).',
    url: 'https://store.astm.org/standards/d1002', linkText: 'astm.org',
  },
];

export const refByKey = (key: string) => REFERENCES.find((r) => r.key === key);

/** "Creton & Ciccotti (2016), doi:…; Kendall (1975), doi:…" for plain-text places (Excel, tooltips). */
export const sourceText = (keys: string[]) =>
  keys.map((k) => refByKey(k)).filter((r): r is Reference => !!r).map((r) => `${r.short}, ${r.url}`).join('; ');
