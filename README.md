# Growth Acquisition for DeepSeek Harness

[中文](README.zh.md) · English

`dsh-growth` is a local-first DeepSeek Harness bundle for evidence-backed user growth and customer acquisition analysis.

It covers AARRR funnels, activation, retention cohorts, referral loops, MRR bridges, CAC/LTV/payback, HADI experiments, RICE prioritization and WBR/MBR reports for Markdown, CSV and JSONL data.

## User and company pain points

Growth work often breaks down in the gap between data, decisions and execution:

| Pain point | Required capability |
| --- | --- |
| Growth data is scattered across notes, event exports, revenue sheets and team documents. | Read local Markdown, CSV, JSON and JSONL with a consistent analysis flow. |
| Teams use different definitions for activation, retention, CAC, LTV and MRR. | Make metric definitions, fields, periods, sources and caveats explicit. |
| Funnel dashboards show where users drop, but not what to investigate next. | Identify bottlenecks, segment differences, evidence gaps and next checks. |
| Ideas become long backlogs without a falsifiable hypothesis or owner. | Turn opportunities into HADI experiments with guardrails and RICE/ICE scores. |
| Weekly and monthly reviews are repetitive, disconnected from experiments and hard to audit. | Generate evidence-linked WBR, MBR, QBR and experiment-review Markdown. |
| Sensitive customer data should stay inside the company's knowledge boundary. | Keep analysis local-first with path limits, warnings and guarded writes. |

## Application scenarios

| Scenario | How `dsh-growth` is used |
| --- | --- |
| New product or PMF discovery | Audit JTBD, ICP, PMF Survey, North Star and evidence readiness. |
| Customer acquisition | Compare acquisition, activation and revenue conversion by channel and segment. |
| Onboarding optimization | Locate the activation bottleneck and create a measurable HADI experiment. |
| Retention improvement | Build day/week/month cohorts, inspect lifecycle states and compare user segments. |
| SaaS or subscription monetization | Reconcile MRR movements and calculate ARR, NRR, CAC, LTV and payback. |
| Growth operating cadence | Produce weekly/monthly reviews with findings, decisions, caveats and next actions. |

## Included tools

| Tool | Purpose |
|---|---|
| `growth_doctor` | Check the local workspace and summarize dataset health before analysis |
| `growth_profile_dataset` | Infer fields, coverage, date range and data-quality warnings without raw rows |
| `growth_review` | Start from a business goal and orchestrate profiling, analysis, bottleneck and next actions; paths may be omitted for local auto-discovery |
| `growth_audit_note` | Audit one growth note for JTBD, PMF, North Star, AARRR and evidence quality |
| `growth_audit_vault` | Scan a local knowledge base for growth-document gaps |
| `growth_funnel_analyze` | Analyze AARRR-style event funnels by channel and segment |
| `growth_cohort_analyze` | Analyze retention cohorts and lifecycle states |
| `growth_economics` | Calculate MRR bridge, CAC, LTV, NRR and payback |
| `growth_diagnose` | Diagnose a growth change and rank evidence-backed hypotheses |
| `growth_experiment` | Create a HADI experiment card and RICE/ICE score |
| `growth_prioritize` | Rank growth opportunities with RICE or ICE |
| `growth_report` | Generate WBR, MBR, QBR or experiment-review Markdown |
| `growth_apply` | Preview or guarded-write Markdown under the configured root |

## Quick start

Install the plugin into a DeepSeek Harness profile:

```bash
npx --yes @deepseek-ai/dsh plugin --profile growth add dsh-growth
npx --yes @deepseek-ai/dsh --profile growth --dump-config
```

If `dsh` is already on your `PATH`, the equivalent short form is `dsh plugin --profile growth add dsh-growth`.

Configure the plugin through the host. A minimal configuration is:

```yaml
defaultRoot: "<your-local-growth-root>"
reportDir: ".dsh-growth/reports"
defaultCurrency: "CNY"
defaultTimezone: "Asia/Shanghai"
```

Then use the tools from the conversation. Typical requests are:

```text
Run a growth review for the goal "improve activation" using the best available data under my configured root; show which files you selected and what is missing.
Run a growth review for the goal "improve activation" using events.csv; tell me what is missing before making a recommendation.
Audit growth-plan.md for PMF, North Star, AARRR metrics and evidence gaps.
Analyze events.csv as an AARRR funnel and compare channel and segment performance.
Analyze mrr.csv for MRR Bridge, NRR, CAC, LTV and Payback using a gross margin of 0.8.
Turn the largest activation bottleneck into a HADI experiment and score it with RICE.
Generate this week's WBR as Markdown; do not write a file yet.
```

Tool results use a stable envelope with `ok`, `data`, `warnings`, `assumptions`, `lineage` and `nextActions`. Read `warnings` and `lineage` before using a number in a decision.

### Input conventions

Event data should use `user_id`, `event` and `timestamp`, with optional `channel`, `segment`, `plan`, `revenue` and `currency` fields. MRR data should use `period`, `type`, `amount`, `customer_id`, `active_customers` and `spend`. Supported movement types are `new`, `expansion`, `reactivation`, `contraction`, `churn` and `churned`.
The goal-oriented review recognizes common English and Chinese event values such as `signup` / `注册`, `activated` / `激活`, `active` / `活跃`, `invited` / `邀请` and `paid` / `付费`.

For the first review, `eventPath` and `economicsPath` can be omitted. `growth_review` scans the configured local root, selects the most analysis-ready event and MRR files, and records the selected sources in `assumptions`, `warnings` and `lineage`. If more than one file is suitable, confirm the selection before using the result for a budget or product decision.

### Safe write workflow

Reports are returned as Markdown and are not written automatically. When updating an existing Markdown file:

1. Call `growth_apply` with the complete Markdown content and `confirm=false` to preview.
2. Review the preview and call it again with the same content and `confirm=true` only after approval.

Writes stay inside `defaultRoot` and use a version guard to avoid overwriting concurrent edits. Read `warnings` before interpreting analytical results; missing amounts, spend, active-customer counts and beginning MRR remain unavailable instead of being silently treated as zero.

## Defaults

The plugin is configured for a local knowledge base, a report directory, a default currency and a timezone. These values are supplied by the host configuration and can be adjusted for each environment.

The plugin is local-first. It does not upload a vault or call an external API unless an optional connector is explicitly added in a later phase.

## Development

```bash
pnpm install
pnpm run typecheck
pnpm run lint
pnpm test
pnpm run build
```

The plugin follows the standard Cordis bundle contract: it exports `apply(ctx)`, injects `tools` and `fs`, and registers model-facing tools through the normal tool pipeline.

## Methodology

- Jobs to Be Done for problem and customer context.
- Sean Ellis PMF survey as a heuristic gate.
- North Star Metric and driver tree.
- AARRR funnel plus growth loops.
- Cohort retention and lifecycle analysis.
- HADI experiment cards.
- RICE/ICE opportunity prioritization.
- MRR bridge and unit economics.

## License

MIT. See [LICENSE](./LICENSE).
