// Makes the committed demo trip from a private trip file:
//   npm run demo-trip -- [input=my-trip.json] [output=demo/trip.demo.json]
//
// Every calendar date moves by the same random number of whole weeks (so
// weekdays stay the same) and all free-text notes are dropped. The offset is
// never printed or stored, so the real dates can't be recovered from the output.
// The offset lands the trip 10–80 weeks later: still inside the validity window
// of the current entry rules, so tests on the demo trip stay meaningful.
import { randomInt } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { shiftDates } from '../src/trip/shift';

const [input = 'my-trip.json', output = 'demo/trip.demo.json'] = process.argv.slice(2);
const days = randomInt(10, 81) * 7;
const DROP = new Set(['note', 'entryNote', 'private']);

const trip = shiftDates(JSON.parse(readFileSync(input, 'utf8')), days, DROP) as Record<string, unknown>;
const demo = {
  ...trip,
  demo: true,
  trip: { ...(trip.trip as object), title: 'Demo trip' },
};

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(demo, null, 2) + '\n');
console.log(`Wrote ${output} (dates shifted by a random number of weeks, notes removed).`);
