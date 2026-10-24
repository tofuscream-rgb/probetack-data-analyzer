/**
 * Parses files in a background Web Worker so large imports do not freeze the
 * page. Falls back to the main thread if workers are unavailable.
 */
import type { Cycle, ParsedFile } from '../types';
import { parseSource, type LoadedFile, type SourceFile } from './loader';

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (v: { parsed: ParsedFile; cycles: Cycle[] }) => void; reject: (e: unknown) => void }>();

function getWorker(): Worker | null {
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./parse.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.ok) p.resolve({ parsed: e.data.parsed, cycles: e.data.cycles });
      else p.reject(new Error(e.data.error));
    };
    worker.onerror = () => {
      worker = null;
    };
    return worker;
  } catch {
    return null;
  }
}

export async function parseInBackground(src: SourceFile): Promise<LoadedFile> {
  const w = getWorker();
  if (!w) return parseSource(src);
  const id = nextId++;
  try {
    const r = await new Promise<{ parsed: ParsedFile; cycles: Cycle[] }>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      w.postMessage({ id, src });
    });
    return { ...r, bytes: src.bytes };
  } catch {
    return parseSource(src);
  }
}

/** Start the worker early so the site keeps working if the network drops later. */
export function warmUpWorker(): void {
  getWorker();
}
