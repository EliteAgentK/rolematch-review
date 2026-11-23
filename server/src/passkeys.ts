// Optional passkey sign-in (docs/security/PASSKEYS.md). Supabase Auth owns the credentials and the WebAuthn checks: challenges (stored, short-lived, single use), origin, relying party,
// signature, signature counters, duplicate credentials and the per-person limit. RoleMatch adds what the provider leaves open, and writes no cryptography of its own:
//   - user verification is REQUIRED. The provider only prefers it, so a key without a PIN or biometric could otherwise sign in on possession alone. The flag read here is inside the
//     authenticator data the provider verifies the signature over, so a browser cannot fake it past that check;
//   - enrolment and removal need a recent sign-in;
//   - a passkey only proves who someone is. Membership, portal access and invitations are decided exactly as for a password (auth.ts).
// Nothing about the person's face or fingerprint ever reaches RoleMatch: the device checks that locally and says only yes or no.
import { config } from "./config";

class PasskeyError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }

const FLAG_USER_VERIFIED = 0x04;
const base64url = (s: unknown) => { if (typeof s !== "string" || !s) throw new PasskeyError(400, "VAL-001", "The passkey response is incomplete."); return Buffer.from(s, "base64url"); };
/** authenticator data: 32 bytes of relying-party hash, then one byte of flags. */
const flagsOf = (authData: Uint8Array) => { if (authData.length < 37) throw new PasskeyError(400, "VAL-001", "The passkey response is incomplete."); return authData[32]; };

/** Sign-in: authenticatorData is sent as it is. */
export function assertionUserVerified(credential: any): boolean {
  return (flagsOf(base64url(credential?.response?.authenticatorData)) & FLAG_USER_VERIFIED) !== 0;
}
/** Enrolment: the authenticator data sits inside the attestation object (CBOR), under the text key "authData". Only that one byte string is read; everything else is the provider's to verify. */
export function attestationUserVerified(credential: any): boolean {
  const obj = base64url(credential?.response?.attestationObject);
  const at = obj.indexOf(Buffer.from([0x68, ...Buffer.from("authData")]));
  if (at < 0) throw new PasskeyError(400, "VAL-001", "The passkey response is incomplete.");
  let i = at + 9, len: number;
  const head = obj[i++];
  if (head === 0x58) len = obj[i++];
  else if (head === 0x59) { len = obj.readUInt16BE(i); i += 2; }
  else if (head === 0x5a) { len = obj.readUInt32BE(i); i += 4; }
  else if (head >= 0x40 && head <= 0x57) len = head - 0x40;
  else throw new PasskeyError(400, "VAL-001", "The passkey response is incomplete.");
  return (flagsOf(obj.subarray(i, i + len)) & FLAG_USER_VERIFIED) !== 0;
}
/** What the browser is told to ask for. */
export const requireVerification = (b: any) => {
  const options = { ...b.options, userVerification: "required" };
  if (b.options?.authenticatorSelection) options.authenticatorSelection = { ...b.options.authenticatorSelection, userVerification: "required" };
  return { challengeId: b.challenge_id, expiresAt: b.expires_at, options };
};
/** Seconds since the person last proved who they are. Enrolment and removal need this to be short, so an unattended open session cannot quietly add or remove a way in. */
export const recentEnough = (signedInAtSec: number, nowMs = Date.now()) => nowMs / 1000 - signedInAtSec <= config.passkeyRecentMinutes * 60;
