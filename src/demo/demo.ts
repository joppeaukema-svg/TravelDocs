import { Temporal } from 'temporal-polyfill';
import { db, DEMO_DB_NAME, getMeta, isDemo, setDemoFlag, setMeta } from '../db/db';
import { createDocument } from '../docs/docs';
import { refreshEmergencyCard } from '../emergency/card';
import { saveExpense, setBudget, type ExpenseCategory } from '../money/expenses';
import { saveInsurance, Insurance } from '../profile/insurance';
import { Personal, savePersonal } from '../profile/personal';
import { updateProfile } from '../profile/profile';
import { parseTripFile } from '../trip/io';
import { shiftDates } from '../trip/shift';
import { replaceTrip } from '../trip/store';
import { isVaultSetUp, lockVault, setUpVault, unlockVault } from '../vault/vault';
import { Dexie } from 'dexie';
import { META } from '../db/db';
import { readCoverageSummary } from '../profile/insurance';
import { parseProfile } from '../profile/profile';
import { buildContext } from '../rules/context';
import { runRules } from '../rules/engine';
import { setPrepState } from '../trip/store';

/** Everything in demo mode is made up. The vault opens with this passphrase. */
export const DEMO_PASSPHRASE = 'demo demo demo';
const SEEDED = 'demoSeeded';

export function enterDemo(): void {
  setDemoFlag(true);
  window.location.reload();
}

/** Leaves demo mode and throws the demo data away. */
export async function exitDemo(): Promise<void> {
  setDemoFlag(false);
  db.close();
  await Dexie.delete(DEMO_DB_NAME);
  // Drop any ?demo from the URL, then start again on your own data.
  window.history.replaceState(null, '', `${window.location.pathname}#/today`);
  window.location.reload();
}

const today = () => Temporal.Now.plainDateISO().toString();
const add = (d: string, n: number) => Temporal.PlainDate.from(d).add({ days: n }).toString();

/** The demo trip, moved (by whole weeks) so that today is about three weeks into it. */
export async function demoTrip() {
  const raw = (await import('../../demo/trip.demo.json')).default as { trip: { depart: string } };
  const offset = Temporal.PlainDate.from(raw.trip.depart).until(Temporal.PlainDate.from(add(today(), -21))).days;
  return parseTripFile(shiftDates(raw, Math.round(offset / 7) * 7)).data;
}

async function seed(): Promise<void> {
  const trip = await demoTrip();
  await replaceTrip(trip);

  // A half-finished earlier attempt may have created the vault already.
  if (!(await isVaultSetUp())) await setUpVault(DEMO_PASSPHRASE);
  await unlockVault(DEMO_PASSPHRASE);
  await createDocument({
    type: 'passport',
    expiresAt: add(today(), 3 * 365),
    secret: { title: 'Passport (demo)', number: 'XX0000000', issuer: 'Demo', issuedAt: add(today(), -2 * 365), notes: 'Sample document — not real.' },
  });
  await createDocument({
    type: 'insurance-policy',
    secret: { title: 'Travel insurance policy (demo)', number: 'DEMO-2026-001', issuer: 'Demo Insurer', issuedAt: '', notes: '' },
  });
  await saveInsurance(
    Insurance.parse({
      insurer: 'Demo Insurer',
      policyNumber: 'DEMO-2026-001',
      assistancePhone: '+31 20 000 0000',
      evacuation: 'yes',
      maxDaysPerTrip: 180,
      scooter: 'no',
      diving: 'yes',
      divingMaxDepthM: 30,
    }),
  );
  await savePersonal(
    Personal.parse({
      fullName: 'Alex Demo',
      bloodType: 'O+',
      allergies: 'Peanuts',
      iceContacts: [{ name: 'Sam Demo', relation: 'sister', phone: '+31 6 0000 0000' }],
    }),
  );
  await refreshEmergencyCard();
  await updateProfile({ flags: { diving: true, scooter: true } });
  lockVault();

  // A few days of spending where the demo traveller is now.
  const stays = [...trip.stays].sort((a, b) => a.from.localeCompare(b.from));
  const current = stays.find((s) => s.from <= today() && today() <= s.to) ?? stays[0]!;
  const currency: Record<string, string> = { CN: 'CNY', JP: 'JPY', VN: 'VND', TH: 'THB', LA: 'LAK', PH: 'PHP' };
  const perEur: Record<string, number> = { CNY: 7.6, JPY: 175, VND: 29000, THB: 38, LAK: 25000, PHP: 70 };
  const cur = currency[current.country] ?? 'EUR';
  const samples: [number, ExpenseCategory, number, string][] = [
    [0, 'food', 9, 'Street food and coffee'],
    [0, 'transport', 4, 'Grab'],
    [-1, 'stay', 28, 'Guesthouse'],
    [-1, 'food', 14, 'Dinner'],
    [-2, 'activities', 22, 'Boat trip'],
    [-2, 'food', 11, ''],
    [-3, 'shopping', 16, 'Market'],
  ];
  for (const [day, category, eur, note] of samples) {
    const date = add(today(), day);
    if (date < current.from) continue;
    const amount = Math.round(eur * (perEur[cur] ?? 1));
    await saveExpense({ date, amount, currency: cur, category, country: current.country, eur, ...(note ? { note } : {}) });
  }
  await setBudget(current.country, 60);

  // Three weeks in, the demo traveller has done what was due before today.
  const profileRaw = await getMeta(META.profile);
  const ctx = buildContext(trip, {
    today: today(),
    profile: { ...parseProfile(profileRaw).profile, passportExpiry: add(today(), 3 * 365) },
    coverage: readCoverageSummary(profileRaw),
  });
  for (const item of runRules(ctx).prep) {
    if ((item.deadline ?? item.remindOn) < today()) await setPrepState(item.id, 'done');
  }
  await setMeta(META.lastBackupAt, new Date(Date.now() - 2 * 86400_000).toISOString());
  await setMeta(SEEDED, new Date().toISOString());
}

let seeding: Promise<void> | null = null;

/** Fills the demo database the first time demo mode opens. */
export function seedDemoOnce(): Promise<void> {
  if (!isDemo) return Promise.resolve();
  seeding ??= (async () => {
    if (await getMeta(SEEDED)) return;
    await seed();
  })();
  return seeding;
}
