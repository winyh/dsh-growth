# 增长获客指标字典

> 本文只负责指标定义和数据质量口径。完整的增长方法论与使用流程请先阅读 `docs/增长获客方法论与使用总览.md`。

## 漏斗

| 指标 | 公式 | 注意事项 |
| --- | --- | --- |
| 阶段转化率 | 当前阶段用户数 / 上一阶段用户数 | 用户需要去重；分母为零时返回 null |
| 入口转化率 | 当前阶段用户数 / 漏斗入口用户数 | 必须说明入口事件和时间窗口 |
| 阶段流失率 | 1 - 阶段转化率 | 不等于用户永久流失 |
| 激活率 | 激活用户 / 获客用户 | 必须先定义激活事件 |

## 留存

| 指标 | 公式 | 注意事项 |
| --- | --- | --- |
| N 日留存 | 第 N 日仍发生留存事件的队列用户 / 队列用户 | 推荐同时显示队列规模 |
| 周留存 | 第 N 周仍活跃的队列用户 / 队列用户 | 注册队列不可与自然月混用 |
| 复活率 | 重新活跃用户 / 曾经沉默用户 | 需要定义沉默窗口 |

## MRR

```text
Ending MRR = Beginning MRR
           + New MRR
           + Expansion MRR
           + Reactivation MRR
           - Contraction MRR
           - Churned MRR
```

| 指标 | 公式 | 注意事项 |
| --- | --- | --- |
| MRR 增长率 | (期末 MRR - 期初 MRR) / 期初 MRR | 期初为零时返回 null |
| ARR | 期末 MRR × 12 | 仅适合经常性收入模型 |
| ARPA | MRR / 活跃付费客户数 | 明确是否包含折扣和税费 |
| Logo Churn | 流失客户数 / 期初客户数 | 客户流失和收入流失要分开 |
| Revenue Churn | Churned MRR / 期初 MRR | 不应把收缩 MRR 静默并入流失 |
| NRR | (期初 MRR + 扩张 + 重新激活 - 收缩 - 流失) / 期初 MRR | 不含新增 MRR |

## 单元经济

```text
CAC = 获客与销售成本 / 新增付费客户数
Payback Months = CAC / (ARPA × Gross Margin)
```

简单 LTV 估算：

```text
LTV = ARPA × Gross Margin / Revenue Churn Rate
```

该估算假设收入流失率相对稳定；有成熟队列时优先使用队列收入数据，而不是套用稳定状态公式。

## 数据质量要求

每个关键指标至少记录：

- definition
- numerator / denominator
- period
- source
- collectedAt
- sampleSize
- currency
- timezone
- missing / duplicate policy
