import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseTripFile, type TripData } from '../../src/trip/io';
import {
  decryptShare,
  encryptShare,
  InvalidShareError,
  isValidCode,
  mergeTrip,
  shareBytesFrom,
  shareText,
  newTripCode,
  sharePayload,
  SharePayload,
  WrongTripCodeError,
} from '../../src/trip/share';
import { Expense } from '../../src/money/schema';

const FAST = 1_000;
const T1 = '2026-10-01T10:00:00.000Z';
const T2 = '2026-10-02T10:00:00.000Z';
const T3 = '2026-10-03T10:00:00.000Z';

function demo(): TripData {
  const { data } = parseTripFile(JSON.parse(readFileSync('demo/trip.demo.json', 'utf8')));
  const stamp = <T extends object>(x: T) => ({ ...x, updatedAt: T1 });
  return { ...data, meta: stamp(data.meta), stays: data.stays.map(stamp), bookings: data.bookings.map(stamp), days: data.days.map(stamp) };
}

const clone = <T>(x: T): T => structuredClone(x);

describe('trip code', () => {
  it('is 12 unambiguous characters in three groups', () => {
    for (let i = 0; i < 50; i++) {
      const code = newTripCode();
      expect(code).toMatch(/^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
      expect(isValidCode(code.toLowerCase().replace(/-/g, ' '))).toBe(true);
    }
    expect(isValidCode('ABCD-EFGH-IJK1')).toBe(false); // I and 1 aren't used
  });
});

describe('what is shared', () => {
  it('takes passport stamps along, but leaves out linked documents, private notes and "just me" bookings', () => {
    const t = demo();
    t.stays[0] = { ...t.stays[0]!, stampedUntil: '2030-01-01' };
    t.bookings[0] = { ...t.bookings[0]!, documentIds: ['doc-1'], myNote: 'seat 12A' };
    t.bookings[1] = { ...t.bookings[1]!, who: 'me' };
    const p = sharePayload(t, {});
    expect(p.stays[0]!.stampedUntil).toBe('2030-01-01');
    expect(p.bookings.find((b) => b.id === t.bookings[0]!.id)).toMatchObject({ documentIds: [] });
    expect(p.bookings.find((b) => b.id === t.bookings[0]!.id)?.myNote).toBeUndefined();
    expect(p.bookings.some((b) => b.id === t.bookings[1]!.id)).toBe(false);
  });
});

describe('merging', () => {
  it('fills an empty phone with the whole shared trip', () => {
    const { data, stats } = mergeTrip(null, {}, sharePayload(demo(), {}));
    expect(data.stays).toHaveLength(7);
    expect(stats.added).toBe(7 + demo().bookings.length + 90);
  });

  it('newer edits win (passport stamps too), and private fields on this phone are kept', () => {
    const mine = demo();
    mine.bookings[0] = { ...mine.bookings[0]!, documentIds: ['my-ticket'], myNote: 'mine' };

    const theirs = clone(demo());
    theirs.stays[3] = { ...theirs.stays[3]!, entryType: 'e-visa', stampedUntil: '2029-01-01', updatedAt: T2 };
    theirs.bookings[0] = { ...theirs.bookings[0]!, status: 'booked', confirmation: 'ABC123', updatedAt: T2 };
    theirs.bookings[2] = { ...theirs.bookings[2]!, status: 'idea', updatedAt: T1 }; // not newer: ignored

    const { data, stats } = mergeTrip(mine, {}, sharePayload(theirs, {}));
    expect(stats).toEqual({ added: 0, updated: 2, removed: 0 });
    expect(data.stays[3]).toMatchObject({ entryType: 'e-visa', stampedUntil: '2029-01-01' });
    expect(data.bookings[0]).toMatchObject({ status: 'booked', confirmation: 'ABC123', documentIds: ['my-ticket'], myNote: 'mine' });
    expect(data.bookings[2]!.status).toBe(mine.bookings[2]!.status);
  });

  it('keeps my newer edit over their older one', () => {
    const mine = demo();
    mine.bookings[0] = { ...mine.bookings[0]!, status: 'booked', updatedAt: T3 };
    const theirs = demo();
    theirs.bookings[0] = { ...theirs.bookings[0]!, status: 'idea', updatedAt: T2 };
    expect(mergeTrip(mine, {}, sharePayload(theirs, {})).data.bookings[0]!.status).toBe('booked');
  });

  it('carries deletions over, unless the item was edited here afterwards', () => {
    const mine = demo();
    const [a, b] = [mine.bookings[0]!.id, mine.bookings[1]!.id];
    mine.bookings[1] = { ...mine.bookings[1]!, updatedAt: T3 };
    const theirs = demo();
    theirs.bookings = theirs.bookings.filter((x) => x.id !== a && x.id !== b);
    const { data, deleted, stats } = mergeTrip(mine, {}, sharePayload(theirs, { [`booking:${a}`]: T2, [`booking:${b}`]: T2 }));
    expect(data.bookings.some((x) => x.id === a)).toBe(false);
    expect(data.bookings.some((x) => x.id === b)).toBe(true);
    expect(stats.removed).toBe(1);
    expect(deleted[`booking:${a}`]).toBe(T2);
  });

  it("never touches this phone's \"just me\" bookings", () => {
    const mine = demo();
    mine.bookings.push({ ...mine.bookings[0]!, id: 'my-yoga', who: 'me', title: 'Yoga', updatedAt: T1 });
    const theirs = demo();
    const { data } = mergeTrip(mine, {}, sharePayload(theirs, { 'booking:my-yoga': T3 }));
    expect(data.bookings.find((x) => x.id === 'my-yoga')?.title).toBe('Yoga');
  });

  it('does not bring back something I deleted after their last edit', () => {
    const mine = demo();
    const id = mine.bookings[0]!.id;
    mine.bookings = mine.bookings.slice(1);
    const { data } = mergeTrip(mine, { [`booking:${id}`]: T2 }, sharePayload(demo(), {}));
    expect(data.bookings.some((x) => x.id === id)).toBe(false);
  });
});

describe('sharing money', () => {
  const exp = (id: string, extra: Partial<Expense> = {}): Expense =>
    Expense.parse({ id, date: '2031-03-01', amount: 10, currency: 'EUR', category: 'food', country: 'JP', createdAt: T1, updatedAt: T1, ...extra });

  it('expenses, budgets and names travel with the trip; newer edits win; deletions carry over', () => {
    const mine = { expenses: [exp('both-edit', { amount: 10 }), exp('only-mine'), exp('deleted-there')], budgets: { values: { JP: 50 }, updatedAt: T1 } };
    const theirs = sharePayload(demo(), { 'expense:deleted-there': T2 }, {
      expenses: [exp('both-edit', { amount: 12, updatedAt: T2 }), exp('only-theirs', { forWhom: 'b' })],
      budgets: { values: { JP: 60, VN: 30 }, updatedAt: T2 },
      travellers: { a: 'Alex', b: 'Robin', updatedAt: T2 },
    });
    const { phone: money, deleted } = mergeTrip(demo(), {}, theirs, mine);
    expect(money.expenses.map((e) => [e.id, e.amount]).sort()).toEqual([
      ['both-edit', 12],
      ['only-mine', 10],
      ['only-theirs', 10],
    ]);
    expect(deleted['expense:deleted-there']).toBe(T2);
    expect(money.budgets).toEqual({ values: { JP: 60, VN: 30 }, updatedAt: T2 });
    // Names set on one phone are taken over by the other.
    expect(money.travellers).toMatchObject({ a: 'Alex', b: 'Robin' });
  });

  it('when the other phone has the names the other way round, its expenses stay with the right person', () => {
    const mine = { expenses: [], travellers: { a: 'Alex', b: 'Robin', updatedAt: T1 } };
    const theirs = sharePayload(demo(), {}, {
      expenses: [exp('robin-sim', { forWhom: 'a', category: 'esim' }), exp('together', { forWhom: 'both' })],
      travellers: { a: 'Robin', b: 'Alex', updatedAt: T3 },
    });
    const { phone: money } = mergeTrip(demo(), {}, theirs, mine);
    expect(money.expenses.find((e) => e.id === 'robin-sim')!.forWhom).toBe('b');
    expect(money.expenses.find((e) => e.id === 'together')!.forWhom).toBe('both');
    expect(money.travellers).toMatchObject({ a: 'Alex', b: 'Robin' });
  });

  it('a share from an older version (no money in it) leaves this phone\'s money alone', () => {
    const old = { ...sharePayload(demo(), {}) } as Record<string, unknown>;
    delete old.expenses;
    const mine = { expenses: [exp('kept')], budgets: { values: { JP: 50 }, updatedAt: T1 }, travellers: { a: 'Alex', b: 'Robin', updatedAt: T1 } };
    const { phone: money } = mergeTrip(demo(), {}, SharePayload.parse(old), mine);
    expect(money).toMatchObject(mine);
  });
});

describe('sharing ticks and small settings', () => {
  it('checklist and packing ticks travel; unticking carries over; own rates and the address card too', () => {
    const tick = (id: string, updatedAt: string) => ({ id, status: 'done' as const, updatedAt });
    const mine = { expenses: [], prep: [tick('pack-sunscreen', T1), tick('form-x', T1)], extras: { rateOverrides: { value: { LAK: 24000 }, updatedAt: T1 } } };
    const theirs = sharePayload(demo(), { 'prep:form-x': T2 }, {
      expenses: [],
      prep: [tick('pd-clinic', T2)],
      extras: { rateOverrides: { value: { LAK: 25000 }, updatedAt: T2 }, showCardAddress: { value: 'ບ້ານ ວັດແສນ', updatedAt: T2 } },
    });
    const { phone } = mergeTrip(demo(), {}, theirs, mine);
    expect(phone.prep!.map((p) => p.id).sort()).toEqual(['pack-sunscreen', 'pd-clinic']);
    expect(phone.extras).toEqual({
      rateOverrides: { value: { LAK: 25000 }, updatedAt: T2 },
      showCardAddress: { value: 'ບ້ານ ວັດແສນ', updatedAt: T2 },
    });
  });
});

describe('share file', () => {
  it('round-trips with the trip code and reveals nothing without it', async () => {
    const payload = sharePayload(demo(), {});
    const code = newTripCode();
    const bytes = new Uint8Array(await (await encryptShare(payload, code, FAST)).arrayBuffer());
    const text = new TextDecoder('latin1').decode(bytes);
    for (const needle of ['Tokashiki', 'Hanoi', 'Friendship Bridge']) expect(text).not.toContain(needle);

    const typed = code.toLowerCase().replace(/-/g, ' ');
    expect((await decryptShare(bytes, typed)).payload).toEqual(payload);
    await expect(decryptShare(bytes, newTripCode())).rejects.toBeInstanceOf(WrongTripCodeError);
  });

  it('travels as one chat message: compact, and survives line breaks added by chat apps', async () => {
    const payload = sharePayload(demo(), {});
    const code = newTripCode();
    const bytes = new Uint8Array(await (await encryptShare(payload, code, FAST)).arrayBuffer());
    const text = shareText(bytes);
    expect(text.length).toBeLessThan(12_000); // WhatsApp allows ~65,000 characters
    const mangled = `Forwarded:\n${text.replace(/(.{60})/g, '$1\n')}\nsent from my phone`;
    expect((await decryptShare(shareBytesFrom(mangled), code)).payload).toEqual(payload);
    // A text file with the message, and the binary form, work too.
    expect(shareBytesFrom(new TextEncoder().encode(text))).toEqual(bytes);
    expect(shareBytesFrom(bytes)).toEqual(bytes);
    expect(() => shareBytesFrom('hello')).toThrow(InvalidShareError);
  });
});
