---
name: growth-acquisition-execution
description: Use a quality-gated, evidence-backed workflow to evaluate external acquisition resources, design directory-submission plans, prepare authorization and evidence templates, and connect future referral outcomes back to AARRR and growth reviews. Use when the user asks for backlinks, product-directory submissions, launch listings, external acquisition channels, or referral distribution.
---

# Growth Acquisition Planning & SOP

Use external channels as an acquisition and referral planning resource, not as a backlink-counting exercise. This skill produces a qualified resource shortlist, a submission SOP, an authorization checklist and an evidence-ready handoff. It does not browse sites, create accounts, fill forms, submit listings or perform any other live external action. The local candidate snapshot is a starting point only; every route must be rechecked by the person or system that later performs the action.

The workflow is adapted from the public `flaqai/backlink_skills` project. See `references/external-acquisition/THIRD-PARTY-NOTICES.md` and `references/external-acquisition/UPSTREAM-LICENSE` for attribution.

## Operating modes

- **V2 Quality (default):** design a small, relevant pilot when audience value, brand safety, governance and durable referral value matter. Maximum 10 sites per proposed batch.
- **V1 Batch:** prepare a plan only for a user-supplied or already-approved list that has passed a legitimacy gate. Normalize, deduplicate, shard and define checkpoints; do not run the batch.

When uncertain, start with V2 Quality. Do not recommend V1 until the pilot design shows that the route, product facts, authorization and evidence model work.

## SOP

### Gate 0 — Confirm the acquisition objective

Ask what business outcome the user wants:

- qualified product discovery;
- referral visits or signups;
- launch distribution;
- a directory listing that improves product trust.

Do not accept “get as many backlinks as possible”, “guarantee dofollow”, ranking manipulation, or domain-metric targets as a valid objective.

Required product facts: exact brand, canonical URL, product description, target audience, category, public contact alias, approved assets and facts that must not be changed. Unknown required facts block the plan.

### Gate 1 — Select and normalize candidates

Read `references/external-acquisition/backlink-candidates.md` or the user's own source list. For each candidate:

1. keep the public URL and submission route separate;
2. normalize scheme, hostname, path and tracking parameters;
3. derive an idempotency key from platform domain, product canonical ID, account alias and route;
4. deduplicate before preparing a handoff;
5. classify the route as directory listing, request-app, claim listing, account/profile, article, community, email, contact form, resource page or partner outreach;
6. hand off unsupported routes instead of silently treating them as directory submissions.

The snapshot may contain closed, paid, reciprocal, low-quality, duplicated or unverified routes. Its historical note is not current truth.

### Gate 2 — Run the quality gate

Before entering product fields, inspect:

- target audience relevance;
- real user or discovery value;
- editorial or platform governance;
- paid/ranking-link offers;
- directory or network quality;
- automation and terms compatibility;
- reciprocal-link requirements;
- current availability and submission policy.

Mark each site `passed`, `failed`, or `unknown`. Only `passed` sites may enter a form-handoff plan. Mark failed sites `ineligible` with evidence; do not keep retrying them.

### Gate 3 — Separate authorization by action

Do not infer final-submit permission from permission to inspect. Prepare an authorization matrix separately for:

- inspection;
- form filling;
- account creation;
- native email verification;
- terms/privacy acceptance;
- final submission;
- payment or upgrade;
- reciprocal link or site modification;
- DNS/HTML/domain verification.

Every proposed action needs an approver alias, approval time, site scope and expiry. `ask` and `prohibited` are not authorization. The matrix is a planning artifact; the skill does not request or apply the authorization externally.

### Gate 4 — Prepare the execution handoff (no live action)

Turn the approved plan into a site-by-site handoff checklist. State the required browser, account, product facts, approval, verification and evidence fields, but do not open a browser or invoke an external connector.

- Recommend one site at a time in V2 and sequential checkpoints within each proposed V1 shard.
- Instruct the eventual operator to recheck quality, duplicate state, authorization and verification immediately before form work.
- Keep optional newsletters, promotions and subscriptions off unless separately authorized.
- Mark CAPTCHA, Turnstile, 2FA, Passkey, email/phone verification or other native safeguards as human handoff steps.
- Never recommend bypassing, outsourcing or weakening a site safeguard.
- Require the eventual operator to record the result before advancing a queue cursor.
- If a future operator reports an ambiguous result, retain `submission outcome unknown` and require verification before any retry.

### Gate 5 — Preserve evidence and measure the growth outcome

Use the record template at `references/external-acquisition/submission-record-template.md` as a plan and handoff artifact. Store public campaign records separately from controlled evidence. Use opaque evidence IDs; never write passwords, OTPs, cookies, recovery codes, OAuth parameters, magic links, raw session IDs, private email addresses or phone numbers into the record. Never claim a submission or publication occurred unless the user supplies reliable evidence from work completed outside this skill.

The plan may use `planned`, `ready for approval` and `not attempted`. If the user later imports an externally completed result, the record may also use:

`not attempted`, `submitted`, `awaiting approval`, `awaiting email verification`, `published`, `submission outcome unknown`, `submission failed`, `blocked — user action`, `blocked — missing verified data`, `ineligible`, and `unavailable`.

For a user-supplied published listing, record the actual public URL, anchor type, href, `rel`, commercial relationship and evidence reference. Count the result in growth analysis as an acquisition/referral source only after the listing or referral path is actually verified.

Measure:

- qualified publication rate;
- referral visits and signups;
- referral activation and conversion;
- product-profile accuracy;
- listing survival and review workload.

Do not use submission count, backlink count, DA, DR, PageRank or dofollow count as success criteria.

## Recovery and handoff rules

- Keep proposed queue state, manual actions and externally reported outcomes distinct.
- Do not replay or recommend duplicate work for completed idempotency keys.
- Keep short-lived verification steps and long-lived follow-up items visible in the handoff.
- Use `skills/growth-acquisition-execution/scripts/audit_submission_record.py` before a report or handoff.
- A clean audit does not prove a site accepted a submission; it proves the record is structurally and privacy safe.

## How this connects to Growth Acquisition

External listing work is an Acquisition / Referral loop:

```text
candidate resource
→ quality gate
→ submission plan
→ authorization checklist
→ human / host handoff
→ verified public route (if later supplied)
→ referral visit
→ signup / activation
→ cohort and revenue quality
→ channel decision
```

If the user later supplies externally verified outcomes, use `growth_funnel_analyze`, `growth_cohort_analyze` and `growth_review` to compare referral quality with other channels. If no referral or activation evidence exists, report a plan or handoff, not growth impact.

## User-facing response order

1. State the selected mode, objective and candidate count.
2. Show quality exclusions and unresolved verification steps.
3. Ask for only the missing product fact or authorization decision that changes the plan.
4. Produce the next approved site handoff; do not perform the external action.
5. Report planned status, evidence fields, next review time and the metric that will connect future results to AARRR.

Never claim that a route is free, live, accepted, indexed, dofollow or effective without current evidence. Never claim that this skill submitted, published or verified a listing.
