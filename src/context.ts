import type { GrowthAuditResult, GrowthFinding, GrowthNote } from './types.js'

function hasAny(note: GrowthNote, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(note.content))
}

function score(checks: boolean[]): number {
  if (checks.length === 0) return 0
  return Math.round((checks.filter(Boolean).length / checks.length) * 100)
}

function finding(id: string, severity: GrowthFinding['severity'], area: GrowthFinding['area'], message: string, evidence: string, recommendation: string): GrowthFinding {
  return { id, severity, area, message, evidence, recommendation }
}

export function auditGrowthNote(note: GrowthNote): GrowthAuditResult {
  const jtbdChecks = [
    hasAny(note, [/JTBD/i, /Jobs to Be Done/i, /用户任务/, /场景/]),
    hasAny(note, [/目标用户/, /ICP/i, /用户画像/]),
    hasAny(note, [/痛点/, /进步/, /替代/, /为什么购买/]),
  ]
  const pmfChecks = [
    hasAny(note, [/PMF/i, /Product.?Market.?Fit/i, /产品市场匹配/]),
    hasAny(note, [/非常失望/, /very disappointed/i, /留存/, /复购/]),
    note.externalLinks.length > 0,
  ]
  const northStarChecks = [
    hasAny(note, [/North Star/i, /北极星指标/]),
    hasAny(note, [/驱动因素/, /输入指标/, /drivers?/i]),
    hasAny(note, [/目标/, /基线/, /周期/, /target/i]),
  ]
  const aarrrChecks = [
    hasAny(note, [/AARRR/i]),
    hasAny(note, [/Acquisition|获客/i]),
    hasAny(note, [/Activation|激活/i]),
    hasAny(note, [/Retention|留存/i]),
    hasAny(note, [/Referral|推荐|裂变/i]),
    hasAny(note, [/Revenue|收入|MRR/i]),
  ]
  const metricChecks = [
    note.tables.length > 0,
    hasAny(note, [/定义/, /公式/, /分子/, /分母/, /definition/i]),
    hasAny(note, [/数据来源/, /source/i]),
    hasAny(note, [/样本量/, /sample/i]),
    hasAny(note, [/时间范围/, /周期/, /period/i]),
  ]
  const experimentChecks = [
    hasAny(note, [/假设/, /hypothesis/i]),
    hasAny(note, [/实验/, /HADI/i]),
    hasAny(note, [/主要指标/, /护栏指标/, /成功标准/, /success criteria/i]),
    hasAny(note, [/负责人/, /owner/i]),
  ]

  const findings: GrowthFinding[] = []
  if (!jtbdChecks[0]) findings.push(finding('JTBD-001', 'high', 'jtbd', '没有明确记录用户要完成的任务或场景', '文档中未发现 JTBD、用户任务或场景定义', '补充目标用户、触发场景、期望进步和现有替代方案'))
  if (!jtbdChecks[1]) findings.push(finding('JTBD-002', 'medium', 'jtbd', '目标用户定义不足', '未发现 ICP、目标用户或用户画像描述', '把目标用户限定到可识别的群体和使用场景'))
  if (!pmfChecks[0]) findings.push(finding('PMF-001', 'medium', 'pmf', '没有 PMF 检验计划', '未发现 PMF 或产品市场匹配定义', '在扩大获客前加入 PMF Survey、留存和真实使用价值证据'))
  if (!northStarChecks[0]) findings.push(finding('NSM-001', 'high', 'north-star', '没有唯一的 North Star Metric', '未发现北极星指标定义', '定义一个代表用户获得价值且能领先指示收入的指标'))
  if (!northStarChecks[1]) findings.push(finding('NSM-002', 'medium', 'north-star', 'North Star 缺少可行动驱动因素', '未发现驱动因素或输入指标', '拆解 3–5 个团队可以直接影响的驱动因素'))
  if (!aarrrChecks[0]) findings.push(finding('AARRR-001', 'medium', 'aarrr', '增长计划没有映射到 AARRR 阶段', '未发现 AARRR 结构', '标记当前瓶颈属于获客、激活、留存、推荐还是收入'))
  if (aarrrChecks.filter(Boolean).length < 4) findings.push(finding('AARRR-002', 'low', 'aarrr', 'AARRR 覆盖不完整', `只检测到 ${aarrrChecks.filter(Boolean).length}/6 个阶段信号`, '为每个阶段定义事件、分子、分母和目标'))
  if (!metricChecks[1]) findings.push(finding('METRIC-001', 'high', 'metrics', '指标没有明确公式或口径', '未发现分子、分母或定义字段', '补充指标定义、公式、时间窗口和边界条件'))
  if (!metricChecks[2]) findings.push(finding('METRIC-002', 'high', 'evidence', '数据来源不可追溯', '未发现来源 URL、文件或采集说明', '为关键数字补充 source、collectedAt 和来源文件'))
  if (!metricChecks[3]) findings.push(finding('METRIC-003', 'medium', 'metrics', '缺少样本量和数据质量说明', '未发现样本量或覆盖范围', '报告样本量、缺失率、重复事件和失败采集数'))
  if (!experimentChecks[0]) findings.push(finding('EXP-001', 'medium', 'experiment', '没有可证伪的增长假设', '未发现 hypothesis 字段或假设句式', '将想法改写为“如果对谁做什么，则哪个指标会如何变化”'))
  if (!experimentChecks[2]) findings.push(finding('EXP-002', 'medium', 'experiment', '实验缺少成功标准或护栏指标', '未发现主要指标、护栏指标或停止标准', '补充主要指标、护栏指标、成功阈值和停止条件'))
  if (note.externalLinks.length === 0) findings.push(finding('EVIDENCE-001', 'low', 'evidence', '文档没有外部来源链接', '检测到 0 个外部 URL', '为方法论、行业数据和关键事实保留来源；内部数据注明文件路径'))
  if (!hasAny(note, [/负责人/, /owner/i])) findings.push(finding('OPS-001', 'low', 'operations', '没有明确负责人', '未发现 owner 或负责人', '为每个行动指定负责人和截止日期'))

  const readiness = {
    jtbd: score(jtbdChecks),
    pmf: score(pmfChecks),
    northStar: score(northStarChecks),
    aarrr: score(aarrrChecks),
    metrics: score(metricChecks),
    experimentation: score(experimentChecks),
    overall: 0,
  }
  readiness.overall = Math.round((readiness.jtbd + readiness.pmf + readiness.northStar + readiness.aarrr + readiness.metrics + readiness.experimentation) / 6)
  const topActions = findings
    .toSorted((left, right) => ({ critical: 0, high: 1, medium: 2, low: 3, info: 4 }[left.severity] ?? 5) - ({ critical: 0, high: 1, medium: 2, low: 3, info: 4 }[right.severity] ?? 5))
    .slice(0, 5)
    .map((item) => item.recommendation)
  return {
    target: note.path,
    generatedAt: new Date().toISOString(),
    readiness,
    findings,
    topActions,
    missingFields: findings.map((item) => item.id),
  }
}
