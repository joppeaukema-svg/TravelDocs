// Fetches live data for every country in content/countries and writes it to
// public/live/, which is published with the app. Run daily by
// .github/workflows/sync-live.yml; locally: `npm run sync-live`.
//
// - Dutch travel advice (NederlandWereldwijd open data, CC0): colour summary,
//   sections, last-modified date, maps
// - Dutch embassies/consulates for each country
// - Exchange rates for the currencies on the route (base EUR)
//
// HTML from the API is turned into plain structured text, so the app never
// renders markup from outside.
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { AdviceFile, RatesFile, type Advice, type Block, type Representation } from '../src/live/schema';

const API = 'https://opendata.nederlandwereldwijd.nl/v2/sources/nederlandwereldwijd/infotypes/countries';
const RATES = 'https://open.er-api.com/v6/latest/EUR';
const OUT = 'public/live';

interface CountryFile {
  country: string;
  iso3?: string;
  currency?: string;
}

const countries = readdirSync('content/countries')
  .filter((f) => f.endsWith('.json') && f !== 'global.json')
  .map((f) => JSON.parse(readFileSync(`content/countries/${f}`, 'utf8')) as CountryFile)
  .filter((c) => c.iso3);

async function get(url: string, attempt = 1): Promise<Response> {
  const res = await fetch(url, { headers: { 'User-Agent': 'TravelDocs live-data sync (github.com/joppeaukema-svg/TravelDocs)' } });
  if (!res.ok) {
    if (attempt < 3) return get(url, attempt + 1);
    throw new Error(`${url}: HTTP ${res.status}`);
  }
  return res;
}

const json = async (url: string) => (await get(url)).json() as Promise<Record<string, unknown>>;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', euro: '€', ndash: '–', mdash: '—', hellip: '…' };

function decode(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n: string) => ENTITIES[n.toLowerCase()] ?? m);
}

