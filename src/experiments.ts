import { parseList } from './metrics.js'
import type { ExperimentCard, PriorityItem, PriorityMethod } from './types.js'

export interface ExperimentOptions {
  title: string
  problem: string
  hypothesis: string
  stage: ExperimentCard['stage']
  targetMetric: string
  guardrails: string[]
  owner?: string
  audience?: string
  durationDays?: number
  reach?: number
  impact?: number
  confidence?: number
  effort?: number
  ease?: number
  method?: PriorityMethod
}

export function calculatePriority(options: { method: PriorityMethod; reach?: number; impact?: number; confidence?: number; effort?: number; ease?: number }): PriorityItem {
  const reach = options.reach
  const impact = options.impact
  const confidence = options.confidence
  const effort = options.effort
  const ease = options.ease
  let score: number | null = null
  if (options.method === 'rice' && reach !== undefined && impact !== undefined && confidence !== undefined && effort !== undefined && effort > 0) score = reach * impact * confidence / effort
  if (options.method === 'ice' && impact !== undefined && confidence !== undefined && ease !== undefined && ease > 0) score = impact * confidence / ease
  return { method: options.method, reach, impact, confidence, effort, ease, score, title: '', targetMetric: undefined }
}

export function createExperiment(options: ExperimentOptions): ExperimentCard {
  const method = options.method ?? 'rice'
  const priority = calculatePriority({ ...options, method })
  priority.title = options.title
  priority.targetMetric = options.targetMetric
  const guardrails = options.guardrails.length > 0 ? options.guardrails : ['day_7_retention', 'refund_rate', 'support_tickets']
  const successCriteria = `在 ${options.durationDays ?? 14} 天内，${options.targetMetric} 相对对照组达到预设提升，并且护栏指标没有恶化。`
  const stopCriteria = `若主要指标方向相反、样本质量不足，或任一护栏指标达到不可接受阈值，则停止并复盘。`
  const instrumentation = [`记录实验曝光和分组：experiment_id=${options.title}`, `记录主要指标事件：${options.targetMetric}`, ...guardrails.map((item) => `记录护栏指标：${item}`)]
  const markdown = [
    '---',
    'type: experiment',
    'status: proposed',
    `title: ${options.title}`,
    `aarrr_stage: ${options.stage}`,
    `primary_metric: ${options.targetMetric}`,
    `method: HADI`,
    `priority_method: ${method.toUpperCase()}`,
    options.owner ? `owner: ${options.owner}` : '',
    '---',
    '',
    `# ${options.title}`,
    '',
    `## 问题\n${options.problem}`,
    '',
    `## 假设\n${options.hypothesis}`,
    '',
    `## 目标用户\n${options.audience ?? '待补充'}`,
    '',
    `## 主要指标\n${options.targetMetric}`,
    '',
    `## 护栏指标\n${guardrails.map((item) => `- ${item}`).join('\n')}`,
    '',
    `## 成功标准\n${successCriteria}`,
    '',
    `## 停止标准\n${stopCriteria}`,
    '',
    `## 埋点要求\n${instrumentation.map((item) => `- ${item}`).join('\n')}`,
    '',
    `## 优先级\n- 方法：${method.toUpperCase()}\n- 分数：${priority.score === null ? '待补充输入' : priority.score.toFixed(2)}`,
    '',
    '## HADI 复盘',
    '- Hypothesis：',
    '- Action：',
    '- Data：',
    '- Insight：',
  ].filter(Boolean).join('\n')
  return {
    title: options.title,
    problem: options.problem,
    hypothesis: options.hypothesis,
    stage: options.stage,
    targetMetric: options.targetMetric,
    guardrails,
    method: 'HADI',
    owner: options.owner,
    audience: options.audience,
    durationDays: options.durationDays,
    successCriteria,
    stopCriteria,
    instrumentation,
    priority,
    markdown,
  }
}

export function parseGuardrails(value: string | undefined): string[] {
  return parseList(value)
}
