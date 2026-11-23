# Enquiries to South African Claude partners (DRAFT, for the owner to send)

*12 Nov 2026. Two companies announced this year that they offer Anthropic's Claude in South Africa. Before RoleMatch can tell a corporate "the AI runs
under South African terms", these questions need written answers. Nothing here has been sent. Sources: ITWeb on TrendAI (April and July 2026),
Connecting Africa on Cassava (27 Oct 2026).*

What we use today, for reference: Claude Sonnet 5.5 for matching and Claude Haiku 5.5 for reading CVs and jobs, called through Anthropic's own API
(the Messages API), with prompt caching and structured outputs; about **[N]** calls a month now, and **[expected]** at the first corporate customer.

---

## To TrendAI

**Subject:** Claude for a South African recruitment platform: where it runs, and what it costs

Good day,

We run RoleMatch, a South African recruitment platform that reads CVs and job descriptions with Claude and recommends matches for people to review.
We read about your partnership with Anthropic and your locally governed setup, and we would like to understand whether it fits us.

1. When we send a request, in which country is the model actually run, and where is the request and its answer stored, if at all, and for how long?
2. Which Claude models do you offer, and specifically Claude Sonnet 5.5 and Claude Haiku 5.5?
3. Is the interface the same as Anthropic's own Messages API (including prompt caching and structured outputs), or different?
4. Your prices per million tokens for those models, in rand or dollars, and any minimum commitment.
5. Can you sign a data processing agreement under POPIA section 21, and do you use our data for anything other than answering us (for example
   training)?
6. Your availability commitment and your rate limits.

Kind regards,
**[Name]**, RoleMatch, **[contact]**

---

## To Cassava Technologies

**Subject:** Reselling Claude to a South African platform: region, models and terms

Good day,

We run RoleMatch, a South African recruitment platform that reads CVs and job descriptions with Claude. We saw that Cassava is now an authorised
Claude reseller in Africa through Amazon Bedrock, and that you run an AI Factory in South Africa.

1. Through you, in which AWS region would the model run for us, and can it run in South Africa (Cape Town)?
2. Are Claude Sonnet 5.5 and Claude Haiku 5.5 available, with prompt caching and structured outputs?
3. Your prices, in rand, compared with Anthropic's list prices, and how billing works (monthly, prepaid, on our AWS account or yours).
4. Can you sign a POPIA data processing agreement, and do you or AWS keep or use our requests beyond answering them?
5. Support and availability commitments.

Kind regards,
**[Name]**, RoleMatch, **[contact]**

---

**Why it matters:** if either runs Claude inside South Africa with a proper agreement, RoleMatch can tell corporates that CVs never leave the country,
with no change to the AI or its quality. RoleMatch's code calls the AI in one place (`server/src/ai/claude.ts`), so changing the route is mostly a
setting, not a rebuild.
