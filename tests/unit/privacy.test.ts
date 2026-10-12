import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The repo holds code, public content and fake demo data only. These checks
// stop a real itinerary or backup from being committed by accident.

function trackedFiles(): string[] | null {
  try {
    return execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch {
    return null;
  }
}

const files = trackedFiles();

describe.skipIf(files === null)('no personal data in git', () => {
  it('does not track the private itinerary, the brief or backups', () => {
    const forbidden = files!.filter(
      (f) => /(^|\/)my-trip\.json$/.test(f) || /travel-app-brief\.md$/.test(f) || /\.tcbackup$/.test(f) || f.startsWith('private/'),
    );
    expect(forbidden).toEqual([]);
  });

  it('only tracks trip files that are marked as demo data and carry no notes', () => {
    for (const f of files!.filter((f) => f.endsWith('.json'))) {
      const text = readFileSync(f, 'utf8');
      if (!text.includes('travel-companion-trip/')) continue;
      const trip = JSON.parse(text) as Record<string, unknown>;
      expect(trip.demo, `${f} must be demo data`).toBe(true);
      expect(trip.private, `${f} is marked private`).toBeUndefined();
      expect(text, `${f} contains free-text notes`).not.toMatch(/"(note|entryNote)"\s*:\s*"[^"]/);
    }
  });
});

// With the private itinerary on this machine: no tracked file may contain its
// dates (they show when the traveller is away). Tests and examples use made-up
// dates; the committed demo trip is shifted by a random number of weeks.
const PRIVATE_TRIP = 'my-trip.json';

describe.skipIf(files === null || !existsSync(PRIVATE_TRIP))('no real travel dates in git', () => {
  it('no tracked file contains two or more of the real trip dates', () => {
    const trip = JSON.parse(readFileSync(PRIVATE_TRIP, 'utf8')) as {
      trip: { depart: string; return: string };
      stays: { from: string; to: string }[];
    };
    // Departure, return and every stay's first and last day.
    const anchors = new Set([trip.trip.depart, trip.trip.return, ...trip.stays.flatMap((s) => [s.from, s.to])]);
    const leaks: string[] = [];
    for (const f of files!) {
      if (f.startsWith('public/live/') || !/\.(ts|tsx|js|json|md|yml|yaml|html|css|txt)$/.test(f) || !existsSync(f)) continue;
      const text = readFileSync(f, 'utf8');
      const found = [...anchors].filter((d) => text.includes(d));
      if (found.length >= 2) leaks.push(`${f} (${found.length} dates)`);
    }
    expect(leaks).toEqual([]);
  });
});
