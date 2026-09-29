import { useEffect, type ReactNode } from 'react';
import { BackupScreen } from '../features/backup/BackupScreen';
import { CountriesScreen, CountryScreen } from '../features/countries/CountriesScreen';
import { DocScreen, DocsScreen, NewDocScreen } from '../features/docs/DocsScreens';
import { EmergencyEditScreen, EmergencyScreen } from '../features/emergency/EmergencyScreens';
import { InsuranceScreen } from '../features/insurance/InsuranceScreen';
import { ComingSoon, MoreScreen } from '../features/more/MoreScreen';
import { PersonalScreen } from '../features/personal/PersonalScreen';
import { SettingsScreen } from '../features/settings/SettingsScreen';
import { TodayScreen } from '../features/today/TodayScreen';
import { ChecklistScreen, ChecklistsScreen } from '../features/checklists/ChecklistScreens';
import { ProfileScreen } from '../features/profile/ProfileScreen';
import { BookingScreen, StayScreen } from '../features/trip/EditScreens';
import { TripScreen } from '../features/trip/TripScreen';
import { useSettings } from '../settings/settings';
import { startAutoLock } from '../vault/autoLock';
import { vaultSession } from '../vault/session';
import { Header } from './Header';
import { matchPath, usePath, useVaultState } from './hooks';
import { TabBar, type Tab } from './TabBar';
import { UpdatePrompt } from './UpdatePrompt';

interface Route {
  pattern: string;
  tab: Tab | null;
  render: (params: Record<string, string>) => ReactNode;
}

// More specific patterns first.
const routes: Route[] = [
  { pattern: '/today', tab: 'today', render: () => <TodayScreen /> },
  { pattern: '/trip', tab: 'trip', render: () => <TripScreen /> },
  { pattern: '/trip/stay/:id', tab: 'trip', render: ({ id }) => <StayScreen id={id!} /> },
  { pattern: '/trip/booking/:id', tab: 'trip', render: ({ id }) => <BookingScreen id={id!} /> },
  { pattern: '/docs', tab: 'docs', render: () => <DocsScreen /> },
  { pattern: '/docs/new', tab: 'docs', render: () => <NewDocScreen /> },
  { pattern: '/docs/:id', tab: 'docs', render: ({ id }) => <DocScreen id={id!} /> },
  { pattern: '/countries', tab: 'countries', render: () => <CountriesScreen /> },
  { pattern: '/countries/:code', tab: 'countries', render: ({ code }) => <CountryScreen code={code!} /> },
  { pattern: '/more', tab: 'more', render: () => <MoreScreen /> },
  { pattern: '/insurance', tab: 'more', render: () => <InsuranceScreen /> },
  { pattern: '/personal', tab: 'more', render: () => <PersonalScreen /> },
  { pattern: '/backup', tab: 'more', render: () => <BackupScreen /> },
  { pattern: '/settings', tab: 'more', render: () => <SettingsScreen /> },
  { pattern: '/checklists', tab: 'more', render: () => <ChecklistsScreen /> },
  { pattern: '/checklists/:group', tab: 'more', render: ({ group }) => <ChecklistScreen group={group!} /> },
  { pattern: '/profile', tab: 'more', render: () => <ProfileScreen /> },
  {
    pattern: '/money',
    tab: 'more',
    render: () => (
      <ComingSoon title="Money" phase={3}>
        Offline currency converter, then expenses and daily budgets in Phase 4.
      </ComingSoon>
    ),
  },
  {
    pattern: '/phrases',
    tab: 'more',
    render: () => (
      <ComingSoon title="Phrases" phase={3}>
        Key phrases with romanisation and big “show this” cards.
      </ComingSoon>
    ),
  },
  { pattern: '/emergency', tab: null, render: () => <EmergencyScreen /> },
  { pattern: '/emergency/edit', tab: null, render: () => <EmergencyEditScreen /> },
];

function resolve(path: string): { route: Route; params: Record<string, string> } {
  for (const route of routes) {
    const params = matchPath(route.pattern, path);
    if (params) return { route, params };
  }
  return { route: routes[0]!, params: {} };
}

function useAutoLock() {
  const settings = useSettings();
  const state = useVaultState();
  useEffect(() => {
    if (state !== 'unlocked') return;
    return startAutoLock({
      idleMs: settings.autoLockMinutes * 60_000,
      backgroundGraceMs: settings.backgroundGraceSeconds * 1000,
      lock: () => vaultSession.lock(),
    });
  }, [state, settings.autoLockMinutes, settings.backgroundGraceSeconds]);
}

function useTheme() {
  const { theme } = useSettings();
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
}

export function App() {
  const path = usePath();
  const { route, params } = resolve(path);
  useAutoLock();
  useTheme();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [path]);

  return (
    <div className="flex min-h-dvh flex-col">
      <Header emergencyActive={route.pattern.startsWith('/emergency')} />
      <main className="mx-auto w-full max-w-xl flex-1 px-4 pb-32 pt-2">{route.render(params)}</main>
      <UpdatePrompt />
      <TabBar active={route.tab} />
    </div>
  );
}
