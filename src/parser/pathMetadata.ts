/**
 * Infer experimental conditions from folder and file names.
 *
 * Examples that are recognized:
 *   "Hydrogel Experiments/0.25/Glass/60s-2.txt"
 *       -> charge ratio 0.25, substrate Glass, hold 60 s, repeat 2, concentration 2.1 M (default)
 *   "0.25 (2.5M)/Glass/30s.txt" or "2.5 M/0.25/Glass/30s.txt"
 *       -> concentration 2.5 M taken from the folder name
 *   "CR 0.75/Gel B/PTFE/1s-3.txt" -> charge ratio 0.75, gel "Gel B", substrate PTFE
 *   "glass/f=0.5/1s.txt", "f= 0.5 glass.txt", "CR 0.5", "f1.05", "0,5" -> charge ratio (see findChargeRatio)
 *   "after conference/stainless steel/0.75/1s.txt" -> the substrate folder may also sit
 *       above the gel folder (substrate first, then charge ratio); both orders are read
 *
 * Every value records where it came from, so the interface can show which
 * values are defaults or guesses and let the user correct them.
 */
import type { ExperimentMeta, MetaField, MetaOverride, MetaSource } from '../types';
import { DEFAULT_CONCENTRATION_M } from '../types';

const SUBSTRATE_WORDS = [
  'glass', 'steel', 'stainless', 'aluminum', 'aluminium', 'ptfe', 'teflon', 'pet', 'pmma', 'acrylic',
  'polypropylene', 'polyethylene', 'polystyrene', 'pdms', 'silicone', 'skin', 'pigskin', 'porcine',
  'tissue', 'wood', 'copper', 'titanium', 'gelatin', 'plastic', 'metal', 'paper', 'substrate', 'ss',
];

const field = <T>(value: T | null, source: MetaSource): MetaField<T> => ({ value, source });

/** "0,5" → "0.5" (decimal comma between digits). */
const decimalPoint = (t: string) => t.replace(/(\d),(\d)/g, '$1.$2');

/** Concentration like "2.5M", "2,5 M", "2.5 mol/L", "2.5mol L-1". Uppercase M only, to avoid mm/min. */
export function findConcentration(text: string): number | null {
  const m = decimalPoint(text).match(/(?<![\d.])(\d+(?:\.\d+)?)\s*(?:M(?![a-zA-Z])|mol\s*\/\s*L\b|mol\s*L-1\b|molar\b)/);
  if (!m) return null;
  const v = Number(m[1]);
  return v > 0 && v < 20 ? v : null;
}

const inRange = (v: number) => (v > 0 && v <= 10 ? v : null);
/** A number directly followed by a unit (mm, s, N, …) is a length, time or force, not a charge ratio. */
const UNIT_AFTER = String.raw`(?!\d|\.\d|\s*(?:mm|cm|um|µm|m|s|sec|ms|min|h|n|kn|g|gf|kg|pa|kpa|mpa|hz|deg|%)(?![a-z]))`;
/**
 * A labelled charge ratio anywhere in the text: "f=0.5", "f= 0.5", "f: 0.5", "F 0.50", "f_0.5", "f0.5",
 * "CR=0.5", "cr0.5", "R=0.75", "ratio_0.5", "charge ratio 0.5", "gel 1.05". The label must not be part of
 * a longer word ("half", "acrylic"). Whole numbers are taken after f, cr, r, ratio ("f=1"), not after gel ("Gel 2").
 */
function labelledChargeRatio(text: string): number | null {
  const re = new RegExp(String.raw`(?<![a-z0-9])(charge[\s_-]*ratio|ratio|cr|r|f|gel)\s*[=:_-]?\s*(\d*\.\d+|\d+)` + UNIT_AFTER, 'gi');
  for (const m of text.matchAll(re)) {
    if (m[1].toLowerCase() === 'gel' && !m[2].includes('.')) continue;
    const v = inRange(Number(m[2]));
    if (v !== null) return v;
  }
  return null;
}

/**
 * Charge ratio of a folder name: a labelled value (see above), a bare number ("0.25", "1.05", "0,5"),
 * one letter before a decimal number ("x1.05"), or a decimal number before words ("1.05f", "0.25 gel",
 * "0.25 2.98M 90": a leading number next to a concentration).
 */
