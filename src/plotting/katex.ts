/**
 * KaTeX (equation typesetting) for the Methods panel. It is bundled with the site and
 * loaded on first use (a separate file), so equations always render, offline too, and
 * the page still makes no connection to any other server.
 */
export interface Katex {
  renderToString(tex: string, options?: { displayMode?: boolean; throwOnError?: boolean }): string;
}

let promise: Promise<Katex> | null = null;

export function loadKatex(): Promise<Katex> {
  promise ??= Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(([m]) => (m.default ?? m) as unknown as Katex);
  return promise;
}

export const KATEX_SOURCE = 'KaTeX 0.16.22 (bundled with the site)';
