# Keeping Supabase in step with the code

## The rule
**Every change to the database is a new numbered file in `supabase/migrations/`, applied with `npm run migrate`.**
Never change tables, columns, indexes or policies by hand in the Supabase dashboard: the next person would not know, and the code and the database would drift apart.
Never edit a migration that has already been applied: add a new one.

## What keeps it honest
- **On startup** the server compares the live database with what the code expects (tables, columns, row-level security on every table, the audit-log protection, the private `originals` bucket, and that sign-ups need email confirmation).
  In development, pending migrations are applied automatically. In production (`COOKIE_SECURE=true`) the server refuses to start until they are applied deliberately.
- **`/api/health`** reports `"schema": "in sync"` or `"OUT OF SYNC"`.
- **`npm run schema:check`** prints the full comparison and exits 1 on any drift. Run it before and after every deployment.
- **`npm run test`** rebuilds a database from the migration files alone and checks it matches the code, checks the live project is in sync, and checks that deliberate drift is detected.
- If code needs a new column, add it to `EXPECTED` in `server/src/schema.ts` in the same change as its migration.

## Things only the Supabase dashboard controls (check these when setting up a project)
| Setting | Where | Required value |
|---|---|---|
| Data API | Project Settings > Data API | Off (the server talks to the database directly) |
| Confirm email | Authentication > Providers > Email | **On** (checked automatically) |
| Email OTP length | Authentication > Providers > Email | 6 to 10 digits (the page accepts any of them) |
| OTP expiration | Authentication > Providers > Email | Must equal `OTP_EXPIRY_MINUTES` in `server/.env` (default 60 minutes) |
| Supabase's own emails | (nothing to configure) | **Not used.** RoleMatch creates the code through Supabase and sends its own branded email through Resend (`server/src/email.ts`), so the Supabase email templates and SMTP settings do not matter. |
| Storage bucket `originals` | Storage | Private (checked automatically) |
| Site URL | Authentication > URL Configuration | Your public address |
| Backups | Project Settings > Database > Backups | Free plan has none; a paid plan with backups is needed before real candidate data |

## Setting up Resend (for the branded verification email)
1. Create an account at resend.com.
2. **Domains > Add Domain.** Use a subdomain you own, e.g. `mail.yourdomain.com`. Add the DNS records Resend shows (SPF, DKIM and the return path) at your domain registrar, then click Verify. Without a verified domain, email lands in spam or is refused; before that you can only send test messages to your own Resend account address.
3. **API Keys > Create API Key** with "Sending access", limited to that domain.
4. Put these in `server/.env` (never in chat or git): `RESEND_API_KEY`, and `EMAIL_FROM="RoleMatch <no-reply@mail.yourdomain.com>"`. Optionally `EMAIL_REPLY_TO`.
5. Restart the server. `/api/health` should show `"email": "resend"`, then sign up with a real address and look at the email.
Production refuses to start without these.

## Development switch
`SIGNUP_DEV_CODE=true` lets you work without Resend: the server writes each email to `server/data/emails/` as an HTML preview (open it in a browser to see the branded design) and prints the code to its console. The server refuses to start with it on when `COOKIE_SECURE=true`.