const clean = (html: string) => decode(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/** HTML → headings, paragraphs and list items as plain text. */
export function toBlocks(html: string): Block[] {
  const blocks: Block[] = [];
  const re = /<(h[1-6]|p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const text = clean(m[2]!);
    if (!text) continue;
    const tag = m[1]!.toLowerCase();
    blocks.push({ type: tag === 'li' ? 'li' : tag === 'p' ? 'p' : 'h', text });
  }
  if (!blocks.length && clean(html)) blocks.push({ type: 'p', text: clean(html) });
  return blocks;
}

const COLOURS = { groen: 'green', geel: 'yellow', oranje: 'orange', rood: 'red' } as const;

/** The colour codes the summary mentions, e.g. ["orange", "yellow"]. */
function colours(summary: string): Advice['colours'] {
  const found = new Set<Advice['colours'][number]>();
  for (const [nl, en] of Object.entries(COLOURS)) if (new RegExp(`\\b${nl}\\b`, 'i').test(summary)) found.add(en);
  return (['red', 'orange', 'yellow', 'green'] as const).filter((c) => found.has(c));
}

function phones(html: string): string[] {
  return [...html.matchAll(/href="tel:([^"]+)"/g)].map((m) => m[1]!.replace(/-/g, ' ').trim());
}

async function representation(summary: Record<string, unknown>): Promise<Representation> {
  const d = await json(`${String(summary.dataurl)}?output=json`);
  const detail = (Array.isArray(d) ? d[0] : d) as Record<string, unknown>;
  const contact = (detail.contactoptions as { title: string; type: string; paragraph: string }[] | undefined) ?? [];
  const map = (detail.map as { latitude: string; longitude: string }[] | undefined)?.[0];
  return {
    id: String(detail.id),
    title: String(detail.title),
    url: String(detail.canonical),
    embassy: detail.embassy === true,
    address: (detail.address as string[] | undefined) ?? [],
    phones: [...new Set(contact.flatMap((c) => phones(c.paragraph)))],
    contact: contact.map((c) => ({ title: c.title, blocks: toBlocks(c.paragraph) })),
    openingTimes: toBlocks(String(detail.consularopeningtimes ?? '')),
    serves: (detail.servicelocations as string[] | undefined) ?? [],
    ...(map ? { lat: Number(map.latitude), lon: Number(map.longitude) } : {}),
    lastModified: String(detail.lastmodified),
  };
}

async function advice(c: CountryFile): Promise<Advice> {
  const iso = c.iso3!.toLowerCase();
  const a = await json(`${API}/${iso}/traveladvice?output=json`);
  const summary = String(a.introduction ?? '');
  const content = (a.content as { category: string; contentblocks: { paragraphtitle: string; paragraph: string }[] }[]) ?? [];
  const sections = content.map((s) => ({
    title: clean(s.category),
    parts: s.contentblocks.map((b) => ({ title: clean(b.paragraphtitle ?? ''), blocks: toBlocks(b.paragraph ?? '') })),
  }));

  mkdirSync(`${OUT}/maps`, { recursive: true });
  const maps: Advice['maps'] = [];
  for (const f of (a.files as { fileurl: string; mapType?: string; filetitle?: string; mimetype?: string }[]) ?? []) {
    if (!f.mimetype?.startsWith('image/')) continue;
    const name = `${c.country.toLowerCase()}-${f.mapType ?? maps.length}.png`;
    writeFileSync(`${OUT}/maps/${name}`, Buffer.from(await (await get(f.fileurl)).arrayBuffer()));
    maps.push({ file: `maps/${name}`, type: f.mapType ?? 'map', title: f.filetitle ?? '' });
  }

  const reps = (await json(`${API}/${iso}/nl-representation?output=json`)) as unknown as Record<string, unknown>[];
  const summaryBlocks = toBlocks(summary);
  const hash = createHash('sha256')
    .update(JSON.stringify([summaryBlocks, sections]))
    .digest('hex')
    .slice(0, 16);

  return {
    country: c.country,
    url: String(a.canonical),
    lastModified: String(a.lastmodified),
    modification: clean(String(a.modifications ?? '')),
    colours: colours(clean(summary)),
    summary: summaryBlocks,
    sections,
    maps,
    representations: await Promise.all((Array.isArray(reps) ? reps : []).map(representation)),
    hash,
  };
}

async function rates() {
  const r = (await json(RATES)) as { result: string; rates: Record<string, number>; time_last_update_utc: string };
  if (r.result !== 'success') throw new Error('Rates: provider returned an error');
  const wanted = [...new Set(['EUR', 'USD', ...countries.map((c) => c.currency).filter((x): x is string => !!x)])];
  const missing = wanted.filter((c) => !r.rates[c]);
  if (missing.length) throw new Error(`Rates: no rate for ${missing.join(', ')}`);
  return {
    base: 'EUR',
    rates: Object.fromEntries(wanted.map((c) => [c, r.rates[c]!])),
    providerUpdated: new Date(r.time_last_update_utc).toISOString(),
    source: { title: 'ExchangeRate-API (open access)', url: 'https://www.exchangerate-api.com/docs/free' },
  };
}

const fetchedAt = new Date().toISOString();
const adviceFile = AdviceFile.parse({ fetchedAt, countries: await Promise.all(countries.map(advice)) });
const ratesFile = RatesFile.parse({ fetchedAt, ...(await rates()) });

mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/advice.json`, JSON.stringify(adviceFile, null, 1) + '\n');
writeFileSync(`${OUT}/rates.json`, JSON.stringify(ratesFile, null, 1) + '\n');
console.log(
  adviceFile.countries.map((c) => `${c.country}: ${c.colours.join('/')} · modified ${c.lastModified.slice(0, 10)} · ${c.representations.length} representations`).join('\n'),
);
console.log(`Rates for ${Object.keys(ratesFile.rates).join(', ')}`);
