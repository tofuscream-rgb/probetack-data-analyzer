/**
 * Manual failure observations of probe-tack and 90° peel runs: Failure mode (where the
 * separation runs) and Debonding morphology (how it proceeds) are recorded separately and
 * are never inferred from the force curve. Also: bulk assignment and the definitions and
 * references shown in the app.
 */
import type { FailureMode, PeelMorphology, TackMorphology } from '../types';

export interface Option<T extends string> {
  value: T;
  label: string;
  /** Short definition (tooltip). */
  title?: string;
}

export const FAILURE_MODES: Option<FailureMode>[] = [
  { value: 'unspecified', label: '—' },
  { value: 'adhesive', label: 'Adhesive / interfacial', title: 'Separation at the gel–substrate (or gel–probe) interface (ISO 10365).' },
  { value: 'cohesive', label: 'Cohesive', title: 'Separation within the gel layer; gel remains on both surfaces (ISO 10365).' },
  { value: 'mixed', label: 'Mixed', title: 'Adhesive and cohesive failure over different parts of the bonded area.' },
  { value: 'other', label: 'Other', title: 'Any other pattern; describe it in the observation.' },
];

export const TACK_MORPHOLOGIES: Option<TackMorphology>[] = [
  { value: 'unspecified', label: '—' },
  { value: 'none', label: 'None', title: 'No cavities or fibrils observed.' },
  { value: 'cavitation', label: 'Cavitation', title: 'Cavities nucleate and grow in the gel layer during debonding.' },
  { value: 'fibrillation', label: 'Fibrillation', title: 'Gel walls extend into load-bearing fibrils bridging probe and substrate.' },
  { value: 'cavitation+fibrillation', label: 'Cavitation + fibrillation', title: 'Cavities form first; their walls then extend into fibrils.' },
  { value: 'other', label: 'Other', title: 'Any other morphology; describe it in the observation.' },
];

/** Stored values kept from earlier versions; the labels are the analyzer's operational categories. */
export const PEEL_MORPHOLOGIES: Option<PeelMorphology>[] = [
  { value: 'unspecified', label: '—' },
  { value: 'no-fibrils', label: 'No fibrillation', title: 'No fibrils observed at the peel front.' },
  { value: 'transient-fibrils', label: 'Transient fibrillation', title: 'Analyzer-defined: fibrils appear near the peel front but rupture/disappear quickly; no sustained fibrillated zone during steady peel.' },
  { value: 'persistent-fibrils', label: 'Persistent fibrillation', title: 'Analyzer-defined: fibrils remain/stretch through an appreciable part of steady peeling, giving a sustained fibrillated zone.' },
  { value: 'cavitation', label: 'Cavitation', title: 'Cavities nucleate and grow in the gel near the peel front.' },
  { value: 'cavitation+fibrillation', label: 'Cavitation + fibrillation', title: 'Cavities form first; their walls then extend into fibrils.' },
  { value: 'other', label: 'Other', title: 'Any other morphology; describe it in the observation.' },
];

export const optionLabel = <T extends string>(list: Option<T>[], v: T | undefined) => list.find((o) => o.value === v)?.label ?? '—';

// ---- bulk assignment -------------------------------------------------------------------------
export interface BulkRow {
  id: string;
  mode: FailureMode;
  morphology: string;
}

export interface BulkResult {
  /** Fields to set, per run. */
  patches: { id: string; mode?: FailureMode; morphology?: string }[];
  /** Fields left unchanged because they were already filled (only-blank mode). */
  skipped: number;
}

/**
 * The fields to set on the chosen runs. null = leave that field unchanged. With onlyBlank,
 * a field that already has a value ('unspecified' = blank) is kept.
 */
export function bulkPatches(rows: BulkRow[], ids: string[], mode: FailureMode | null, morphology: string | null, onlyBlank: boolean): BulkResult {
  const chosen = new Set(ids);
  const patches: BulkResult['patches'] = [];
  let skipped = 0;
  for (const r of rows) {
    if (!chosen.has(r.id)) continue;
    const p: BulkResult['patches'][number] = { id: r.id };
    if (mode !== null) {
      if (!onlyBlank || r.mode === 'unspecified') p.mode = mode;
      else skipped++;
    }
    if (morphology !== null) {
      if (!onlyBlank || r.morphology === 'unspecified') p.morphology = morphology;
      else skipped++;
    }
    if (p.mode !== undefined || p.morphology !== undefined) patches.push(p);
  }
  return { patches, skipped };
}

// ---- definitions and references -------------------------------------------------------------
export { REFERENCES, type Reference } from './references';

export type TermKind = 'standard' | 'literature' | 'analyzer';
export const TERM_KIND_LABEL: Record<TermKind, string> = {
  standard: 'Standard term',
  literature: 'Literature term',
  analyzer: 'Analyzer-defined operational category',
};

