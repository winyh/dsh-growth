# 增长获客

`dsh-growth` 是一个本地优先的 DeepSeek Harness 插件，用于把 Markdown、CSV 和 JSONL 中的增长资料与业务数据，转化为可解释的增长诊断和执行任务。

## 核心能力

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

```yaml
defaultRoot: D:\ObsidianData
reportDir: .dsh-growth/reports
defaultCurrency: CNY
defaultTimezone: Asia/Shanghai
```

插件默认只读本地文件，不上传知识库，不自动发消息，不修改 CRM，不自动投放广告。外部 API 连接只作为后续可选的只读能力。

## 典型用法

```text
审计这份增长计划，找出最大的指标和证据缺口。
分析 events.csv 的 AARRR 漏斗，并比较不同获客渠道。
根据 customers.csv 计算 MRR Bridge、NRR、CAC 和 Payback。
把这个增长想法转成 HADI 实验卡，并用 RICE 排序。
生成本周增长复盘，先预览，不要直接写入文件。
```

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

### 数据字段示例

```csv
user_id,event,timestamp,channel,segment
u001,acquired,2026-08-01T09:00:00Z,content,team
u001,activated,2026-08-01T09:20:00Z,content,team
u001,retained,2026-08-08T09:20:00Z,content,team
```

分析结果中的 `warnings` 必须一并阅读：缺失值不会被静默当作零，缺少起始 MRR 或毛利率时，相关指标会明确标注假设。

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
