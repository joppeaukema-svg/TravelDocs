// Checks every source URL in content/ still responds, and lists facts and
// sources whose verifiedAt is older than rules.freshnessDays.
// `npm run verify-sources` (add --offline to skip the network checks).
import { readdirSync, readFileSync } from 'node:fs';

interface Sourced { id?: string; title?: string; url?: string; sources?: { title: string; url: string }[]; verifiedAt?: string; unverified?: boolean }

const read = (p: string) => JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
const rules = read('content/rules.json') as { freshnessDays: number; sources: Record<string, Sourced> };
const today = new Date().toISOString().slice(0, 10);
const cutoff = new Date(Date.now() - rules.freshnessDays * 86400_000).toISOString().slice(0, 10);

const urls = new Map<string, string[]>(); // url → where it is used
const stale: string[] = [];
const unverified: string[] = [];

function note(where: string, item: Sourced) {
  for (const s of item.sources ?? []) urls.set(s.url, [...(urls.get(s.url) ?? []), where]);
  if (item.url) urls.set(item.url, [...(urls.get(item.url) ?? []), where]);
  if (item.verifiedAt && item.verifiedAt < cutoff) stale.push(`${where} (verified ${item.verifiedAt})`);
  if (item.unverified) unverified.push(where);
}

for (const f of readdirSync('content/countries').filter((x) => x.endsWith('.json'))) {
  const c = read(`content/countries/${f}`) as { facts: Sourced[]; emergencyNumbers: Sourced[] };
  for (const x of [...c.facts, ...c.emergencyNumbers]) note(`${f}: ${x.id}`, x);
}
for (const [id, s] of Object.entries(rules.sources)) note(`rules.json: ${id}`, s);
for (const [country, links] of Object.entries(read('content/sources.json') as Record<string, Sourced[]>)) {
  for (const l of links) note(`sources.json: ${country} ${l.title}`, l);
}

async function check(url: string): Promise<string | null> {
  const opts = { redirect: 'follow' as const, signal: AbortSignal.timeout(20_000), headers: { 'User-Agent': 'Mozilla/5.0 (TravelDocs verify-sources)' } };
  try {
    let res = await fetch(url, { ...opts, method: 'HEAD' });
    if (res.status >= 400) res = await fetch(url, { ...opts, method: 'GET' });
    if (res.status >= 400) return `HTTP ${res.status}`;
    return null;
  } catch (e) {
    return (e as Error).name === 'TimeoutError' ? 'timeout' : (e as Error).message;
  }
}

const offline = process.argv.includes('--offline');
let broken = 0;
if (!offline) {
  const list = [...urls.keys()];
  const results: [string, string | null][] = [];
  for (let i = 0; i < list.length; i += 8) {
    const batch = list.slice(i, i + 8);
    results.push(...(await Promise.all(batch.map(async (u) => [u, await check(u)] as [string, string | null]))));
  }
  for (const [url, err] of results) {
    if (!err) continue;
    // Only "gone" counts as broken. Blocks (401/403/429), server errors and
    // timeouts are common for government sites seen from a data centre.
    const blocked = !/HTTP (404|410)|ENOTFOUND|fetch failed/.test(err);
    if (!blocked) broken++;
    console.log(`${blocked ? 'CHECK BY HAND' : 'BROKEN'}  ${url}  (${err})\n    used by: ${urls.get(url)!.join(', ')}`);
  }
  console.log(`\nChecked ${list.length} URLs on ${today}: ${broken} broken.`);
}

console.log(`\n${stale.length} items verified more than ${rules.freshnessDays} days ago:`);
for (const s of stale) console.log(`  ${s}`);
console.log(`\n${unverified.length} items marked unverified (shown with a warning in the app):`);
for (const s of unverified) console.log(`  ${s}`);

process.exitCode = broken ? 1 : 0;
