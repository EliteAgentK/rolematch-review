// Which database a maintenance script is about to change, said before it changes anything, and refused when that is live or a database that is not on
// this machine, unless the person running it says so on purpose (code review, 16 Nov 2026, D-M5). The scripts used to write to whatever server/.env
// named, and that file points at a hosted database: `npm run migrate` tried on the Mac to test a new migration applied it there, unreleased, in one go.
//   Safe without asking: a database on this machine whose settings do not say ROLEMATCH_ENVIRONMENT=live (the local stack, a rehearsal), or one whose
//   settings say plainly it is a rehearsal, a test or development.
//   Refused unless --target-confirmed (or ROLEMATCH_TARGET_CONFIRMED=1) is given: live, and any other database not on this machine. The release and
//   recovery scripts in deploy/ that are meant to change live pass it.
// Only the address is shown, never the password.
import { config } from "../config";

export const CONFIRM_FLAG = "--target-confirmed";
const LIVE = new Set(["live", "production"]), NOT_LIVE = new Set(["rehearsal", "test", "development", "local"]);
const onThisMachine = (host: string) => host === "" || host === "localhost" || host === "::1" || host === "[::1]" || /^127\./.test(host) || host === "host.docker.internal";

export interface Target { where: string; environment: string; refuse: boolean; why: string }
/** What a database address and a ROLEMATCH_ENVIRONMENT say about where a script would write. Pure, so it is tested without a database. */
export function targetOf(databaseUrl: string, environment = ""): Target {
  let host = "", where = "an address that could not be read";
  try {
    const u = new URL(databaseUrl);
    host = u.hostname.toLowerCase();
    where = `${decodeURIComponent(u.username) || "?"}@${u.host || "(local socket)"}${u.pathname || ""}`;
  } catch { host = "?"; }
  const env = environment.trim().toLowerCase();
  if (LIVE.has(env)) return { where, environment: env, refuse: true, why: "its settings say it is live" };
  if (onThisMachine(host) || NOT_LIVE.has(env)) return { where, environment: env, refuse: false, why: "" };
  return { where, environment: env, refuse: true, why: "it is not on this machine, and its settings do not say it is a rehearsal, a test or development" };
}

/** Says where `script` is about to write and stops the process (exit 2) before anything is changed when that needs confirming and was not confirmed. */
export function guardTarget(script: string, argv = process.argv, env = process.env) {
  const t = targetOf(config.databaseUrl, env.ROLEMATCH_ENVIRONMENT ?? "");
  const confirmed = argv.includes(CONFIRM_FLAG) || env.ROLEMATCH_TARGET_CONFIRMED === "1";
  console.error(`${script}: database ${t.where} (environment: ${t.environment || "not stated"})`);
  if (!t.refuse || confirmed) return t;
  console.error(`Refusing to change it: ${t.why}. If this is the database you mean, run it again with ${CONFIRM_FLAG}. Nothing was changed.`);
  process.exit(2);
}
/** The script's own arguments, without the confirmation flag. */
export const ownArgs = (argv = process.argv) => argv.slice(2).filter((a) => a !== CONFIRM_FLAG);
