import type { HandoffRoute } from './handoff-receive.js'

// Locally owned contract; no shared runtime package or cross-repository import.
export const handoffRoutes: Record<string, HandoffRoute> = {
  "product-feedback-closure": {
    "from": "dsh-product",
    "nextTool": "growth_review",
    "purpose": "接收 Beta 问题的复验结果，再用后续行为数据检查真实业务效果，不把修复当增长。",
    "text": ["sourceArtifactId", "action", "owner", "evidence"],
    "lists": [],
    "mode": "direct"
  },
  "growth-handoff": {
    "from": "dsh-product",
    "nextTool": "growth_metric_contract",
    "purpose": "将产品结果、主指标和护栏转成有数据源与观察窗口的指标契约。",
    "text": [
      "source",
      "productName",
      "productOutcome",
      "primaryMetric"
    ],
    "lists": [
      "evidence",
      "guardrails"
    ],
    "mode": "direct"
  },
  "geo-growth-measurement-plan": {
    "from": "dsh-geo",
    "nextTool": "growth_attribution_review",
    "purpose": "沿用 contentId/channel/targetMetric 对齐内容观察窗口，不把曝光当成交或因果。",
    "text": [
      "source",
      "contentId",
      "channel",
      "targetMetric",
      "publishAt",
      "baselineWindow"
    ],
    "lists": [],
    "mode": "direct"
  },
  "sales-feedback-handoff": {
    "from": "dsh-sales",
    "nextTool": "growth_economics",
    "purpose": "将实际成交汇总作为收入核对输入，核对币种、时间窗、去重与原始来源。",
    "text": [
      "source"
    ],
    "lists": [],
    "mode": "direct"
  }
}
