import { CountryContent, GlobalContent, type CountryCode } from './schema';

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
