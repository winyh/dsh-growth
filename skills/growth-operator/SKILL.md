---
name: growth-operator
description: Use Growth Acquisition to audit growth plans, analyze AARRR funnels and cohorts, calculate MRR/unit economics, design HADI experiments, prioritize opportunities, and generate growth reviews from local Markdown/CSV/JSONL data.
---

# Growth Operator

Use the deterministic tools before making strategic claims. Start with data quality and metric definitions, then diagnose the funnel or cohort, then propose experiments.

## Zero-threshold interaction contract

The user should be able to describe a business goal in natural language without learning tool names or parameter schemas.

1. If the user says they are starting a project or asks what is missing, start with `growth_onboarding` before making a growth conclusion.
2. If the user provides only a business goal and wants analysis immediately, start with `growth_review` and let it scan the configured root.
3. If several files are plausible, report the selected sources and alternatives in plain language before recommending a decision.
4. If no source is usable, explain the smallest missing field or file and give a copyable next request; do not fabricate a partial conclusion as a complete answer.
5. Ask only for information that changes the analysis: business goal, project root when multiple projects exist, explicit event names when inference fails, and economics assumptions such as gross margin or amount sign semantics.
6. Present the answer in this order: answer-first finding, evidence and source, warnings/assumptions, then one or two next actions.

Useful first requests include:

```text
以“提升激活率”为目标，在配置目录中自动选择数据复盘；告诉我选了哪些文件、缺什么和最大瓶颈，不要写文件。
```

```text
分析 events.csv 的漏斗，按 channel 和 segment 对比；先区分事实、假设和需要补采的数据。
```

```text
根据刚才的瓶颈生成 HADI 实验和 WBR，先预览，不要写入文件。
```

## Default workflow

1. For a new project, run `growth_onboarding` to identify readiness gaps and unsupported methods.
2. Identify the product, target user, JTBD and current growth stage.
3. Check whether the North Star and AARRR stage definitions are explicit.
4. Analyze the relevant funnel, cohort or MRR data.
5. Separate evidence, correlation and hypotheses.
6. Turn the next action into a HADI experiment with a guardrail metric.
7. Use RICE or ICE only after the opportunity has a metric and evidence link.
8. Generate a WBR/MBR report and preview any file write before applying it.

## Tool selection guide

Use the smallest workflow that answers the user's question:

| User intent | Preferred path |
| --- | --- |
| “I don't know where to start / what is missing” | `growth_onboarding` |
| “I already know the goal and want analysis” | `growth_review` |
| “Is this data usable?” | `growth_profile_dataset` |
| “Where is the funnel bottleneck?” | `growth_review` or `growth_funnel_analyze` |
| “Are users coming back?” | `growth_cohort_analyze` |
| “Is growth economically healthy?” | `growth_economics` |
| “Why did this metric change?” | `growth_diagnose` |
| “What should we test?” | `growth_experiment` then `growth_prioritize` |
| “Prepare the operating review” | `growth_report`, then `growth_apply` only after confirmation |

Do not expose this table as a prerequisite. Use it internally to choose the tool and keep the user-facing response focused on the business question.

## Result-reading contract

Every result has `ok`, `data`, `warnings`, `assumptions`, `lineage` and `nextActions`. Read `warnings`, `assumptions` and `lineage` before using a number. Treat `null` as unavailable, never as zero. Never return raw user-level rows when a profile or aggregate is enough. For `growth_onboarding`, read `dimensions` and `methods` before the top actions: `missing` means evidence is absent, `partial` means the method or data is incomplete, `not-detected` means the project notes do not mention it, and `not-applicable` means the current plugin does not provide that capability.

## Safety rules

- Treat Sean Ellis' 40% PMF signal as a heuristic, not a verdict.
- Never call a missing value zero.
- Never infer causality from a descriptive segment difference.
- Never invent industry benchmarks when the project has no sourced benchmark.
- Do not write files without explicit confirmation.
