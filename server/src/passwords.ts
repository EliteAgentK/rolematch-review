// Passwords as argon2id, built into Node 24, in the standard PHC text form. One place for the console's owner account and for our own sign-in
// (docs/database/20_IDENTITY_V1.md). The cost is above OWASP's minimum for argon2id; 05_IDENTITY.md asks for it to be measured under load on the PC
// before many people sign in at once, because each check holds 64 MiB while it runs.
import { argon2, randomBytes, timingSafeEqual } from "node:crypto";

const COST = { memory: 65536, passes: 3, parallelism: 1, tagLength: 32 };   // 64 MiB, 3 passes
const b64 = (b: Buffer) => b.toString("base64").replace(/=+$/, "");
const derive = (message: string, nonce: Buffer, p = COST) =>
  new Promise<Buffer>((ok, fail) => argon2("argon2id", { message, nonce, ...p }, (e, key) => (e ? fail(e) : ok(key))));

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  return `$argon2id$v=19$m=${COST.memory},t=${COST.passes},p=${COST.parallelism}$${b64(salt)}$${b64(await derive(password, salt))}`;
}
export async function verifyPassword(password: string, phc: string) {
  const m = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/.exec(phc);
  if (!m) return false;
  const want = Buffer.from(m[5], "base64");
  const got = await derive(password, Buffer.from(m[4], "base64"), { memory: +m[1], passes: +m[2], parallelism: +m[3], tagLength: want.length });
  return got.length === want.length && timingSafeEqual(got, want);
}
