import type { ReactNode } from 'react';
import {
  DownloadIcon,
  GearIcon,
  GlobeIcon,
  HeartIcon,
  ListIcon,
  PersonIcon,
  PhoneIcon,
  ShieldIcon,
  SpeechIcon,
  WalletIcon,
} from '../../ui/icons';
import { Card, PageTitle, Pill, RowLink } from '../../ui/kit';

export function MoreScreen() {
  return (
    <>
      <PageTitle>More</PageTitle>
      <Card className="py-1">
        <RowLink href="#/insurance" icon={<ShieldIcon />} title="Insurance" sub="Policy, assistance line, coverage" />
        <RowLink href="#/checklists" icon={<ListIcon />} title="Checklists" sub="Prep per country, do-now list" />
        <RowLink href="#/profile" icon={<ShieldIcon />} title="Profile and bag" sub="Passport, vape, medicines, diving…" />
        <RowLink href="#/personal" icon={<PersonIcon />} title="Personal details" sub="ICE contacts, medical info" />
        <RowLink href="#/emergency" icon={<PhoneIcon />} title="Emergency card" sub="Readable while locked" />
        <RowLink href="#/backup" icon={<DownloadIcon />} title="Backup & restore" sub="One encrypted file" />
        <RowLink href="#/settings" icon={<GearIcon />} title="Settings" sub="Lock, appearance, storage" />
      </Card>
      <Card className="mt-4 py-1">
        <RowLink href="#/money" icon={<WalletIcon />} title="Money" sub="Currency converter, offline" />
        <RowLink href="#/phrases" icon={<SpeechIcon />} title="Phrases" sub="Key phrases and “show this” cards" />
        <RowLink href="#/weather" icon={<GlobeIcon />} title="Weather" sub="7-day forecast, seasons" />
        <RowLink href="#/sources" icon={<ListIcon />} title="Sources" sub="Where every fact comes from" />
      </Card>
      <p className="mt-6 flex items-center justify-center gap-1.5 text-sm text-muted">
        <HeartIcon size={16} /> Everything stays on this phone.
      </p>
    </>
  );
}

export function ComingSoon({ title, phase, children }: { title: string; phase: number; children: ReactNode }) {
  return (
    <>
      <PageTitle>{title}</PageTitle>
      <Card>
        <Pill tone="muted">Coming in phase {phase}</Pill>
        <p className="mt-3">{children}</p>
      </Card>
    </>
  );
}
