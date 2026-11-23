-- Each company's monthly AI allowance (owner, 12 Nov 2026: "can't have people driving up my clients' AI costs"). Until each company has its own key, every
-- portal's AI is paid from RoleMatch's account under one platform cap (AI_MONTHLY_CAP_USD), so one company, or a stranger who signs up, could use the
-- whole month's budget and stop the AI for every other client. From here a company's AI work stops at its own allowance for the month, before the
-- platform's: src/ai/claude.ts checks it before anything is sent.
-- Empty means the platform's allowance for a company (AI_ORG_MONTHLY_CAP_USD, 5 dollars unless set). The companies that already exist keep working as
-- they have: 20 dollars, above the most any of them has used in a month (12.15 dollars, 12 Nov 2026). Only the database's owner changes it
-- (deploy/pc/ai-allowance.sh); the application reads it and a company can read its own, as it reads its own name.
alter table orgs add column if not exists ai_monthly_cap_usd numeric(10,2) check (ai_monthly_cap_usd is null or ai_monthly_cap_usd >= 0);
update orgs set ai_monthly_cap_usd = 20 where ai_monthly_cap_usd is null;
