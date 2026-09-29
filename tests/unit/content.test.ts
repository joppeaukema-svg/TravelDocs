import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CountryContent, GlobalContent } from '../../src/content/schema';

const dir = 'content/countries';
const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
const load = (f: string): unknown => JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'));

describe('content', () => {
  it('has a global file and at least one country', () => {
    expect(files).toContain('global.json');
    expect(files.length).toBeGreaterThan(1);
  });

  for (const file of files) {
    it(`${file} is valid, and every fact and number has a source and a verification date`, () => {
      const parsed = file === 'global.json' ? GlobalContent.safeParse(load(file)) : CountryContent.safeParse(load(file));
      expect(parsed.success, parsed.error?.message).toBe(true);
    });
  }

  it('uses country codes that match the file names, and valid time zones', () => {
    for (const file of files.filter((f) => f !== 'global.json')) {
      const c = CountryContent.parse(load(file));
      expect(file).toBe(`${c.country.toLowerCase()}.json`);
      expect(() => new Intl.DateTimeFormat('en', { timeZone: c.timeZone })).not.toThrow();
      expect(c.emergencyNumbers.length).toBeGreaterThan(0);
    }
  });

  it('has unique ids across all content', () => {
    const ids: string[] = [];
    for (const file of files) {
      const c = load(file) as { emergencyNumbers: { id: string }[]; facts: { id: string }[] };
      ids.push(...c.emergencyNumbers.map((n) => n.id), ...c.facts.map((f) => f.id));
    }
    expect(new Set(ids).size).toBe(ids.length);
  });
});
