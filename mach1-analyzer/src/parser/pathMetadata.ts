/**
 * Infer experimental conditions from folder and file names.
 *
 * Examples that are recognized:
 *   "Hydrogel Experiments/0.25/Glass/60s-2.txt"
 *       -> charge ratio 0.25, substrate Glass, hold 60 s, repeat 2, concentration 2.1 M (default)
 *   "0.25 (2.5M)/Glass/30s.txt" or "2.5 M/0.25/Glass/30s.txt"
 *       -> concentration 2.5 M taken from the folder name
 *   "CR 0.75/Gel B/PTFE/1s-3.txt" -> charge ratio 0.75, gel "Gel B", substrate PTFE
 *
 * Every value records where it came from, so the interface can show which
 * values are defaults or guesses and let the user correct them.
 */
import type { ExperimentMeta, MetaField, MetaOverride, MetaSource } from '../types';
import { DEFAULT_CONCENTRATION_M } from '../types';

const SUBSTRATE_WORDS = [
  'glass', 'steel', 'stainless', 'aluminum', 'aluminium', 'ptfe', 'teflon', 'pet', 'pmma', 'acrylic',
  'polypropylene', 'polyethylene', 'polystyrene', 'pdms', 'silicone', 'skin', 'pigskin', 'porcine',
  'tissue', 'wood', 'copper', 'titanium', 'gelatin', 'plastic', 'metal', 'paper', 'substrate',
];

const field = <T>(value: T | null, source: MetaSource): MetaField<T> => ({ value, source });

/** Concentration like "2.5M", "2.5 M", "2.5 mol/L", "2.5mol L-1". Uppercase M only, to avoid mm/min. */
export function findConcentration(text: string): number | null {
  const m = text.match(/(?<![\d.])(\d+(?:\.\d+)?)\s*(?:M(?![a-zA-Z])|mol\s*\/\s*L\b|mol\s*L-1\b|molar\b)/);
  if (!m) return null;
  const v = Number(m[1]);
  return v > 0 && v < 20 ? v : null;
}

/** Charge ratio: a bare number folder ("0.25", "1.05") or "CR 0.25", "ratio 0.5", "R=0.75". */
export function findChargeRatio(segment: string): number | null {
  const withoutConc = segment
    .replace(/(?<![\d.])(\d+(?:\.\d+)?)\s*(?:M(?![a-zA-Z])|mol\s*\/\s*L\b|mol\s*L-1\b|molar\b)/g, ' ')
    .replace(/[()[\]{}]/g, ' ')
    .trim();
  const labelled = withoutConc.match(/(?:charge[\s_-]*ratio|ratio|\bcr|\br)\s*[=:_ -]?\s*(\d*\.?\d+)/i);
  if (labelled) {
    const v = Number(labelled[1]);
    if (v > 0 && v <= 10) return v;
  }
  if (/^\d*\.?\d+$/.test(withoutConc)) {
    const v = Number(withoutConc);
    if (v > 0 && v <= 10) return v;
  }
  return null;
}

/** Holding time from a file base name such as "60s", "1s", "2min", "500ms". */
export function findHoldTime(base: string): number | null {
  const m = base.match(/(?<![\d.])(\d+(?:\.\d+)?)\s*(ms|s|sec|secs|seconds?|min|mins|minutes?)(?![a-zA-Z])/i);
  if (!m) return null;
  const v = Number(m[1]);
  const unit = m[2].toLowerCase();
  if (unit === 'ms') return v / 1000;
  if (unit.startsWith('min')) return v * 60;
  return v;
}

/** "60s-2" -> { base: "60s", repeat: 2 }; "60s" -> { base: "60s", repeat: 1 }. */
export function splitRepeat(stem: string): { base: string; repeat: number; explicit: boolean } {
  const m = stem.match(/^(.*?)[\s_-]+(\d{1,3})$/);
  if (m && m[1].length > 0 && findHoldTime(m[1]) !== null) {
    return { base: m[1], repeat: Number(m[2]), explicit: true };
  }
  const paren = stem.match(/^(.*?)\s*\((\d{1,3})\)$/);
  if (paren && paren[1].length > 0) return { base: paren[1], repeat: Number(paren[2]), explicit: true };
  return { base: stem, repeat: 1, explicit: false };
}

export function inferMetadata(path: string): ExperimentMeta {
  const parts = path.split('/').filter((p) => p.length > 0);
  const fileName = parts.pop() ?? '';
  const stem = fileName.replace(/\.[^.]+$/, '');
  const notes: string[] = [];

  let chargeRatio: MetaField<number> = field<number>(null, 'unknown');
  let concentrationM: MetaField<number> = field<number>(null, 'unknown');
  let gel: MetaField<string> = field<string>(null, 'unknown');
  let substrate: MetaField<string> = field<string>(null, 'unknown');
  const used = new Set<number>();

  parts.forEach((seg, i) => {
    const conc = findConcentration(seg);
    if (conc !== null) {
      concentrationM = field(conc, 'path');
      used.add(i);
    }
    const cr = findChargeRatio(seg);
    if (cr !== null && chargeRatio.value === null) {
      chargeRatio = field(cr, 'path');
      used.add(i);
    }
    const lower = seg.toLowerCase();
    if (/\bgel\b|formulation|\bbatch\b/.test(lower) && gel.value === null) {
      gel = field(seg, 'path');
      used.add(i);
    } else if (SUBSTRATE_WORDS.some((w) => new RegExp(`(^|[^a-z])${w}([^a-z]|$)`).test(lower)) && substrate.value === null) {
      substrate = field(seg, 'path');
      used.add(i);
    }
  });

  // If no keyword matched, assume the folder that directly contains the file
  // is the substrate when it sits below a recognized charge-ratio folder.
  if (substrate.value === null && parts.length >= 2) {
    const parentIdx = parts.length - 1;
    if (!used.has(parentIdx) && used.size > 0) {
      substrate = field(parts[parentIdx], 'path');
      notes.push(`Substrate "${parts[parentIdx]}" was assumed from folder position; please check.`);
    }
  }

  const fileConc = findConcentration(stem);
  if (fileConc !== null) concentrationM = field(fileConc, 'filename');
  if (concentrationM.value === null) {
    concentrationM = field(DEFAULT_CONCENTRATION_M, 'default');
    notes.push(`No concentration found in the folder or file name; the default ${DEFAULT_CONCENTRATION_M} M is assumed.`);
  }

  const { base, repeat, explicit } = splitRepeat(stem);
  const hold = findHoldTime(base);
  if (hold === null) notes.push('No holding time found in the file name; the Wait duration recorded in the file is used per cycle.');

  return {
    chargeRatio,
    concentrationM,
    gel,
    substrate,
    nominalHoldS: field(hold, hold === null ? 'unknown' : 'filename'),
    repeat: field(repeat, explicit ? 'filename' : 'default'),
    baseName: base,
    notes,
  };
}

/** Apply user corrections on top of inferred values. */
export function applyOverride(meta: ExperimentMeta, ov: MetaOverride | undefined): ExperimentMeta {
  if (!ov) return meta;
  const out: ExperimentMeta = { ...meta };
  const keys: (keyof MetaOverride)[] = ['chargeRatio', 'concentrationM', 'gel', 'substrate', 'nominalHoldS', 'repeat'];
  for (const k of keys) {
    if (ov[k] !== undefined) {
      (out as unknown as Record<string, MetaField<unknown>>)[k] = field(ov[k] as unknown, 'user');
    }
  }
  return out;
}
