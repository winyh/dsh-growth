# Growth Acquisition for DeepSeek Harness

`dsh-growth` is a local-first DeepSeek Harness bundle for evidence-backed user growth and customer acquisition analysis.

It covers AARRR funnels, activation, retention cohorts, referral loops, MRR bridges, CAC/LTV/payback, HADI experiments, RICE prioritization and WBR/MBR reports for Markdown, CSV and JSONL data.

## Included tools

| Tool | Purpose |
|---|---|
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

Configure the plugin through the host. A minimal configuration is:

```yaml
defaultRoot: "<your-local-growth-root>"
reportDir: ".dsh-growth/reports"
defaultCurrency: "CNY"
defaultTimezone: "Asia/Shanghai"
```

Then use the tools from the conversation. Typical requests are:

```text
Audit growth-plan.md for PMF, North Star, AARRR metrics and evidence gaps.
Analyze events.csv as an AARRR funnel and compare channel and segment performance.
Analyze mrr.csv for MRR Bridge, NRR, CAC, LTV and Payback using a gross margin of 0.8.
Turn the largest activation bottleneck into a HADI experiment and score it with RICE.
Generate this week's WBR as Markdown; do not write a file yet.
```

### Input conventions

Event data should use `user_id`, `event` and `timestamp`, with optional `channel`, `segment`, `plan`, `revenue` and `currency` fields. MRR data should use `period`, `type`, `amount`, `customer_id`, `active_customers` and `spend`. Supported movement types are `new`, `expansion`, `reactivation`, `contraction`, `churn` and `churned`.

### Safe write workflow

Reports are returned as Markdown and are not written automatically. When updating an existing Markdown file:

1. Call `growth_apply` with the complete Markdown content and `confirm=false` to preview.
2. Review the preview and call it again with the same content and `confirm=true` only after approval.

Writes stay inside `defaultRoot` and use a version guard to avoid overwriting concurrent edits. Read `warnings` before interpreting analytical results; missing values are not silently treated as zero.

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
