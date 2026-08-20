---
name: growth-ai-discoverability
description: Use a local-first, evidence-backed method to assess AI search and discoverability readiness, choose applicable technical/content/commerce checks, and produce prioritized improvement plans and validation experiments. Do not use for live website scanning, code changes, platform submission or GEO-PRO execution.
---

# AI Search Discoverability Planning

Use this skill when the user asks about AI search visibility, LLM discoverability, AEO, AI readiness, product discoverability or how a site should prepare for AI-generated search and shopping experiences.

This is a method, resource and SOP layer. It does not browse websites, call Search Console, edit robots.txt, change structured data, publish content, submit feeds or promise ranking, indexing, citation or conversion. Use the local resources in `references/ai-discoverability/` and user-provided snapshots or reports.

## SOP

### Gate 0 — Define the business outcome

Identify the business type, target user, important page, query or job, and desired result:

- qualified discovery;
- product or service understanding;
- signup or activation;
- purchase or revenue;
- support or self-service resolution.

Reject vague goals such as “get cited everywhere” or “guarantee AI ranking”.

### Gate 1 — Decide applicability

Classify each check as `required`, `recommended`, `not-applicable` or `needs-external-validation` for ecommerce, SaaS/B2B, content, local service or another business model. Do not apply ecommerce Product / Offer / Merchant Center checks to a SaaS or content site without evidence that they fit.

### Gate 2 — Build the evidence matrix

Use `references/ai-discoverability/ai-search-readiness-checklist.md`. For every item record:

- current status;
- source or evidence ID;
- owner;
- priority;
- limitation;
- validation method;
- target date.

When evidence is absent, output `needs-external-validation`; do not infer site readiness from a marketing note.

### Gate 3 — Review four readiness layers

Review only the layers that apply:

1. crawl and index: production page, canonical, robots, sitemap, rendering and performance;
2. machine-readable facts: Organization, Product, Offer, Review, Breadcrumb or other relevant structured data;
3. content and trust: buyer intent, use cases, comparisons, limitations, authorship, sources, internal links and accessibility;
4. commerce data: price, availability, shipping, returns, product IDs, feeds and official merchant surfaces.

Keep platform-specific recommendations separate from general principles. Google Search fundamentals remain the baseline; no checklist item guarantees AI inclusion.

### Gate 4 — Turn gaps into a plan

Prioritize P0 blockers before P1 comprehension and trust gaps, then P2 content coverage and P3 presentation experiments. Each action must state the owner, dependency, source, target date, acceptance criteria and what will not be changed.

Do not recommend adding markup, pages or AI-generated content merely to increase checklist coverage. The page must remain accurate, useful and consistent with the visible experience.

### Gate 5 — Define validation and growth linkage

Design a validation plan with:

- primary metric: qualified discovery, landing-page engagement, signup, activation, purchase or revenue;
- guardrails: accuracy, crawl errors, page performance, support burden, bounce or conversion quality;
- window and baseline;
- data source and attribution limits;
- stop or rollback condition.

Connect future evidence to Acquisition, Activation, Retention and Revenue. “AI mentioned us” is an observation, not growth impact.

## Output contract

Return, in this order:

1. business context and applicability;
2. readiness matrix with `ready`, `partial`, `missing`, `not-applicable` or `needs-external-validation`;
3. top P0–P3 actions with owners and acceptance criteria;
4. unsupported assumptions and evidence gaps;
5. one validation experiment or next evidence request;
6. how the result will connect to AARRR and MRR.

Never claim that the site is crawlable, indexed, AI-visible, cited, ranked or conversion-effective without current evidence supplied by the user or an approved external system.
