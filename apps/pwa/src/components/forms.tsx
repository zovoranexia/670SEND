import type { InputHTMLAttributes, ReactNode } from 'react';
import { Field } from './ui';

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'children'>;

export function TextInput({ label, value, onChange, error, hint, optional, ...rest }: { label: string; value: string; onChange: (v: string) => void; error?: string | undefined; hint?: string; optional?: boolean } & InputProps) {
  return (
    <Field label={label} {...(error ? { error } : {})} {...(hint ? { hint } : {})} {...(optional ? { optional } : {})}>
      {(p) => <input {...rest} {...p} className={`input ${rest.className ?? ''}`} value={value} onChange={(e) => onChange(e.target.value)} />}
    </Field>
  );
}

export function SelectInput({ label, value, onChange, options, error, hint, placeholder }: { label: string; value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }>; error?: string | undefined; hint?: string; placeholder?: string }) {
  return (
    <Field label={label} {...(error ? { error } : {})} {...(hint ? { hint } : {})}>
      {(p) => (
        <select {...p} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

/** A large, thumb-sized checkbox row. */
export function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex min-h-12 items-start gap-3 rounded-xl border border-slate-300 bg-white p-3 text-base">
      <input type="checkbox" className="mt-0.5 h-6 w-6 shrink-0 accent-brand-700" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

/** Number with a unit label inside the box. */
export function UnitInput({ label, unit, value, onChange, error }: { label: string; unit: string; value: string; onChange: (v: string) => void; error?: string | undefined }) {
  return (
    <Field label={label} {...(error ? { error } : {})}>
      {(p) => (
        <div className="relative">
          <input {...p} className="input pr-12" type="text" inputMode="decimal" autoComplete="off" value={value} onChange={(e) => onChange(e.target.value)} />
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-slate-600" aria-hidden="true">
            {unit}
          </span>
        </div>
      )}
    </Field>
  );
}
