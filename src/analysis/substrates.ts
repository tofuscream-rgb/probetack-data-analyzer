/**
 * Substrate names and their order in tables and plots: PET, stainless steel, glass,
 * then any other substrate alphabetically. Spellings such as "ss", "SS", "Stainless"
 * and "stainless steel" are the same substrate.
 */
const ORDER = ['PET', 'stainless steel', 'glass'] as const;

/** "PET", "stainless steel" or "glass" when the name is one of them, else null. */
export function canonicalSubstrate(name: string | null | undefined): (typeof ORDER)[number] | null {
  const s = (name ?? '').trim().toLowerCase();
  if (/(^|[^a-z])pet([^a-z]|$)/.test(s)) return 'PET';
  if (/stainless|(^|[^a-z])ss([^a-z]|$)|steel/.test(s)) return 'stainless steel';
  if (/glass/.test(s)) return 'glass';
  return null;
}

export function substrateRank(name: string | null | undefined): number {
  const c = canonicalSubstrate(name);
  return c ? ORDER.indexOf(c) : ORDER.length;
}

/** Sort comparator: PET, stainless steel, glass, then others alphabetically. */
export const bySubstrate = (a: string, b: string) => substrateRank(a) - substrateRank(b) || a.localeCompare(b, undefined, { numeric: true });
