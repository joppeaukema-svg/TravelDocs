import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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
