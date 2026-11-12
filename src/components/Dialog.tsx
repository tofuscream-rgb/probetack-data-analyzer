import { useEffect, useId, useRef, type ReactNode } from 'react';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal dialog used by the header (save, export, privacy). Focus moves into the dialog, Tab
 * stays inside it, Escape closes it, and focus returns to the control that opened it.
 */
export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const el = box.current;
    const items = () => (el ? [...el.querySelectorAll<HTMLElement>(FOCUSABLE)] : []);
    // First control after the close button (the dialog's first choice), else the close button.
    (items()[1] ?? items()[0])?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close.current();
      } else if (e.key === 'Tab') {
        const list = items();
        if (!list.length) return;
        const first = list[0];
        const last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      // Back to the button that opened the dialog (e.g. Export Excel).
      if (opener && document.contains(opener)) opener.focus();
    };
  }, []);

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div ref={box} className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <h2 id={titleId}>{title}</h2>
          <button className="icon" onClick={onClose} aria-label="Close">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
