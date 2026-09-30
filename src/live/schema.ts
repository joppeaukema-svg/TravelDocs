import { z } from 'zod';

/** Plain text from the advice's HTML: a heading, paragraph or list item. */
export const Block = z.object({ type: z.enum(['h', 'p', 'li']), text: z.string() });
export type Block = z.infer<typeof Block>;

export const Representation = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  embassy: z.boolean(),
  address: z.array(z.string()),
  phones: z.array(z.string()),
  contact: z.array(z.object({ title: z.string(), blocks: z.array(Block) })),
  openingTimes: z.array(Block),
  serves: z.array(z.string()),
  lat: z.number().optional(),
  lon: z.number().optional(),
  lastModified: z.string(),
});
export type Representation = z.infer<typeof Representation>;

export const Advice = z.object({
  country: z.string(),
  url: z.string(),
  lastModified: z.string(),
  modification: z.string(),
  /** Colour codes mentioned in the summary, most severe first. */
  colours: z.array(z.enum(['red', 'orange', 'yellow', 'green'])),
  summary: z.array(Block),
  sections: z.array(z.object({ title: z.string(), parts: z.array(z.object({ title: z.string(), blocks: z.array(Block) })) })),
  maps: z.array(z.object({ file: z.string(), type: z.string(), title: z.string() })),
  representations: z.array(Representation),
  /** Changes when the summary or any section changes. */
  hash: z.string(),
});
export type Advice = z.infer<typeof Advice>;

export const AdviceFile = z.object({ fetchedAt: z.string(), countries: z.array(Advice) });
export type AdviceFile = z.infer<typeof AdviceFile>;

export const RatesFile = z.object({
  fetchedAt: z.string(),
  base: z.literal('EUR'),
  /** Units of each currency per 1 EUR. */
  rates: z.record(z.string(), z.number().positive()),
  providerUpdated: z.string(),
  source: z.object({ title: z.string(), url: z.string() }),
});
export type RatesFile = z.infer<typeof RatesFile>;
