/**
 * Web Push with nothing but WebCrypto (works in Cloudflare Workers and Node 22):
 * message encryption per RFC 8291 (aes128gcm) and VAPID per RFC 8292.
 */

export interface PushSubscriptionJSON {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface VapidKeys {
  /** Uncompressed P-256 public key (65 bytes), base64url. */
  publicKey: string;
  /** The private scalar d (32 bytes), base64url. */
  privateKey: string;
  /** Contact for push services: a mailto: or https: URL. */
  subject: string;
}

const enc = new TextEncoder();

export function b64u(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64u(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('raw', new Uint8Array(ikm), 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(salt), info: new Uint8Array(info) }, key, length * 8);
  return new Uint8Array(bits);
}

const RECORD_SIZE = 4096;

/** Encrypts a payload for one subscription (RFC 8291, a single aes128gcm record). */
export async function encrypt(
  payload: Uint8Array,
  sub: PushSubscriptionJSON,
  opts: { salt?: Uint8Array; serverKeys?: CryptoKeyPair } = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = fromB64u(sub.keys.p256dh);
  const authSecret = fromB64u(sub.keys.auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error('Invalid p256dh key');
  if (authSecret.length !== 16) throw new Error('Invalid auth secret');
  if (payload.length > RECORD_SIZE - 17 - 103) throw new Error('Payload too large');

  const server = opts.serverKeys ?? ((await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', server.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, server.privateKey, 256));

  const ikm = await hkdf(authSecret, ecdhSecret, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // 0x02 marks the last (only) record; no padding.
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(payload, new Uint8Array([2]))));

  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, ciphertext);
}

async function vapidSigningKey(keys: VapidKeys): Promise<CryptoKey> {
  const pub = fromB64u(keys.publicKey);
  return crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', d: keys.privateKey, x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), ext: false },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
}

/** The VAPID Authorization header value for a push endpoint. */
export async function vapidAuthorization(endpoint: string, keys: VapidKeys, now = Date.now()): Promise<string> {
  const header = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: keys.subject })));
  const unsigned = `${header}.${claims}`;
  // WebCrypto's ECDSA signature is already r||s, the JOSE format.
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await vapidSigningKey(keys), enc.encode(unsigned)));
  return `vapid t=${unsigned}.${b64u(sig)}, k=${keys.publicKey}`;
}

/** Sends one push message. Returns the push service's HTTP status. */
export async function sendPush(sub: PushSubscriptionJSON, payload: unknown, keys: VapidKeys, fetchImpl: typeof fetch = fetch): Promise<number> {
  const body = await encrypt(enc.encode(JSON.stringify(payload)), sub);
  const res = await fetchImpl(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuthorization(sub.endpoint, keys),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(24 * 3600),
      Urgency: 'normal',
    },
    body,
  });
  return res.status;
}

/** A fresh VAPID key pair (for `npm run vapid-keys`). */
export async function generateVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return { publicKey: b64u(raw), privateKey: jwk.d! };
}
