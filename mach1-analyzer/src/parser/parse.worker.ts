/// <reference lib="webworker" />
import { parseSource, type SourceFile } from './loader';

self.onmessage = async (e: MessageEvent<{ id: number; src: SourceFile }>) => {
  const { id, src } = e.data;
  try {
    const r = await parseSource(src);
    (self as unknown as Worker).postMessage({ id, ok: true, parsed: r.parsed, cycles: r.cycles });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: String(err) });
  }
};
