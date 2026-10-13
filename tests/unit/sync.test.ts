import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import worker, { type Env, type KV } from '../../push/src/worker';
import { db, META } from '../../src/db/db';
import { saveExpense, setTravellers } from '../../src/money/expenses';
import { getSyncState, mailboxId, setSyncEnabled, syncOnce } from '../../src/sync/sync';
import { parseTripFile } from '../../src/trip/io';
import { getShareStatus, loadTrip, replaceTrip, saveDay, setPrepState, setSharedMeta } from '../../src/trip/store';

// Two phones, one after the other, through the real relay code with in-memory storage.

function memoryKV(): KV & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: async (k) => data.get(k) ?? null,
    put: async (k, v) => void data.set(k, v),
    delete: async (k) => void data.delete(k),
    list: async ({ prefix }) => ({ keys: [...data.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
  };
}

const CODE = 'K7M2-PX9R-TB4Q';
const env: Env & { SUBS: ReturnType<typeof memoryKV> } = {
  SUBS: memoryKV(),
  VAPID_SUBJECT: 'https://example.github.io/TravelDocs/',
  ALLOWED_ORIGIN: 'https://example.github.io',
};
const relay = {
  url: 'https://relay.example.workers.dev',
  fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
    const { cache: _c, ...rest } = init ?? {};
    return worker.fetch(new Request(input, rest), env);
  }) as typeof fetch,
};

async function newPhone() {
  await db.delete();
  await db.open();
  await db.meta.put({ key: META.shareCode, value: CODE.replace(/-/g, '') });
}

describe('automatic sync', () => {
  beforeEach(() => env.SUBS.data.clear());

  it('phone B gets everything phone A filled in; the relay only ever sees ciphertext', { timeout: 60_000 }, async () => {
    // Phone A: the trip, a note, an expense with names, a tick, its own rate.
    await newPhone();
    const { data } = parseTripFile(JSON.parse(readFileSync('demo/trip.demo.json', 'utf8')));
    await replaceTrip(data);
    await saveDay('2028-03-20', 'JP', { place: 'Kyoto', note: 'Book the Hida train' });
    await setTravellers({ a: 'Alex', b: 'Robin' });
    await saveExpense({ date: '2028-03-20', amount: 12, currency: 'EUR', category: 'esim', country: 'JP', forWhom: 'b', note: 'Data top-up' });
    await setPrepState('pack-sunscreen', 'done');
    await setSharedMeta('rateOverrides', { LAK: 25000 });
    await setSyncEnabled(true, relay);
    const a = await getSyncState();
    expect(a.error).toBeUndefined();
    expect((await getShareStatus()).unsent).toBe(0);

    const mailbox = await mailboxId(CODE);
    expect(a.mailbox?.id).toBe(mailbox);
    const stored = [...env.SUBS.data.values()].join('\n');
    for (const secret of ['Book the Hida train', 'Robin', 'Data top-up', 'Kyoto', CODE.replace(/-/g, '')]) expect(stored).not.toContain(secret);

    // Phone B: only the trip code.
    await newPhone();
    await setSyncEnabled(true, relay);
    const b = await getSyncState();
    expect(b.error).toBeUndefined();
    expect(b.phone).not.toBe(a.phone);
    const trip = await loadTrip();
    expect(trip?.stays).toHaveLength(7);
    expect(trip?.days.find((d) => d.date === '2028-03-20')).toMatchObject({ place: 'Kyoto', note: 'Book the Hida train' });
    expect(await db.expenses.toArray()).toMatchObject([{ note: 'Data top-up', forWhom: 'b' }]);
    expect((await db.meta.get('travellers'))?.value).toMatchObject({ a: 'Alex', b: 'Robin' });
    expect(await db.prepState.get('pack-sunscreen')).toMatchObject({ status: 'done' });
    expect((await db.meta.get('rateOverrides'))?.value).toEqual({ LAK: 25000 });

    // B's own slot is there too, so A will pick up B's changes.
    const index = JSON.parse(env.SUBS.data.get(`sync:${mailbox}`)!) as Record<string, unknown>;
    expect(Object.keys(index).sort()).toEqual([a.phone, b.phone].sort());

    // A change on B goes up on the next round.
    await saveDay('2028-03-21', 'JP', { note: 'Nara day trip' });
    expect((await getShareStatus()).unsent).toBe(1);
    await syncOnce(relay);
    expect((await getShareStatus()).unsent).toBe(0);
    expect((await getSyncState()).lastSyncAt).toBeTruthy();

    // Turning sync off takes this phone's slot off the relay.
    await setSyncEnabled(false, relay);
    const after = JSON.parse(env.SUBS.data.get(`sync:${mailbox}`)!) as Record<string, unknown>;
    expect(Object.keys(after)).toEqual([a.phone]);
  });

  it('a phone with another trip code never sees this mailbox', { timeout: 30_000 }, async () => {
    expect(await mailboxId(CODE)).not.toBe(await mailboxId('AAAA-BBBB-CCCC'));
    expect(await mailboxId(CODE)).toBe(await mailboxId(CODE.toLowerCase().replace(/-/g, ' ')));
  });
});
