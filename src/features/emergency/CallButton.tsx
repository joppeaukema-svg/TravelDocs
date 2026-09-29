import type { ReactNode } from 'react';
import { telHref, whatsappHref } from '../../emergency/card';
import { AlertIcon, ChatIcon, PhoneIcon } from '../../ui/icons';
import { cx } from '../../ui/kit';

export function CallButton({
  label,
  number,
  kind = 'phone',
  note,
  unverified,
  prominent,
}: {
  label: ReactNode;
  number: string;
  kind?: 'phone' | 'whatsapp';
  note?: string | undefined;
  unverified?: boolean | undefined;
  prominent?: boolean;
}) {
  const href = kind === 'whatsapp' ? whatsappHref(number) : telHref(number);
  // Short local numbers sit to the right; full international numbers go under the label.
  const long = number.replace(/\D/g, '').length > 6;
  const digits = <span className={cx('tabular font-bold tracking-tight', long ? 'block text-xl' : 'shrink-0 text-2xl')}>{number}</span>;
  return (
    <a
      href={href}
      {...(kind === 'whatsapp' ? { target: '_blank', rel: 'noreferrer' } : {})}
      className={cx(
        'flex min-h-16 items-center gap-3 rounded-2xl border px-4 py-3 no-underline active:scale-[0.99]',
        prominent ? 'border-sos bg-sos text-white' : 'border-line bg-card text-ink',
      )}
    >
      <span
        className={cx(
          'grid h-11 w-11 shrink-0 place-items-center rounded-full',
          prominent ? 'bg-white/20' : 'bg-accent-soft text-accent',
        )}
      >
        {kind === 'whatsapp' ? <ChatIcon /> : <PhoneIcon />}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cx('block font-bold', prominent ? 'text-white' : 'text-ink')}>{label}</span>
        {long && digits}
        {note && (
          <span className={cx('flex items-start gap-1 text-sm', prominent ? 'text-white/90' : 'text-warn')}>
            {unverified && <AlertIcon size={16} className="mt-0.5 shrink-0" />}
            {note}
          </span>
        )}
      </span>
      {!long && digits}
    </a>
  );
}
