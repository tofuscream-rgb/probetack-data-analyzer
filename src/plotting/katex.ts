/**
 * KaTeX (equation typesetting) for the Methods panel, loaded from cdnjs on first use.
 * Subresource Integrity makes the browser refuse any file that differs from this exact
 * release. Only the script, its stylesheet and fonts are fetched; no data are sent
 * (connect-src stays 'self'). When KaTeX cannot load, equations are shown as text.
 */
const VERSION = '0.16.22';
const BASE = `https://cdnjs.cloudflare.com/ajax/libs/KaTeX/${VERSION}`;
const JS = { url: `${BASE}/katex.min.js`, integrity: 'sha384-cMkvdD8LoxVzGF/RPUKAcvmm49FQ0oxwDF3BGKtDXcEc+T1b2N+teh/OJfpU0jr6' };
const CSS = { url: `${BASE}/katex.min.css`, integrity: 'sha384-5TcZemv2l/9On385z///+d7MSYlvIEw9FuZTIdZ14vJLqWphw7e7ZPuOiCHJcFCP' };

export interface Katex {
  renderToString(tex: string, options?: { displayMode?: boolean; throwOnError?: boolean }): string;
}

let promise: Promise<Katex> | null = null;

export function loadKatex(): Promise<Katex> {
  const w = window as unknown as { katex?: Katex };
  if (w.katex) return Promise.resolve(w.katex);
  promise ??= new Promise<Katex>((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = CSS.url;
    link.integrity = CSS.integrity;
    link.crossOrigin = 'anonymous';
    link.referrerPolicy = 'no-referrer';
    document.head.appendChild(link);
    const script = document.createElement('script');
    script.src = JS.url;
    script.integrity = JS.integrity;
    script.crossOrigin = 'anonymous';
    script.referrerPolicy = 'no-referrer';
    script.onload = () => (w.katex ? resolve(w.katex) : reject(new Error('KaTeX did not initialise')));
    script.onerror = () => reject(new Error('KaTeX could not be loaded'));
    document.head.appendChild(script);
  }).catch((e) => {
    promise = null; // try again next time
    throw e;
  });
  return promise;
}

export const KATEX_SOURCE = `KaTeX ${VERSION} from cdnjs.cloudflare.com`;
