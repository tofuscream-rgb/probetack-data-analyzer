import { REFERENCES } from '../analysis/references';
import { Tex } from './Tex';

/** An equation with its definition and source (refs empty = defined by this analyzer or not adhesion-specific, as the note says). */
export interface EquationItem {
  title: string;
  tex?: string;
  text: string;
  refs: string[];
  note: string;
}

/** Equations, each with a source line, and the numbered references they cite (in order of first citation). */
export function EquationList({ items, title }: { items: EquationItem[]; title: string }) {
  const cited = [...new Set(items.flatMap((it) => it.refs))].map((k) => REFERENCES.find((r) => r.key === k)!).filter(Boolean);
  const num = (k: string) => cited.findIndex((r) => r.key === k) + 1;
  return (
    <section className="equations methods" aria-label={title}>
      <h3 className="ls-h">{title}</h3>
      {items.map((it) => (
        <div key={it.title} className="method-item">
          <h4>{it.title}</h4>
          {it.tex && <Tex tex={it.tex} display />}
          <p className="note">{it.text}</p>
          <p className="note source">
            <strong>Source:</strong> {it.refs.length ? <>{it.refs.map(num).sort((x, y) => x - y).map((n) => `[${n}]`).join(' ')} — </> : null}{it.note}
          </p>
        </div>
      ))}
      {cited.length > 0 && (
        <>
          <h4>References</h4>
          <ol className="citations">
            {cited.map((r) => <li key={r.key}>{r.citation}{r.url && <> <a href={r.url} target="_blank" rel="noreferrer noopener">{r.linkText}</a></>}</li>)}
          </ol>
        </>
      )}
    </section>
  );
}
