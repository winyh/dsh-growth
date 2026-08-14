# 增长获客

[English](README.md) · 中文

`dsh-growth` 是一个本地优先的 DeepSeek Harness 插件，用于把 Markdown、CSV 和 JSONL 中的增长资料与业务数据，转化为可解释的增长诊断和执行任务。

## 用户与公司的痛点需求

增长工作通常卡在“数据、决策、执行”之间：

| 痛点 | 需要的能力 |
| --- | --- |
| 增长数据散落在笔记、事件导出、收入表和团队文档中。 | 统一读取本地 Markdown、CSV、JSON 和 JSONL。 |
| 激活、留存、CAC、LTV、MRR 等指标口径不一致。 | 明确指标定义、字段、周期、来源和 caveats。 |
| 漏斗只能告诉团队用户在哪一步流失，不能说明下一步查什么。 | 找出瓶颈、分群差异、证据缺口和下一步检查。 |
| 想法容易变成没有假设、负责人和验证标准的待办列表。 | 生成带护栏指标的 HADI 实验，并用 RICE / ICE 排序。 |
| 周报、月报与实验复盘重复劳动，且难以追溯证据。 | 生成可复核的 WBR、MBR、QBR 和实验复盘 Markdown。 |
| 客户数据不应离开公司的知识边界。 | 本地优先分析，配合路径限制、警告和安全写入。 |

## 应用场景

| 场景 | 使用方式 |
| --- | --- |
| 新产品 / PMF 探索 | 审计 JTBD、ICP、PMF Survey、North Star 和证据准备度。 |
| 客户获客 | 按渠道和分群比较获客、激活和收入转化。 |
| 新手引导优化 | 定位激活瓶颈，生成可量化的 HADI 实验。 |
| 留存提升 | 构建日 / 周 / 月留存队列，分析生命周期和用户分群。 |
| SaaS / 订阅商业化 | 计算 MRR Bridge、ARR、NRR、CAC、LTV 和 Payback。 |
| 增长运营复盘 | 生成包含发现、决策、限制和下一步行动的周报 / 月报。 |

## 核心能力

- `growth_doctor`：分析前检查本地目录、数据文件和质量风险
- `growth_profile_dataset`：推断字段、覆盖率、日期范围和质量警告，不返回原始行
- `growth_review`：从业务目标出发，编排画像、分析、瓶颈和下一步行动；可以省略路径，自动发现本地数据
- 用户增长与客户获取分析
- JTBD、ICP、PMF 和 North Star 审计
- AARRR 漏斗分析
- 激活与留存队列分析
- 推荐循环和渠道质量分析
- MRR Bridge、CAC、LTV、NRR、Payback
- HADI 增长实验卡
- RICE / ICE 优先级排序
- WBR / MBR / QBR 增长复盘
- 预览后、安全写入 Obsidian Markdown

## 默认配置

将插件安装到 DeepSeek Harness profile：

```bash
npx --yes @deepseek-ai/dsh plugin --profile growth add dsh-growth
npx --yes @deepseek-ai/dsh --profile growth --dump-config
```

如果 `dsh` 已经在系统 `PATH` 中，也可以使用简写：`dsh plugin --profile growth add dsh-growth`。

```yaml
defaultRoot: D:\ObsidianData
reportDir: .dsh-growth/reports
defaultCurrency: CNY
defaultTimezone: Asia/Shanghai
```

插件默认只读本地文件，不上传知识库，不自动发消息，不修改 CRM，不自动投放广告。外部 API 连接只作为后续可选的只读能力。

## 典型用法

第一次使用时，建议先从目标导向入口开始：

```text
以“提升激活率”为目标，在配置目录中自动选择最合适的数据复盘；告诉我选了哪些文件、还缺什么。
以“提升激活率”为目标复盘 events.csv；先告诉我数据缺什么，再给出结论。
审计这份增长计划，找出最大的指标和证据缺口。
分析 events.csv 的 AARRR 漏斗，并比较不同获客渠道。
根据 customers.csv 计算 MRR Bridge、NRR、CAC 和 Payback。
把这个增长想法转成 HADI 实验卡，并用 RICE 排序。
生成本周增长复盘，先预览，不要直接写入文件。
```

事件值支持常见中英文写法，例如 `signup` / `注册`、`activated` / `激活`、`active` / `活跃`、`invited` / `邀请` 和 `paid` / `付费`。

## 使用步骤

1. 由宿主配置 `defaultRoot`、报告目录、默认币种和时区。
2. 准备事件数据或 MRR 数据。事件数据至少包含 `user_id`、`event`、`timestamp`；MRR 数据建议包含 `period`、`type`、`amount`、`customer_id`、`active_customers`、`spend`。
3. 在对话中直接描述目标，插件会选择对应工具。例如：

```text
分析 events.csv 的 AARRR 漏斗，按 channel 和 segment 对比，并指出最大瓶颈。
分析 mrr.csv，计算 MRR Bridge、NRR、CAC、LTV 和 Payback，毛利率使用 0.8。
把激活率下降的问题转成 HADI 实验，并用 RICE 排序。
```

4. 报告先以 Markdown 返回。需要写入已有笔记时，先调用 `growth_apply` 使用 `confirm=false` 预览，确认内容后再使用 `confirm=true` 写入。

第一次复盘可以省略 `eventPath` 和 `economicsPath`。`growth_review` 会扫描配置的本地目录，选择最适合做事件分析和 MRR 分析的文件，并把选择结果写入 `assumptions`、`warnings` 和 `lineage`。如果发现多个候选文件，应先确认选择，再据此做预算或产品决策。

工具结果统一包含 `ok`、`data`、`warnings`、`assumptions`、`lineage` 和 `nextActions`。使用数字做决策前，必须先阅读 `warnings` 和 `lineage`。

### 数据字段示例

```csv
user_id,event,timestamp,channel,segment
u001,acquired,2026-08-01T09:00:00Z,content,team
u001,activated,2026-08-01T09:20:00Z,content,team
u001,retained,2026-08-08T09:20:00Z,content,team
```

分析结果中的 `warnings` 必须一并阅读：缺失金额、投放成本、活跃客户数或起始 MRR 不会被静默当作零，相关指标会保持不可用并明确说明原因。

## 开发

```bash
pnpm install
pnpm run typecheck
pnpm run lint
pnpm test
pnpm run build
```

## 许可证

MIT，详见 [LICENSE](./LICENSE)。
