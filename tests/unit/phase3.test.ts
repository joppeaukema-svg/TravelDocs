import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { allCountries, factById, globalContent, packingTemplate, phrasebook } from '../../src/content';
import { PackingFile, PhraseLang, PhrasesFile, SourcesFile } from '../../src/content/schema';
import { AdviceFile, RatesFile, type Advice } from '../../src/live/schema';
import { adviceState, changedParts, partHashes, SUMMARY_PART, type Seen } from '../../src/live/useLive';
import { convert } from '../../src/features/money/MoneyScreen';
import { currentAndNext, describe as describeWeather, stops } from '../../src/weather/weather';
import { rulesContent } from '../../src/rules/content';
import type { TripData } from '../../src/trip/io';

const json = (p: string): unknown => JSON.parse(readFileSync(p, 'utf8'));

describe('content files', () => {
  it('sources.json lists official links for every country', () => {
    const s = SourcesFile.parse(json('content/sources.json'));
    for (const c of allCountries()) expect(s[c.country]?.length, c.country).toBeGreaterThan(0);
  });

  it('never cites a visa agency: sources are government, official or named reference sites', () => {
    const urls = [...allCountries().flatMap((c) => c.facts), ...globalContent().facts].flatMap((f) => f.sources.map((s) => s.url));
    expect(urls.filter((u) => /visa-?(agency|online|service)|evisa-vietnam|vietnamvisa|laos-?visa\.(com|org)|myvietnamvisa/i.test(u))).toEqual([]);
  });

  it('every country guide covers the main topics', () => {
    for (const c of allCountries()) {
      const topics = new Set(c.facts.map((f) => f.topic));
      for (const t of ['entry', 'safety', 'health', 'laws'] as const) expect(topics.has(t), `${c.country} ${t}`).toBe(true);
    }
  });

  it('marks facts from non-official sources as unverified', () => {
    const facts = allCountries().flatMap((c) => c.facts);
    for (const f of facts.filter((x) => x.sources.every((s) => /trip\.com|worldstandards|roughguides|tuoitre/.test(s.url)))) {
      expect(f.unverified, f.id).toBe(true);
    }
  });

  it('phrasebook has every phrase and card in every language', () => {
    const book = PhrasesFile.parse(json('content/phrases.json'));
    for (const lang of PhraseLang.options) {
      for (const p of book.phrases) expect(p.t[lang]?.text, `${p.id} ${lang}`).toBeTruthy();
      for (const c of book.cards) expect(c.t[lang], `${c.id} ${lang}`).toBeTruthy();
      for (const a of book.allergens) expect(a.t[lang], `${a.id} ${lang}`).toBeTruthy();
    }
    expect(book.cards.find((c) => c.id === 'allergic')!.t.ja).toContain('{item}');
    expect(phrasebook().languages.lo.countries).toEqual(['LA']);
  });

  it('packing items point at facts that exist', () => {
    PackingFile.parse(json('content/packing.json'));
    for (const i of packingTemplate()) for (const id of i.factIds ?? []) expect(factById(id), `${i.id} → ${id}`).toBeDefined();
  });

  it('rule sources no longer need the unverified Laos LDIF source', () => {
    expect(rulesContent.sources['la-ldif']?.unverified).toBeFalsy();
    expect(rulesContent.driving.map((d) => d.country).sort()).toEqual(['CN', 'JP', 'LA', 'PH', 'TH', 'VN']);
  });
});

