import { useEffect, useState } from 'react';
import { loadKatex } from '../plotting/katex';

/** An equation typeset with KaTeX; shown as its LaTeX source while KaTeX loads or if it cannot load. */
export function Tex({ tex, display = false }: { tex: string; display?: boolean }) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    loadKatex()
      .then((k) => alive && setHtml(k.renderToString(tex, { displayMode: display, throwOnError: false })))
      .catch(() => alive && setHtml(null));
    return () => { alive = false; };
  }, [tex, display]);
  if (html) return <span className={display ? 'tex display' : 'tex'} dangerouslySetInnerHTML={{ __html: html }} />;
  return <code className={display ? 'tex-fallback display' : 'tex-fallback'}>{tex}</code>;
}
