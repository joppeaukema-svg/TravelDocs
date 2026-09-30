import { z } from 'zod';

export const isoDate = z.iso.date();

export const countryCode = z.string().regex(/^[A-Z]{2}$/, 'ISO 3166-1 alpha-2 code, e.g. "JP"');
export type CountryCode = z.infer<typeof countryCode>;

export const Source = z.object({
  title: z.string().min(1),
  url: z.url({ protocol: /^https$/ }),
});
export type Source = z.infer<typeof Source>;

const sourced = {
  sources: z.array(Source).min(1, 'Every fact needs at least one source'),
  verifiedAt: isoDate,
  unverified: z.boolean().optional(),
};

export const FactTopic = z.enum([
  'entry', 'forms', 'safety', 'emergency', 'health', 'laws', 'money',
  'transport', 'connectivity', 'culture', 'weather', 'holidays', 'apps',
]);

export const Fact = z.object({
  id: z.string().min(1),
  country: z.union([countryCode, z.literal('GLOBAL')]),
  topic: FactTopic,
  title: z.string().min(1),
  body: z.string().min(1),
  severity: z.enum(['info', 'important', 'critical']).optional(),
  ...sourced,
});
export type Fact = z.infer<typeof Fact>;

export const EmergencyNumber = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  number: z.string().regex(/^\+?[0-9][0-9 ]*$/),
  kind: z.enum(['phone', 'whatsapp']).default('phone'),
  note: z.string().optional(),
  ...sourced,
});
export type EmergencyNumber = z.infer<typeof EmergencyNumber>;

export const CountryContent = z.object({
  country: countryCode,
  iso3: z.string().regex(/^[A-Z]{3}$/),
  name: z.string().min(1),
  timeZone: z.string().min(1),
  currency: z.string().regex(/^[A-Z]{3}$/),
  adviceUrl: z.url(),
  emergencyNote: z.string().optional(),
  emergencyNumbers: z.array(EmergencyNumber),
  facts: z.array(Fact),
});
export type CountryContent = z.infer<typeof CountryContent>;

export const GlobalContent = z.object({
  country: z.literal('GLOBAL'),
  emergencyNumbers: z.array(EmergencyNumber),
  facts: z.array(Fact),
});
export type GlobalContent = z.infer<typeof GlobalContent>;

/** content/sources.json: the official links per country and topic. */
export const SourceLink = Source.extend({
  topic: FactTopic,
  verifiedAt: isoDate,
  unverified: z.boolean().optional(),
});
export type SourceLink = z.infer<typeof SourceLink>;

export const SourcesFile = z.record(z.union([countryCode, z.literal('GLOBAL')]), z.array(SourceLink));
export type SourcesFile = z.infer<typeof SourcesFile>;

/** content/phrases.json */
export const PhraseLang = z.enum(['zh', 'ja', 'vi', 'th', 'lo', 'fil']);
export type PhraseLang = z.infer<typeof PhraseLang>;

export const PhrasesFile = z.object({
  note: z.string(),
  languages: z.record(PhraseLang, z.object({ name: z.string(), speech: z.string(), countries: z.array(countryCode), note: z.string().optional() })),
  phrases: z.array(z.object({ id: z.string(), en: z.string(), t: z.record(PhraseLang, z.object({ text: z.string(), roman: z.string().optional() })) })),
  cards: z.array(z.object({ id: z.string(), en: z.string(), t: z.record(PhraseLang, z.string()) })),
  allergens: z.array(z.object({ id: z.string(), en: z.string(), t: z.record(PhraseLang, z.string()) })),
});
export type PhrasesFile = z.infer<typeof PhrasesFile>;

/** content/packing.json: the packing template. */
export const PackingItem = z.object({
  id: z.string(),
  title: z.string(),
  /** Only when the route includes one of these countries. */
  countries: z.array(countryCode).optional(),
  /** Only when this profile flag is set. */
  flag: z.string().optional(),
  /** The sourced facts that explain why. */
  factIds: z.array(z.string()).optional(),
});
export type PackingItem = z.infer<typeof PackingItem>;
export const PackingFile = z.object({ items: z.array(PackingItem) });