describe('live data', () => {
  it('the published advice and rates files are valid', () => {
    const advice = AdviceFile.parse(json('public/live/advice.json'));
    expect(advice.countries.map((a) => a.country).sort()).toEqual(allCountries().map((c) => c.country).sort());
    for (const a of advice.countries) {
      expect(a.colours.length, a.country).toBeGreaterThan(0);
      expect(a.representations.length, a.country).toBeGreaterThan(0);
    }
    const rates = RatesFile.parse(json('public/live/rates.json'));
    for (const c of ['CNY', 'JPY', 'VND', 'THB', 'LAK', 'PHP', 'USD']) expect(rates.rates[c], c).toBeGreaterThan(0);
  });

  const advice: Advice = {
    country: 'LA',
    url: 'https://example.org',
    lastModified: '2026-09-09T00:00:00Z',
    modification: '',
    colours: ['orange', 'yellow'],
    summary: [{ type: 'p', text: 'Oranje voor Xaysomboune.' }],
    sections: [{ title: 'Veiligheid', parts: [{ title: 'Criminaliteit', blocks: [{ type: 'p', text: 'Zakkenrollers.' }] }, { title: 'Drugs', blocks: [{ type: 'p', text: 'Verboden.' }] }] }],
    maps: [],
    representations: [],
    hash: 'a',
  };

  it('knows which parts changed since you read the advice', () => {
    const seen: Seen = { LA: { hash: 'a', lastModified: advice.lastModified, at: '', parts: partHashes(advice) } };
    expect(adviceState(advice, {})).toBe('unread');
    expect(adviceState(advice, seen)).toBe('current');
    expect(changedParts(advice, seen)).toEqual([]);

    const changed: Advice = {
      ...advice,
      hash: 'b',
      summary: [{ type: 'p', text: 'Rood voor Xaysomboune.' }],
      sections: [{ ...advice.sections[0]!, parts: [advice.sections[0]!.parts[0]!, { title: 'Drugs', blocks: [{ type: 'p', text: 'Doodstraf.' }] }] }],
    };
    expect(adviceState(changed, seen)).toBe('changed');
    expect(changedParts(changed, seen)).toEqual([SUMMARY_PART, 'Veiligheid / Drugs']);
  });
});

describe('converter', () => {
  const rates: Record<string, number> = { EUR: 1, THB: 38, LAK: 25_000 };
  const rate = (c: string) => rates[c];
  it('converts through EUR', () => {
    expect(convert(38, 'THB', 'EUR', rate)).toBeCloseTo(1);
    expect(convert(100, 'THB', 'LAK', rate)).toBeCloseTo((100 / 38) * 25_000);
    expect(convert(1, 'EUR', 'XXX', rate)).toBeUndefined();
  });
});

describe('weather stops', () => {
  const trip = {
    meta: { depart: '2026-10-24', return: '2027-01-22' },
    stays: [],
    bookings: [],
    days: [
      { date: '2026-11-01', country: 'VN', place: 'Hanoi', note: '' },
      { date: '2026-11-02', country: 'VN', place: 'Hanoi', note: '' },
      { date: '2026-11-03', country: 'VN', place: 'Ninh Binh', note: '' },
      { date: '2026-11-04', country: 'VN', place: null, note: '' },
      { date: '2026-11-05', country: 'LA', place: 'Luang Prabang', note: '' },
    ],
  } as unknown as TripData;

  it('groups days into stops and picks the current and next one', () => {
    const s = stops(trip);
    expect(s.map((x) => `${x.place} ${x.from}–${x.to}`)).toEqual(['Hanoi 2026-11-01–2026-11-02', 'Ninh Binh 2026-11-03–2026-11-03', 'Luang Prabang 2026-11-05–2026-11-05']);
    expect(currentAndNext(s, '2026-10-01').map((x) => x.place)).toEqual(['Hanoi', 'Ninh Binh']);
    expect(currentAndNext(s, '2026-11-04').map((x) => x.place)).toEqual(['Luang Prabang']);
    expect(currentAndNext(s, '2027-02-01')).toEqual([]);
  });

  it('describes WMO weather codes', () => {
    expect(describeWeather(0).label).toBe('Clear');
    expect(describeWeather(95).label).toBe('Thunderstorm');
    expect(describeWeather(81).label).toBe('Rain');
  });
});