export function findChargeRatio(segment: string): number | null {
  const seg = decimalPoint(segment);
  const withoutConc = seg
    .replace(/(?<![\d.])(\d+(?:\.\d+)?)\s*(?:M(?![a-zA-Z])|mol\s*\/\s*L\b|mol\s*L-1\b|molar\b)/g, ' ')
    .replace(/[()[\]{},;]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const labelled = labelledChargeRatio(withoutConc);
  if (labelled !== null) return labelled;
  if (/^\d*\.?\d+$/.test(withoutConc)) return inRange(Number(withoutConc));
  // One letter before a decimal number, optionally followed by other words ("x1.05 new"). "v2" is not taken.
  const prefixed = withoutConc.match(new RegExp(String.raw`^[a-z][\s_-]?(\d*\.\d+)` + UNIT_AFTER + String.raw`(?=$|[\s_-])`, 'i'));
  if (prefixed) return inRange(Number(prefixed[1]));
  // A decimal number at the start followed by letters or words ("1.05f", "0.25 gel", "0.75_new").
  const suffixed = withoutConc.match(new RegExp(String.raw`^(\d*\.\d+)` + UNIT_AFTER + String.raw`(?=[a-z]|[\s_-]+[a-z])`, 'i'));
  if (suffixed) return inRange(Number(suffixed[1]));
  // "0.25 2.98M 90": a leading number next to a concentration (later numbers, such as a peel angle, are ignored).
  const lead = withoutConc.match(/^(\d*\.?\d+)\s/);
  if (lead && withoutConc !== seg.trim()) return inRange(Number(lead[1]));
  return null;
}

/** Charge ratio written in a file name: only labelled values ("f=0.5 glass.txt", "CR 0.5 1s.txt"), never bare numbers. */
export function findChargeRatioInFileName(stem: string): number | null {
  return labelledChargeRatio(decimalPoint(stem).replace(/[()[\]{},;]/g, ' '));
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

/** Version marker at the end of a name: "PETv2", "PET v3", "PET_v4", "PET-V5" → { base: "PET", version: 2…5 }. */
export function splitVersion(name: string): { base: string; version: number | null } {
  const m = name.match(/^(.*?[a-z0-9)\]])[\s_-]*v(\d{1,3})$/i);
  return m ? { base: m[1].trim(), version: Number(m[2]) } : { base: name, version: null };
}

/** "60s-2" -> { base: "60s", repeat: 2 }; "60s v2" -> repeat 2; "60s" -> { base: "60s", repeat: 1 }. */
export function splitRepeat(stem: string): { base: string; repeat: number; explicit: boolean } {
  const ver = splitVersion(stem);
  if (ver.version !== null && findHoldTime(ver.base) !== null) return { base: ver.base, repeat: ver.version, explicit: true };
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

  // Substrate named in the file itself ("glass.txt", "PET-2.txt" = PET, repeat 2).
  // "PETv2", "PET v3", "PET_v4" are versions (repeats) of PET, not other substrates.
  const numbered = stem.match(/^(.*?)[\s_-]+(\d{1,3})$/) ?? stem.match(/^(.*?)\s*\((\d{1,3})\)$/);
  const ver = splitVersion(numbered && numbered[1] ? numbered[1] : stem);
  const fileBase = ver.base;
  let fileRepeat: number | null = null;
  if (substrate.value === null && findHoldTime(fileBase) === null && SUBSTRATE_WORDS.some((w) => new RegExp(`(^|[^a-z])${w}([^a-z]|$)`).test(fileBase.toLowerCase()))) {
    // "f= 0.5 glass" → "glass": the charge ratio and concentration are not part of the substrate name.
    const name = decimalPoint(fileBase)
      .replace(new RegExp(String.raw`(?<![a-z0-9])(charge[\s_-]*ratio|ratio|cr|r|f|gel)\s*[=:_-]?\s*(\d*\.\d+|\d+)`, 'gi'), ' ')
      .replace(/(?<![\d.])(\d+(?:\.\d+)?)\s*(?:M(?![a-zA-Z])|mol\s*\/\s*L\b)/g, ' ')
      .replace(/^[\s_,;-]+|[\s_,;-]+$/g, '')
      .replace(/\s+/g, ' ');
    substrate = field(name || fileBase, 'filename');
    if (numbered && numbered[1]) fileRepeat = Number(numbered[2]);
    else if (ver.version !== null) fileRepeat = ver.version;
  }

  // If no keyword matched, assume the substrate from folder position, in either layout:
  //   gel first:       .../0.25 2.5M/<substrate>/file  -> the folder that contains the file
  //   substrate first: .../<substrate>/0.75/file       -> the folder above the gel folder
  // The top folder (the one picked for import, e.g. "after conference") is never taken.
  if (substrate.value === null && parts.length >= 2 && used.size > 0) {
    const parentIdx = parts.length - 1;
    const aboveIdx = Math.min(...used) - 1;
    const idx = !used.has(parentIdx) ? parentIdx : aboveIdx >= 1 && !used.has(aboveIdx) ? aboveIdx : -1;
    if (idx >= 0) {
      substrate = field(parts[idx], 'path');
      notes.push(`Substrate "${parts[idx]}" was assumed from folder position; please check.`);
    }
  }

  // Charge ratio written in the file name ("f=0.5 glass.txt") when no folder gives one.
  if (chargeRatio.value === null) {
    const fileCr = findChargeRatioInFileName(stem);
    if (fileCr !== null) chargeRatio = field(fileCr, 'filename');
  }

  const fileConc = findConcentration(stem);
  if (fileConc !== null) concentrationM = field(fileConc, 'filename');
  if (concentrationM.value === null) {
    concentrationM = field(DEFAULT_CONCENTRATION_M, 'default');
    notes.push(`No concentration found in the folder or file name; the default ${DEFAULT_CONCENTRATION_M} M is assumed.`);
  }

  const { base, repeat, explicit } = splitRepeat(stem);
  const hold = findHoldTime(base);
  if (hold === null) notes.push('No holding time found in the file name; the Wait duration recorded in the file is used per run.');

  return {
    chargeRatio,
    concentrationM,
    gel,
    substrate,
    nominalHoldS: field(hold, hold === null ? 'unknown' : 'filename'),
    repeat: fileRepeat !== null && !explicit ? field(fileRepeat, 'filename') : field(repeat, explicit ? 'filename' : 'default'),
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
