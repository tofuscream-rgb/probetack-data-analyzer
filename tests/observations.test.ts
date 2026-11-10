import { describe, expect, it } from 'vitest';
import { FAILURE_MODES, GLOSSARY, PEEL_MORPHOLOGIES, REFERENCES, TACK_MORPHOLOGIES, bulkPatches } from '../src/analysis/observations';

describe('bulk assignment of failure observations', () => {
  const rows = [
    { id: 'a', mode: 'unspecified' as const, morphology: 'unspecified' },
    { id: 'b', mode: 'cohesive' as const, morphology: 'unspecified' },
    { id: 'c', mode: 'unspecified' as const, morphology: 'fibrillation' },
    { id: 'd', mode: 'adhesive' as const, morphology: 'none' },
  ];

  it('only fills blank fields by default, leaving entered values unchanged', () => {
    const r = bulkPatches(rows, ['a', 'b', 'c'], 'adhesive', 'cavitation', true);
    expect(r.patches).toEqual([
      { id: 'a', mode: 'adhesive', morphology: 'cavitation' },
      { id: 'b', morphology: 'cavitation' },
      { id: 'c', mode: 'adhesive' },
    ]);
    expect(r.skipped).toBe(2); // b's mode and c's morphology were kept
  });

  it('overwrites when "only fill blank fields" is off, and changes only the chosen field', () => {
    expect(bulkPatches(rows, ['b', 'd'], 'mixed', null, false).patches).toEqual([{ id: 'b', mode: 'mixed' }, { id: 'd', mode: 'mixed' }]);
    expect(bulkPatches(rows, ['d'], null, 'other', false).patches).toEqual([{ id: 'd', morphology: 'other' }]);
    expect(bulkPatches(rows, [], 'mixed', 'other', false).patches).toEqual([]); // nothing selected
    expect(bulkPatches(rows, ['d'], 'unspecified', null, false).patches).toEqual([{ id: 'd', mode: 'unspecified' }]); // clear
  });
});

describe('failure mode, morphologies and definitions', () => {
  it('uses the agreed option lists', () => {
    expect(FAILURE_MODES.map((o) => o.label)).toEqual(['—', 'Adhesive / interfacial', 'Cohesive', 'Mixed', 'Other']);
    expect(TACK_MORPHOLOGIES.map((o) => o.label)).toEqual(['—', 'None', 'Cavitation', 'Fibrillation', 'Cavitation + fibrillation', 'Other']);
    expect(PEEL_MORPHOLOGIES.map((o) => o.label)).toEqual(['—', 'No fibrillation', 'Transient fibrillation', 'Persistent fibrillation', 'Cavitation', 'Cavitation + fibrillation', 'Other']);
  });

  it('defines every option, with its type and an existing source', () => {
    const keys = new Set(REFERENCES.map((r) => r.key));
    for (const g of GLOSSARY) {
      expect(g.definition.length).toBeGreaterThan(20);
      for (const k of g.refs) expect(keys.has(k)).toBe(true);
      if (g.kind !== 'analyzer') expect(g.refs.length).toBeGreaterThan(0);
    }
    // Every selectable option has a glossary entry.
    const termFor: Record<string, string> = {
      'Adhesive / interfacial': 'Adhesive / interfacial failure', Cohesive: 'Cohesive failure', Mixed: 'Mixed failure', Other: 'Other (failure mode)',
      None: 'None / No fibrillation', 'No fibrillation': 'None / No fibrillation', Cavitation: 'Cavitation', Fibrillation: 'Fibrillation',
      'Cavitation + fibrillation': 'Cavitation + fibrillation', 'Transient fibrillation': 'Transient fibrillation', 'Persistent fibrillation': 'Persistent fibrillation',
    };
    const terms = new Set(GLOSSARY.map((g) => g.term));
    for (const o of [...FAILURE_MODES, ...TACK_MORPHOLOGIES, ...PEEL_MORPHOLOGIES].filter((x) => x.value !== 'unspecified')) {
      const t = o.label === 'Other' && TACK_MORPHOLOGIES.includes(o as never) ? 'Other (morphology)' : termFor[o.label];
      expect(terms.has(t), o.label).toBe(true);
    }
    expect(terms.has('Other (morphology)')).toBe(true);
  });

  it('marks transient and persistent fibrillation as analyzer-defined, not standard literature terms', () => {
    for (const t of ['Transient fibrillation', 'Persistent fibrillation']) {
      const g = GLOSSARY.find((x) => x.term === t)!;
      expect(g.kind).toBe('analyzer');
      expect(g.note).toMatch(/not standardized literature terminology/);
    }
    expect(PEEL_MORPHOLOGIES.find((o) => o.value === 'transient-fibrils')!.title).toMatch(/^Analyzer-defined:/);
  });

  it('cites the agreed sources with DOI links', () => {
    expect(REFERENCES.map((r) => r.url)).toEqual([
      'https://www.iso.org/search.html?q=ISO%2010365',
      'https://doi.org/10.1080/00218469908017233',
      'https://doi.org/10.1088/0034-4885/79/4/046601',
      'https://doi.org/10.1021/acs.macromol.8b01374',
    ]);
    expect(GLOSSARY.find((g) => g.term === 'Adhesive / interfacial failure')!.refs).toEqual(['iso10365']);
    expect(GLOSSARY.find((g) => g.term === 'Cavitation')!.refs).toContain('lakrout1999');
  });
});
