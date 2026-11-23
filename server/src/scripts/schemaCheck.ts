// Usage: npm run schema:check   (exit code 1 if the live Supabase project is not in step with the code)
import { sql } from "../db";
import { schemaStatus } from "../schema";
const st = await schemaStatus();
console.log(JSON.stringify(st, null, 2));
await sql.end();
process.exit(st.inSync ? 0 : 1);
