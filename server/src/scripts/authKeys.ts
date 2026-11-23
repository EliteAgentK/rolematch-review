// The keys for a sign-in service we run ourselves (docs/architecture/DESIGN_JOHANNESBURG_MOVE.md, C8):
//   node src/scripts/authKeys.js <folder> <issuer>
// writes, each readable by its owner only, and never over an existing file:
//   jwt_keys.json     the private signing key, as the sign-in service reads it (GOTRUE_JWT_KEYS): one P-256 key, ES256, as Supabase's own are
//   jwt_secret        the shared secret the sign-in service still requires (GOTRUE_JWT_SECRET); nothing of ours signs or accepts tokens with it
//   service_role.jwt  the key the server uses as SUPABASE_SERVICE_ROLE_KEY: a service_role token signed with the private key
//   anon.jwt          the public role's token, for completeness; RoleMatch's browser never holds one
// Only Node's own crypto. The private key is printed nowhere; the folder is meant to be root-only (/etc/rolematch/next/).
import { generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const TEN_YEARS = 10 * 365 * 86_400;

export function makeAuthKeys(issuer: string, now = Math.floor(Date.now() / 1000)) {
  if (!/^https?:\/\/[^\s/]+/.test(issuer)) throw new Error("the issuer must be the sign-in service's address, such as http://127.0.0.1:9998");
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const kid = randomUUID(), jwk = { ...(privateKey.export({ format: "jwk" }) as Record<string, unknown>), kid, alg: "ES256", use: "sig", key_ops: ["sign", "verify"], ext: true };
  const token = (role: string) => {
    const head = `${b64url({ alg: "ES256", typ: "JWT", kid })}.${b64url({ iss: issuer, role, iat: now, exp: now + TEN_YEARS })}`;
    return `${head}.${sign("sha256", Buffer.from(head), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
  };
  return { jwtKeys: JSON.stringify([jwk]), jwtSecret: randomBytes(48).toString("base64url"), serviceRole: token("service_role"), anon: token("anon"), kid };
}

export function writeAuthKeys(folder: string, issuer: string) {
  const files = { "jwt_keys.json": "", jwt_secret: "", "service_role.jwt": "", "anon.jwt": "" };
  for (const f of Object.keys(files)) if (existsSync(join(folder, f))) throw new Error(`${f} already exists in ${folder}: keys are never replaced by this script (a new key signs everyone out)`);
  const k = makeAuthKeys(issuer);
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  writeFileSync(join(folder, "jwt_keys.json"), k.jwtKeys, { mode: 0o600 });
  writeFileSync(join(folder, "jwt_secret"), k.jwtSecret, { mode: 0o600 });
  writeFileSync(join(folder, "service_role.jwt"), k.serviceRole, { mode: 0o600 });
  writeFileSync(join(folder, "anon.jwt"), k.anon, { mode: 0o600 });
  return k.kid;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [folder, issuer] = process.argv.slice(2);
  if (!folder || !issuer) { console.error("usage: authKeys <folder> <issuer>"); process.exit(2); }
  const kid = writeAuthKeys(folder, issuer);
  console.log(`keys written to ${folder} (key id ${kid}); nothing secret printed`);
}
