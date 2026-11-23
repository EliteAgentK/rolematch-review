// Who is really asking. Registers R105 and R106: behind a proxy the address comes only from the header that proxy overwrites, never from one a visitor can write, and Supabase's sign-in limits count each visitor rather than this one server.
import { AsyncLocalStorage } from "node:async_hooks";
import { isIP } from "node:net";
import { config } from "./config";

const current = new AsyncLocalStorage<string>();
export const asVisitor = <T>(ip: string, run: () => T): T => current.run(ip, run);

/** A visitor's address. CLIENT_IP_HEADER names a header the proxy always overwrites (Cloudflare's cf-connecting-ip). Cloudflare only adds to x-forwarded-for, so its first value is whatever the visitor sent: it is used only behind a proxy that replaces it (Caddy), and never when a named header is configured. */
export function visitorAddress(headers: Headers, socketIp: string): string {
  const given = config.clientIpHeader ? headers.get(config.clientIpHeader)?.trim() : config.trustProxy ? headers.get("x-forwarded-for")?.split(",")[0].trim() : "";
  return given || socketIp;
}

const LOOPBACK = /^(?:127\.|::1$|::ffff:127\.)/;
/** Tells Supabase whose request this is. It accepts this only with a secret key and only with IP forwarding switched on for the project; otherwise it is ignored, and every visitor shares this server's limits. */
export function forwardVisitor(key: string, header = config.authForwardHeader): Record<string, string> {
  const ip = current.getStore();
  if (!ip || !isIP(ip) || LOOPBACK.test(ip)) return {};
  // A sign-in service we run ourselves reads the address from the header it was told to trust (AUTH_FORWARD_HEADER); Supabase's own, from its header.
  if (header) return { [header]: ip };
  return key.startsWith("sb_secret_") ? { "sb-forwarded-for": ip } : {};
}
