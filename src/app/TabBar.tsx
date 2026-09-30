import type { ComponentType } from 'react';
import { DocsIcon, GlobeIcon, MoreIcon, TodayIcon, TripIcon } from '../ui/icons';
import { cx } from '../ui/kit';

export type Tab = 'today' | 'trip' | 'docs' | 'countries' | 'more';

const tabs: { id: Tab; label: string; href: string; Icon: ComponentType<{ size?: number }> }[] = [
  { id: 'today', label: 'Today', href: '#/today', Icon: TodayIcon },
  { id: 'trip', label: 'Trip', href: '#/trip', Icon: TripIcon },
  { id: 'docs', label: 'Docs', href: '#/docs', Icon: DocsIcon },
  { id: 'countries', label: 'Countries', href: '#/countries', Icon: GlobeIcon },
  { id: 'more', label: 'More', href: '#/more', Icon: MoreIcon },
];

export function TabBar({ active }: { active: Tab | null }) {
  return (
    <nav className="no-print safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-card/95 backdrop-blur" aria-label="Main">
      <ul className="mx-auto flex max-w-xl">
        {tabs.map(({ id, label, href, Icon }) => {
          const isActive = id === active;
          return (
            <li key={id} className="flex-1">
              <a
                href={href}
                aria-current={isActive ? 'page' : undefined}
                className={cx(
                  'relative flex min-h-14 flex-col items-center justify-center gap-0.5 pt-1.5 text-xs font-bold no-underline',
                  isActive ? 'text-accent' : 'text-muted',
                )}
              >
                {isActive && <span className="absolute top-0 h-[3px] w-8 rounded-b-full bg-accent" />}
                <Icon size={24} />
                {label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
