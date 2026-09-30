import { Dexie, type EntityTable } from 'dexie';
import type { Bytes } from '../crypto/bytes';
import type { Expense } from '../money/expenses';
import type { Booking, Day, Stay } from '../trip/schema';

/** Small key/value rows: settings, vault key material, emergency card, timestamps. */
export interface MetaRow {
  key: string;
  value: unknown;
}

/** An encrypted JSON record. `id` doubles as the AES-GCM context. */
export interface VaultRow {
  id: string;
  iv: Bytes;
  ct: Bytes;
}

/** An encrypted file. Name and type are encrypted separately from the bytes. */
export interface BlobRow {
  id: string;
  owner: string;
  size: number;
  iv: Bytes;
  ct: Bytes;
  metaIv: Bytes;
  metaCt: Bytes;
}

/**
 * Plaintext index of a vault document: only what's needed to warn about
 * expiry and link it to a trip item while the vault is locked.
 * Title, number, notes and files live encrypted in `vault` / `blobs`.
 */
export interface DocIndexRow {
  id: string;
  type: string;
  expiresAt?: string;
  stayId?: string;
  bookingId?: string;
  fileIds: string[];
  createdAt: string;
  updatedAt: string;
}

/** What the traveller did with a prep item. */
export interface PrepStateRow {
  id: string;
  status: 'done' | 'snoozed' | 'not-needed';
  snoozedUntil?: string;
  updatedAt: string;
}

export class AppDB extends Dexie {
  meta!: EntityTable<MetaRow, 'key'>;
  vault!: EntityTable<VaultRow, 'id'>;
  blobs!: EntityTable<BlobRow, 'id'>;
  docs!: EntityTable<DocIndexRow, 'id'>;
  // The itinerary is kept readable on the phone so checks run while the vault is locked.
  stays!: EntityTable<Stay, 'id'>;
  bookings!: EntityTable<Booking, 'id'>;
  days!: EntityTable<Day, 'date'>;
  prepState!: EntityTable<PrepStateRow, 'id'>;
  expenses!: EntityTable<Expense, 'id'>;

  constructor(name = 'travel-companion') {
    super(name);
    this.version(1).stores({
      meta: '&key',
      vault: '&id',
      blobs: '&id, owner',
      docs: '&id, type, expiresAt',
    });
    this.version(2).stores({
      stays: '&id, from',
      bookings: '&id, status',
      days: '&date',
      prepState: '&id',
    });
    this.version(3).stores({
      expenses: '&id, date, country',
    });
  }
}

export const DB_NAME = 'travel-companion';
export const DEMO_DB_NAME = 'travel-companion-demo';
const DEMO_FLAG = 'tc-demo';

/**
 * Demo mode uses its own database, so exploring with sample data never
 * touches your own. It's remembered per browser; `?demo` in the URL turns it on.
 */
function readDemoFlag(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (new URLSearchParams(window.location.search).has('demo')) window.localStorage.setItem(DEMO_FLAG, '1');
    return window.localStorage.getItem(DEMO_FLAG) === '1';
  } catch {
    return false;
  }
}

export function setDemoFlag(on: boolean): void {
  try {
    if (on) window.localStorage.setItem(DEMO_FLAG, '1');
    else window.localStorage.removeItem(DEMO_FLAG);
  } catch {
    // Storage blocked: demo mode can't be remembered, so it stays off.
  }
}

export const isDemo = readDemoFlag();

export const db = new AppDB(isDemo ? DEMO_DB_NAME : DB_NAME);

export async function getMeta(key: string): Promise<unknown> {
  return (await db.meta.get(key))?.value;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}

export const META = {
  vaultKeys: 'vaultKeys',
  settings: 'settings',
  emergencyCard: 'emergencyCard',
  lastBackupAt: 'lastBackupAt',
  profile: 'profile',
  trip: 'trip',
  /** Deleted trip items (for merging with a companion's copy). */
  tripDeleted: 'tripDeleted',
  /** The trip code shared with a travel companion. */
  shareCode: 'shareCode',
  /** { lastSentAt, lastReceivedAt, receivedShareAt, unsent } for the Travelling together status. */
  shareStatus: 'shareStatus',
} as const;

/** Deletes every row in every table (the schema itself stays). */
export async function eraseAllData(): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
  });
}
