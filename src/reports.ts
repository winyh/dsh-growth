import type { ReportInput, ReportType } from './types.js'

const labels: Record<ReportType, string> = {
  wbr: '周增长复盘',
  mbr: '月度增长复盘',
  qbr: '季度增长复盘',
  'experiment-review': '增长实验复盘',
}

export function renderReport(input: ReportInput): string {
  const metricRows = input.metrics.length === 0
    ? '| 指标 | 当前 | 上期 | 变化 | 来源 |\n| --- | --- | --- | --- | --- |\n| 暂无 | - | - | - | - |'
    : [
      '| 指标 | 当前 | 上期 | 变化 | 来源 |',
      '| --- | --- | --- | --- | --- |',
      ...input.metrics.map((metric) => `| ${metric.name} | ${metric.current} | ${metric.previous ?? '-'} | ${metric.delta ?? '-'} | ${metric.source ?? '-'} |`),
    ].join('\n')
  const list = (items: string[]) => items.length > 0 ? items.map((item) => `- ${item}`).join('\n') : '- 暂无'
  return [
    `# ${input.title}`,
    '',
    `> 类型：${labels[input.reportType]} | 周期：${input.period}`,
    '',
    '## 结论摘要',
    input.summary || '待补充',
    '',
    '## 指标变化',
    metricRows,
    '',
    '## 主要发现',
    list(input.findings),
    '',
    '## 实验与动作',
    list(input.experiments),
    '',
    '## 下一周期行动',
    list(input.nextActions),
    '',
    '## 口径与限制',
    list(input.caveats),
    '',
    `- 生成时间：${new Date().toISOString()}`,
    '- 说明：相关性线索不等于因果结论；缺失数据未按零处理。',
  ].join('\n')
}
