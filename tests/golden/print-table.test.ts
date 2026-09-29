// Local helper, not an assertion: `PRINT_TRIP=my-trip.json npx vitest run tests/golden/print-table.test.ts`
// writes the reminder table (to PRINT_OUT) for a trip file so it can be compared with the brief by eye.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { runRules } from '../../src/rules/engine';
import { buildContext } from '../../src/rules/context';
import { parseTripFile } from '../../src/trip/io';
import { addDays } from '../../src/rules/itinerary';

const file = process.env.PRINT_TRIP;

it.skipIf(!file || !existsSync(file))('prints the reminder table', () => {
  const { data, rejected } = parseTripFile(JSON.parse(readFileSync(file!, 'utf8')));
  const today = process.env.PRINT_TODAY ?? addDays(data.meta.depart, -25);
  const r = runRules(buildContext(data, { today }));
  const lines = [
    `rejected: ${JSON.stringify(rejected)}`,
    ...r.stays.map((s) => `STAY ${s.stay.country} ${s.stay.id}: ${s.days} d, limit ${s.limitDays}, leave by ${s.mustLeaveBy}${s.fallback ? ' (fallback)' : ''}`),
    `passport until ${r.passportRequiredUntil}`,
    ...r.checks.map((c) => `CHECK ${c.severity} [${c.rule}] ${c.title}`),
    ...r.prep.map((p) => `${p.remindOn}${p.deadline && p.deadline !== p.remindOn ? `..${p.deadline}` : ''} ${p.at.time} ${p.at.tz} | ${p.title}`),
  ];
  writeFileSync(process.env.PRINT_OUT ?? 'reminders.private.txt', lines.join('\n') + '\n');
});
