// Starts a throw-away server (own schema, local e-mail preview) for looking at the invitation screens in a browser. Prints the sign-in and keeps running until stopped.
import { makeWorld } from "../portalKit";
const w = await makeWorld(8871, 2, { SIGNUP_REQUIRE_CODE: "false", SIGNUP_DEV_CODE: "true", ALLOWED_ORIGINS: "http://localhost:5173,http://localhost:5199", PUBLIC_APP_URL: "http://localhost:5199", OUTBOX_POLL_MS: "500" });
console.log(JSON.stringify({ admin: w.users[0].email, other: w.users[1].email, password: "a-long-enough-password-1", org: w.org, emails: w.tdb.env.DATA_DIR ?? "server/data/emails" }));
process.on("SIGTERM", async () => { await w.stop(); process.exit(0); });
setInterval(() => {}, 1 << 30);
