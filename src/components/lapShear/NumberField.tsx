import { useEffect, useState } from 'react';

/**
 * Number input that only commits valid values (on Enter or when leaving the field).
 * Invalid input is shown in red with a message and never reaches the analysis.
 */
export function NumberField({
  label,
  value,
  onCommit,
  min,
  positive = false,
  allowEmpty = false,
  placeholder,
  title,
  compact = false,
}: {
  label?: string;
  value: number | null;
  onCommit: (v: number | null) => void;
  min?: number;
  positive?: boolean;
  /** Empty input commits null (e.g. "use the automatic value"). */
  allowEmpty?: boolean;
  placeholder?: string;
  title?: string;
  compact?: boolean;
}) {
  const [text, setText] = useState(value === null ? '' : String(value));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setText(value === null ? '' : String(value));
    setError(null);
  }, [value]);

  const commit = () => {
    const t = text.trim().replace(',', '.');
    if (t === '') {
      if (allowEmpty) {
        setError(null);
        if (value !== null) onCommit(null);
        return;
      }
      setError('Enter a number');
      return;
    }
    const v = Number(t);
    if (!Number.isFinite(v)) return setError('Not a number');
    if (positive && !(v > 0)) return setError('Must be greater than 0');
    if (min !== undefined && v < min) return setError(`Must be at least ${min}`);
    setError(null);
    if (v !== value) onCommit(v);
  };

  const input = (
    <input
      className={`num-input ${error ? 'invalid' : ''} ${compact ? 'compact' : ''}`}
      inputMode="decimal"
      value={text}
      placeholder={placeholder}
      title={error ?? title}
      aria-invalid={!!error}
      aria-label={label}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setText(value === null ? '' : String(value)); setError(null); } }}
    />
  );
  if (!label || compact) return <span className="num-field">{input}{error && <small className="num-error">{error}</small>}</span>;
  return (
    <label className="num-field labeled">
      <span>{label}</span>
      {input}
      {error && <small className="num-error">{error}</small>}
    </label>
  );
}
