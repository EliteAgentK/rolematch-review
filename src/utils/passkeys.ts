// The browser's half of passkeys (docs/security/PASSKEYS.md). The device checks the person with whatever it has (Face ID, Touch ID, Windows Hello or a PIN) and tells this page only that it succeeded:
// no picture, fingerprint or private key ever reaches this code. Everything that matters is checked on the server.
const toBytes = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), (c) => c.charCodeAt(0));
const toText = (b: ArrayBuffer | ArrayBufferView | null | undefined) => {
  if (!b) return undefined;
  const bytes = b instanceof ArrayBuffer ? new Uint8Array(b) : new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const descriptors = (list?: { id: string; type?: string; transports?: AuthenticatorTransport[] }[]) => list?.map((c) => ({ ...c, type: "public-key" as const, id: toBytes(c.id) }));

export const passkeysSupported = () => typeof window !== "undefined" && !!window.PublicKeyCredential && !!navigator.credentials;

/** Cancelling, or closing the prompt, is an ordinary choice rather than a failure. */
export const passkeyCancelled = (e: unknown) => (e as DOMException)?.name === "NotAllowedError" || (e as DOMException)?.name === "AbortError";

export async function createPasskey(options: any) {
  const credential = (await navigator.credentials.create({ publicKey: { ...options, challenge: toBytes(options.challenge), user: { ...options.user, id: toBytes(options.user.id) }, excludeCredentials: descriptors(options.excludeCredentials) } })) as PublicKeyCredential | null;
  if (!credential) throw new DOMException("cancelled", "NotAllowedError");
  const r = credential.response as AuthenticatorAttestationResponse;
  return { id: credential.id, rawId: toText(credential.rawId), type: credential.type, clientExtensionResults: credential.getClientExtensionResults(), response: { clientDataJSON: toText(r.clientDataJSON), attestationObject: toText(r.attestationObject), transports: r.getTransports?.() ?? [] } };
}
export async function assertPasskey(options: any) {
  const credential = (await navigator.credentials.get({ publicKey: { ...options, challenge: toBytes(options.challenge), allowCredentials: descriptors(options.allowCredentials) } })) as PublicKeyCredential | null;
  if (!credential) throw new DOMException("cancelled", "NotAllowedError");
  const r = credential.response as AuthenticatorAssertionResponse;
  return { id: credential.id, rawId: toText(credential.rawId), type: credential.type, clientExtensionResults: credential.getClientExtensionResults(), response: { clientDataJSON: toText(r.clientDataJSON), authenticatorData: toText(r.authenticatorData), signature: toText(r.signature), userHandle: toText(r.userHandle) } };
}
