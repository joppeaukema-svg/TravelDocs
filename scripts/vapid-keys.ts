// Prints a new VAPID key pair for the push worker (see README → Push notifications).
import { generateVapidKeys } from '../push/src/webpush';

const { publicKey, privateKey } = await generateVapidKeys();
console.log(`VAPID_PUBLIC_KEY  = ${publicKey}`);
console.log(`VAPID_PRIVATE_KEY = ${privateKey}   (secret: never commit it)`);