export interface GlossaryTerm {
  term: string;
  field: 'Failure mode' | 'Debonding morphology' | 'Observation field';
  tests: ('tack' | 'peel' | 'lapShear')[];
  definition: string;
  kind: TermKind;
  /** Reference keys; the note says how the source relates to the term. */
  refs: string[];
  note?: string;
}

export const GLOSSARY: GlossaryTerm[] = [
  {
    term: 'Adhesive / interfacial failure', field: 'Failure mode', tests: ['tack', 'peel', 'lapShear'], kind: 'standard', refs: ['iso10365'],
    definition: 'Separation at the interface between the gel and the substrate (or probe); the separated surface shows no gel left behind by visual inspection.',
  },
  {
    term: 'Cohesive failure', field: 'Failure mode', tests: ['tack', 'peel', 'lapShear'], kind: 'standard', refs: ['iso10365'],
    definition: 'Separation within the gel layer, so gel remains on both separated surfaces.',
  },
  {
    term: 'Mixed failure', field: 'Failure mode', tests: ['tack', 'peel', 'lapShear'], kind: 'standard', refs: ['iso10365'],
    definition: 'Adhesive failure over part of the bonded area and cohesive failure over the rest.',
    note: 'ISO 10365 designates the individual failure patterns and reports a combination by the approximate area fraction of each; record the fractions in the observation.',
  },
  {
    term: 'Other (failure mode)', field: 'Failure mode', tests: ['tack', 'peel', 'lapShear'], kind: 'analyzer', refs: [],
    definition: 'Any pattern not covered above (for example substrate failure or tearing at the edge); describe it in the observation.',
  },
  {
    term: 'None / No fibrillation', field: 'Debonding morphology', tests: ['tack', 'peel'], kind: 'analyzer', refs: [],
    definition: 'No cavities or fibrils were observed during debonding (probe tack: “None”; 90° peel: “No fibrillation”).',
  },
  {
    term: 'Cavitation', field: 'Debonding morphology', tests: ['tack', 'peel'], kind: 'literature', refs: ['lakrout1999', 'creton2016'],
    definition: 'Nucleation and growth of cavities (bubbles) in the adhesive layer during debonding, typically starting at or near the interface.',
    note: 'Observed directly in probe tack by Lakrout et al. (1999); reviewed by Creton & Ciccotti (2016).',
  },
  {
    term: 'Fibrillation', field: 'Debonding morphology', tests: ['tack', 'peel'], kind: 'literature', refs: ['lakrout1999', 'creton2016', 'chopin2018'],
    definition: 'Extension of the adhesive walls between cavities (or at the debonding front) into fibrils that bridge the two surfaces and carry load while they stretch.',
    note: 'Lakrout et al. (1999) and Creton & Ciccotti (2016) for probe tack; Chopin et al. (2018) model the fibrillated region and its failure in peeling.',
  },
  {
    term: 'Cavitation + fibrillation', field: 'Debonding morphology', tests: ['tack', 'peel'], kind: 'literature', refs: ['lakrout1999', 'creton2016'],
    definition: 'Cavities form first and the walls between them then extend into fibrils.',
    note: 'The sequence is described by Lakrout et al. (1999); the combined label is how this analyzer records it.',
  },
  {
    term: 'Transient fibrillation', field: 'Debonding morphology', tests: ['peel'], kind: 'analyzer', refs: ['chopin2018', 'creton2016'],
    definition: 'Fibrils appear near the peel front but rupture/disappear quickly; no sustained fibrillated zone during steady peel.',
    note: 'Operational category used by this analyzer, not standardized literature terminology. The cited works describe fibrillation in peeling and are background only.',
  },
  {
    term: 'Persistent fibrillation', field: 'Debonding morphology', tests: ['peel'], kind: 'analyzer', refs: ['chopin2018', 'creton2016'],
    definition: 'Fibrils remain/stretch through an appreciable part of steady peeling, giving a sustained fibrillated zone.',
    note: 'Operational category used by this analyzer, not standardized literature terminology. The cited works describe fibrillation in peeling and are background only.',
  },
  {
    term: 'Other (morphology)', field: 'Debonding morphology', tests: ['tack', 'peel'], kind: 'analyzer', refs: [],
    definition: 'Any other morphology; describe it in the observation.',
  },
  {
    term: 'Fibril onset δ / Max fibril extension', field: 'Observation field', tests: ['tack'], kind: 'analyzer', refs: [],
    definition: 'Optional values read from video: displacement at which fibrils are first seen, and the largest fibril extension (mm; shown as δ/h₀ when h₀ is known).',
  },
  {
    term: 'Fibrillated-zone length S / Maximum fibril length a_f', field: 'Observation field', tests: ['peel'], kind: 'analyzer', refs: [],
    definition: 'Optional values read from video: length of the fibrillated zone behind the peel front, and the longest fibril (mm).',
  },
];
