---
name: growth-operator
description: Use Growth Acquisition to audit growth plans, analyze AARRR funnels and cohorts, calculate MRR/unit economics, design HADI experiments, prioritize opportunities, and generate growth reviews from local Markdown/CSV/JSONL data.
---

# Growth Operator

Use the deterministic Harness tools before making strategic claims. Start with data quality and metric definitions, then diagnose the funnel or cohort, then propose experiments. The presence of this skill is not proof that the Cordis tools are loaded: if `growth_onboarding` is absent from the host's callable tool list, report the runtime limitation and stop instead of simulating a result.

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
8. If the next action is site discoverability or AI search readiness, use `growth-ai-discoverability` to qualify applicable checks and prepare a readiness plan; it does not perform live website actions.
9. If the next action is an external acquisition or directory listing, use `growth-acquisition-execution` to qualify resources and prepare a submission SOP; it does not perform live external actions.
10. Generate a WBR/MBR report and preview any file write before applying it.

## SOP gates

Run the following gates in order. A gate is not passed because a note mentions a method; it is passed only when the required evidence, source and decision rule are visible.

| Gate | Answer before moving on | Pass condition | Preferred path |
| --- | --- | --- | --- |
| 0. Runtime | Can the current host actually call the growth tools? | The tool appears in the callable registry, not only in this skill text | Harness/Cordis tool registry |
| 1. Context | Who is the user, what job are they trying to complete, and what value should improve? | JTBD/ICP, North Star, target metric, baseline and period have evidence | `growth_onboarding`, `growth_audit_note` |
| 2. Measurement | Can the data answer the question with a stable identity and time window? | Source, field mapping, quality warnings and missing fields are explicit | `growth_doctor`, `growth_profile_dataset` |
| 3. Diagnosis | Where is the constraint, and what is fact versus hypothesis? | Sources are selected, warnings are read, and the bottleneck is tied to a metric | `growth_review`, `growth_funnel_analyze`, `growth_cohort_analyze`, `growth_economics` |
| 4. Experiment | What change will be tested, for whom and for how long? | HADI has a primary metric, guardrails, owner, instrumentation and stop criteria | `growth_experiment` |
| 5. Priority | Why this opportunity before another one? | RICE/ICE inputs are evidence-linked or explicitly marked as estimates | `growth_prioritize` |
| 6. Review | What was learned and what decision follows? | Report has sources, caveats, owner and date; writes use preview then confirmation | `growth_report`, `growth_apply` |

Stop and ask for the smallest missing input when a gate fails. Do not skip to an experiment because a funnel chart exists, do not treat a descriptive segment difference as causality, and do not write a report before the user confirms the preview.

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
| “Is our site ready for AI search or product discovery?” | `growth-ai-discoverability` |
| “Which external channels should we qualify, and how should we submit?” | `growth-acquisition-execution` |
| “Prepare the operating review” | `growth_report`, then `growth_apply` only after confirmation |

Do not expose this table as a prerequisite. Use it internally to choose the tool and keep the user-facing response focused on the business question.

## Result-reading contract

Every result has `ok`, `data`, `warnings`, `assumptions`, `lineage` and `nextActions`. Read `warnings`, `assumptions` and `lineage` before using a number. Treat `null` as unavailable, never as zero. Never return raw user-level rows when a profile or aggregate is enough. For `growth_onboarding`, read `sop.currentStep`, then `dimensions` and `methods` before the top actions: `missing` means evidence is absent, `partial` means the method or data is incomplete, `not-detected` means the project notes do not mention it, and `not-applicable` means the current plugin does not provide that capability. Use the current SOP gate to decide the smallest next request; do not ask the user to complete every gap at once.

## Safety rules

- Treat Sean Ellis' 40% PMF signal as a heuristic, not a verdict.
- Never call a missing value zero.
- Never infer causality from a descriptive segment difference.
- Never invent industry benchmarks when the project has no sourced benchmark.
- Do not write files without explicit confirmation.
