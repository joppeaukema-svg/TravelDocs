import rawPacking from '../../content/packing.json';
import rawPhrases from '../../content/phrases.json';
import rawSources from '../../content/sources.json';
import {
  CountryContent,
  GlobalContent,
  PackingFile,
  PhrasesFile,
  SourcesFile,
  type CountryCode,
  type Fact,
  type PackingItem,
  type SourceLink,
} from './schema';

// Every file in content/countries is bundled; adding a country means adding a file.
const files = import.meta.glob<unknown>('/content/countries/*.json', { eager: true, import: 'default' });

const countries = new Map<CountryCode, CountryContent>();
let global: GlobalContent = { country: 'GLOBAL', emergencyNumbers: [], facts: [] };

for (const [path, raw] of Object.entries(files)) {
  if (path.endsWith('/global.json')) {
    global = GlobalContent.parse(raw);
  } else {
    const parsed = CountryContent.parse(raw);
    countries.set(parsed.country, parsed);
  }
}

export function allCountries(): CountryContent[] {
  return [...countries.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function getCountry(code: CountryCode | null | undefined): CountryContent | undefined {
  return code ? countries.get(code) : undefined;
}

export function globalContent(): GlobalContent {
  return global;
}

const sources = SourcesFile.parse(rawSources);

/** Official links for a country (or 'GLOBAL'). */
export function officialLinks(code: CountryCode | 'GLOBAL'): SourceLink[] {
  return sources[code] ?? [];
}

const phrases = PhrasesFile.parse(rawPhrases);
export function phrasebook(): PhrasesFile {
  return phrases;
}

const packing = PackingFile.parse(rawPacking);
export function packingTemplate(): PackingItem[] {
  return packing.items;
}

/** Every fact, country and global, by id. */
export function factById(id: string): Fact | undefined {
  for (const c of [...countries.values(), global]) {
    const f = c.facts.find((x) => x.id === id);
    if (f) return f;
  }
  return undefined;
}
