import { useId, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { AlertIcon, CheckIcon, ChevronRightIcon } from './icons';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-on-accent border-accent',
  secondary: 'bg-card text-ink border-line',
  danger: 'bg-crit-soft text-crit border-crit/40',
  ghost: 'bg-transparent text-accent border-transparent',
};

export function Button({
  variant = 'secondary',
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      className={cx(
        'inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border px-4 py-2 font-bold',
        'transition active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100',
        variants[variant],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function LinkButton({
  href,
  variant = 'secondary',
  className,
  children,
  external,
}: {
  href: string;
  variant?: Variant;
  className?: string;
  children: ReactNode;
  external?: boolean;
}) {
  return (
    <a
      href={href}
      {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
      className={cx(
        'inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border px-4 py-2 font-bold no-underline',
        'transition active:scale-[0.98]',
        variants[variant],
        className,
      )}
    >
      {children}
    </a>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx('rounded-2xl border border-line bg-card p-4', className)}>{children}</section>;
}

export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <header className="mb-4 mt-1">
      <h1 className="text-[1.7rem] font-bold leading-tight tracking-tight">{children}</h1>
      {sub && <p className="mt-1 text-muted">{sub}</p>}
    </header>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 mt-6 flex items-end justify-between gap-2">
      <h2 className="text-xs font-bold uppercase tracking-[0.12em] text-muted">{children}</h2>
      {action}
    </div>
  );
}

type Tone = 'info' | 'warn' | 'crit' | 'ok';
const tones: Record<Tone, string> = {
  info: 'bg-info-soft text-info border-info/30',
  warn: 'bg-warn-soft text-warn border-warn/30',
  crit: 'bg-crit-soft text-crit border-crit/30',
  ok: 'bg-ok-soft text-ok border-ok/30',
};

export function Notice({
  tone = 'info',
  title,
  children,
  action,
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div role={tone === 'crit' ? 'alert' : 'status'} className={cx('rounded-2xl border p-3.5', tones[tone])}>
      <div className="flex gap-2.5">
        {tone === 'ok' ? <CheckIcon className="mt-0.5 shrink-0" size={20} /> : <AlertIcon className="mt-0.5 shrink-0" size={20} />}
        <div className="min-w-0 flex-1">
          {title && <p className="font-bold">{title}</p>}
          {children && <div className="text-ink/90 [&_a]:underline">{children}</div>}
          {action && <div className="mt-2.5">{action}</div>}
        </div>
      </div>
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="mb-3.5">
      <label htmlFor={id} className="mb-1 block font-bold">
        {label}
      </label>
      {children(id)}
      {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
    </div>
  );
}

export const inputClass =
  'block w-full min-h-12 rounded-xl border border-line bg-card px-3 py-2 text-ink placeholder:text-muted/70';

export function TextField({
  label,
  hint,
  value,
  onChange,
  type = 'text',
  ...rest
}: {
  label: string;
  hint?: ReactNode;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
  inputMode?: 'text' | 'tel' | 'numeric' | 'decimal' | 'email';
  required?: boolean;
}) {
  return (
    <Field label={label} hint={hint}>
      {(id) => (
        <input
          id={id}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
          {...rest}
        />
      )}
    </Field>
  );
}

export function TextArea({
  label,
  hint,
  value,
  onChange,
  rows = 3,
}: {
  label: string;
  hint?: ReactNode;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
}) {
  return (
    <Field label={label} hint={hint}>
      {(id) => (
        <textarea id={id} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} className={inputClass} />
      )}
    </Field>
  );
}

export function SelectField<T extends string>({
  label,
  hint,
  value,
  onChange,
  options,
}: {
  label: string;
  hint?: ReactNode;
  value: T;
  onChange: (v: T) => void;
  options: readonly { value: T; label: string }[];
}) {
  return (
    <Field label={label} hint={hint}>
      {(id) => (
        <select id={id} value={value} onChange={(e) => onChange(e.target.value as T)} className={inputClass}>
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

export function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: ReactNode;
  hint?: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex min-h-12 cursor-pointer items-center justify-between gap-3 py-2">
      <span>
        <span className="block">{label}</span>
        {hint && <span className="block text-sm text-muted">{hint}</span>}
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className={cx(
          'relative h-7 w-12 shrink-0 rounded-full border transition peer-focus-visible:outline-3 peer-focus-visible:outline-accent',
          checked ? 'border-accent bg-accent' : 'border-line bg-sunk',
        )}
      >
        <span
          className={cx(
            'absolute top-0.5 h-5.5 w-5.5 rounded-full bg-card shadow transition-all',
            checked ? 'left-[1.45rem]' : 'left-0.5',
          )}
        />
      </span>
    </label>
  );
}

export function RowLink({
  href,
  icon,
  title,
  sub,
  trailing,
}: {
  href: string;
  icon?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <a
      href={href}
      className="flex min-h-14 items-center gap-3 border-b border-line px-1 py-3 text-ink no-underline last:border-b-0 active:bg-sunk"
    >
      {icon && <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-bold">{title}</span>
        {sub && <span className="block truncate text-sm text-muted">{sub}</span>}
      </span>
      {trailing}
      <ChevronRightIcon className="shrink-0 text-muted" size={20} />
    </a>
  );
}

export function Pill({ tone = 'info', children }: { tone?: Tone | 'muted'; children: ReactNode }) {
  const cls = tone === 'muted' ? 'bg-sunk text-muted' : tones[tone];
  return (
    <span className={cx('inline-flex items-center rounded-full border border-transparent px-2.5 py-0.5 text-sm font-bold', cls)}>
      {children}
    </span>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="mt-2 font-bold text-crit">
      {children}
    </p>
  );
}
