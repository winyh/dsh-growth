import { auditGrowthNote } from './context.js'
import { readDataset } from './data.js'
import { inferStages } from './review.js'
import { parseNote } from './markdown.js'
import { doctorRoot, profileDataset } from './quality.js'
import type {
  DatasetProfile,
  FileSystemLike,
  GrowthAuditResult,
  GrowthConfig,
  GrowthNote,
  GrowthOnboardingResult,
  OnboardingDimension,
  OnboardingMethod,
  ReadinessStatus,
  GrowthSop,
  GrowthSopStep,
} from './types.js'

const ignoredDirectories = new Set(['.git', 'node_modules', 'lib', '.dsh-growth'])

export interface OnboardingNote {
  note: GrowthNote
  audit: GrowthAuditResult
  missingMetadata: string[]
}

export interface OnboardingCollection {
  notes: OnboardingNote[]
  scannedFiles: number
  skippedFiles: number
  errors: string[]
}

function extensionOf(path: string): string {
  const match = /\.[^./\\]+$/.exec(path.toLowerCase())
  return match?.[0] ?? ''
}

function isStale(value: unknown): boolean {
  if (typeof value !== 'string' || !value.trim()) return true
  const date = new Date(value)
  return Number.isNaN(date.getTime()) || Date.now() - date.getTime() > 90 * 86_400_000
}

function isGrowthCandidate(note: GrowthNote): boolean {
  const type = String(note.frontmatter.type ?? '').toLowerCase()
  if (['growth-project', 'metric', 'experiment', 'campaign', 'growth-report', 'channel', 'pmf-survey'].includes(type)) return true
  return /JTBD|ICP|PMF|North Star|AARRR|MRR|CAC|LTV|HADI|RICE|WBR|MBR|QBR|growth loop|增长|获客|留存|激活|实验|转化/i.test(note.content)
}

function metadataGaps(note: GrowthNote): string[] {
  const gaps: string[] = []
  if (!note.frontmatter.type) gaps.push('type')
  if (!note.frontmatter.status) gaps.push('status')
  if (isStale(note.frontmatter.updated)) gaps.push('updated')
  if (!note.frontmatter.source && note.externalLinks.length === 0) gaps.push('source')
  if (!note.frontmatter.target && !/target|目标/i.test(note.content)) gaps.push('target')
  if (!note.frontmatter.owner && !/owner|负责人/i.test(note.content)) gaps.push('owner')
  return gaps
}

export async function collectOnboardingNotes(
  fs: FileSystemLike,
  root: string,
  config: GrowthConfig,
  signal?: AbortSignal,
  notePath?: string,
): Promise<OnboardingCollection> {
  const notes: OnboardingNote[] = []
  const errors: string[] = []
  let scannedFiles = 0
  let skippedFiles = 0

  const addNote = (path: string, content: string, force = false): void => {
    const note = parseNote(path, content)
    if (!force && !isGrowthCandidate(note)) return
    notes.push({ note, audit: auditGrowthNote(note), missingMetadata: metadataGaps(note) })
  }

  if (notePath) {
    const target = await fs.resolve(notePath, { signal })
    const info = await fs.stat(target, signal)
    if (!info || info.type !== 'file') throw new Error(`Markdown file not found: ${notePath}`)
    if ((info.size ?? 0) > config.maxFileBytes) throw new Error(`File exceeds maxFileBytes (${config.maxFileBytes})`)
    const content = await fs.readText(target, signal)
    if (content.length > config.maxTextChars) throw new Error(`File exceeds maxTextChars (${config.maxTextChars})`)
    addNote(notePath, content, true)
    return { notes, scannedFiles: 1, skippedFiles: 0, errors }
  }

  async function visit(target: unknown, displayPath: string): Promise<void> {
    if (scannedFiles >= config.maxFiles) {
      skippedFiles += 1
      return
    }
    let entries
    try {
      entries = await fs.listDir(target, signal)
    } catch (error) {
      errors.push(`${displayPath}: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    for (const entry of entries) {
      if (scannedFiles >= config.maxFiles) {
        skippedFiles += 1
        continue
      }
      if (entry.type === 'directory') {
        if (!ignoredDirectories.has(entry.name.toLowerCase())) await visit(entry.target, `${displayPath.replace(/[\\/]$/, '')}/${entry.name}`)
        continue
      }
      if (entry.type !== 'file') continue
      scannedFiles += 1
      if (extensionOf(entry.name) !== '.md') continue
      const path = `${displayPath.replace(/[\\/]$/, '')}/${entry.name}`
      try {
        if ((entry.size ?? 0) > config.maxFileBytes) {
          skippedFiles += 1
          errors.push(`${path}: exceeds maxFileBytes`)
          continue
        }
        const content = await fs.readText(entry.target, signal)
        if (content.length > config.maxTextChars) {
          skippedFiles += 1
          errors.push(`${path}: exceeds maxTextChars`)
          continue
        }
        addNote(path, content)
      } catch (error) {
        errors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  const rootTarget = await fs.resolve(root, { signal })
  await visit(rootTarget, root)
  return { notes, scannedFiles, skippedFiles, errors }
}

function statusForScore(score: number | null): ReadinessStatus {
  if (score === null || score <= 0) return 'missing'
  if (score >= 80) return 'ready'
  return 'partial'
}

function auditScore(audits: OnboardingNote[], key: keyof GrowthAuditResult['readiness']): number | null {
  if (audits.length === 0) return null
  return Math.max(...audits.map((item) => item.audit.readiness[key]))
}

function auditEvidence(audits: OnboardingNote[], key: keyof GrowthAuditResult['readiness']): string[] {
  return audits
    .map((item) => ({ path: item.note.path, score: item.audit.readiness[key] }))
    .toSorted((left, right) => right.score - left.score || left.path.localeCompare(right.path))
    .slice(0, 3)
    .map((item) => `${item.path}: ${item.score}/100`)
}

function dimension(
  id: string,
  label: string,
  score: number | null,
  evidence: string[],
  missing: string[],
  nextAction: string,
): OnboardingDimension {
  return { id, label, status: statusForScore(score), score, evidence, missing, nextAction }
}

function metadataDimension(notes: OnboardingNote[]): OnboardingDimension {
  if (notes.length === 0) return dimension('operations', '运营准备度', null, [], ['项目笔记、负责人、状态、更新时间和来源'], '补充一份带负责人、状态、更新时间和来源的增长项目笔记')
  const healthy = notes.filter((item) => item.missingMetadata.length === 0).length
  const score = Math.round((healthy / notes.length) * 100)
  const missing = [...new Set(notes.flatMap((item) => item.missingMetadata))]
  return dimension(
    'operations',
    '运营准备度',
    score,
    notes.slice(0, 3).map((item) => `${item.note.path}: ${item.missingMetadata.length === 0 ? 'metadata ready' : `missing ${item.missingMetadata.join(', ')}`}`),
    missing,
    missing.length > 0 ? `补齐项目笔记中的 ${missing.join(', ')} 元数据` : '保持项目笔记的状态、更新时间和负责人持续更新',
  )
}

function dataDimension(profiles: DatasetProfile[], warnings: string[]): { dimension: OnboardingDimension; eventProfiles: DatasetProfile[]; economicsProfiles: DatasetProfile[] } {
  const eventProfiles = profiles.filter((profile) => profile.selectedFields.userField && profile.selectedFields.eventField && profile.selectedFields.timeField && inferStages(profile).length >= 2)
  const movementTypes = new Set(['new', 'expansion', 'reactivation', 'contraction', 'churn', 'churned'])
  const economicsProfiles = profiles.filter((profile) => profile.selectedFields.periodField && profile.selectedFields.typeField && profile.selectedFields.amountField && profile.distinctValues.movementTypes.some((value) => movementTypes.has(value.trim().toLowerCase())))
  if (profiles.length === 0) {
    return {
      dimension: dimension('data', '数据基础', 0, [], ['至少一份事件数据；如涉及商业化，还需要 MRR / 成本数据'], '先提供事件导出；如果需要 CAC、LTV 或 Payback，再补充 MRR 和获客成本数据'),
      eventProfiles,
      economicsProfiles,
    }
  }
  const qualityReady = warnings.length === 0 && profiles.every((profile) => profile.quality.status === 'pass' && profile.quality.warnings.length === 0)
  const score = (eventProfiles.length > 0 ? 50 : 0) + (economicsProfiles.length > 0 ? 30 : 0) + (qualityReady ? 20 : 10)
  const missing: string[] = []
  if (eventProfiles.length === 0) missing.push('可识别至少两个阶段的事件数据')
  if (economicsProfiles.length === 0) missing.push('MRR / 成本数据，或明确暂不进行商业化分析')
  if (!qualityReady) missing.push('修复数据质量警告并确认字段映射')
  return {
    dimension: dimension(
      'data',
      '数据基础',
      score,
      profiles.slice(0, 5).map((profile) => `${profile.source}: ${profile.quality.status}, ${profile.rowCount} rows`),
      missing,
      missing[0] ?? '确认数据口径、时间窗口和来源后开始增长复盘',
    ),
    eventProfiles,
    economicsProfiles,
  }
}

function signalStatus(text: string, pattern: RegExp): ReadinessStatus {
  return pattern.test(text) ? 'ready' : 'not-detected'
}

function methodFromDimension(
  id: string,
  name: string,
  capability: OnboardingMethod['pluginCapability'],
  item: OnboardingDimension,
): OnboardingMethod {
  return {
    id,
    name,
    pluginCapability: capability,
    projectStatus: item.status,
    evidence: item.evidence,
    nextAction: item.status === 'ready' ? undefined : item.nextAction,
  }
}

function combinedStatus(items: OnboardingDimension[]): ReadinessStatus {
  const statuses = items.map((item) => item.status)
  if (statuses.every((status) => status === 'ready')) return 'ready'
  if (statuses.some((status) => status === 'missing')) return 'missing'
  if (statuses.some((status) => status === 'partial')) return 'partial'
  if (statuses.some((status) => status === 'not-detected')) return 'not-detected'
  return 'not-applicable'
}

function sopStep(
  id: GrowthSopStep['id'],
  order: number,
  name: string,
  status: ReadinessStatus,
  purpose: string,
  gate: string,
  tool: string,
  prompt: string,
): GrowthSopStep {
  return { id, order, name, status, purpose, gate, tool, prompt }
}

function buildGrowthSop(input: {
  jtbd: OnboardingDimension
  northStar: OnboardingDimension
  metrics: OnboardingDimension
  data: OnboardingDimension
  aarrr: OnboardingDimension
  experimentation: OnboardingDimension
  operations: OnboardingDimension
}): GrowthSop {
  const steps: GrowthSopStep[] = [
    sopStep(
      'context',
      1,
      '问题与价值定义',
      combinedStatus([input.jtbd, input.northStar, input.metrics]),
      '明确服务谁、解决什么任务，以及用哪个指标代表用户获得价值。',
      '目标用户、JTBD、North Star、驱动指标、基线和周期可以被引用。',
      'growth_onboarding → growth_audit_note',
      '先补齐目标用户、JTBD、North Star、指标定义和证据来源，不要直接下增长结论。',
    ),
    sopStep(
      'measurement',
      2,
      '数据与口径体检',
      input.data.status,
      '确认数据能回答问题，且字段、时间窗口、样本和缺失值规则可信。',
      '至少有可识别的事件数据；若本轮涉及收入，还要有 MRR / 成本数据和金额口径。',
      'growth_doctor → growth_profile_dataset',
      '检查我的增长目录，列出可用数据、字段映射、时间范围、质量风险和仍需补齐的字段。',
    ),
    sopStep(
      'diagnosis',
      3,
      '瓶颈与证据诊断',
      combinedStatus([input.aarrr, input.metrics, input.data]),
      '把目标指标拆到漏斗、队列、渠道、分群或收入结构，区分事实与假设。',
      '来源已经确认，关键指标有分子、分母、周期和 lineage；多个候选数据源已完成选择。',
      'growth_review → growth_funnel_analyze / growth_cohort_analyze / growth_economics',
      '以“提升激活率”为目标复盘；先告诉我来源、警告和证据缺口，再给出最大瓶颈，不要把相关性当因果。',
    ),
    sopStep(
      'experiment',
      4,
      'HADI 实验设计',
      combinedStatus([input.aarrr, input.metrics, input.experimentation]),
      '把最高杠杆问题转成可证伪的动作、主指标、护栏和停止条件。',
      '实验有明确人群、动作、主指标、护栏指标、负责人、周期、埋点和成功 / 停止标准。',
      'growth_experiment',
      '把刚才的最大瓶颈转成 HADI 实验，补充主指标、护栏指标、负责人、周期和停止条件。',
    ),
    sopStep(
      'priority',
      5,
      '机会排序与承诺',
      combinedStatus([input.metrics, input.experimentation]),
      '在资源有限时决定先做什么，并让每个评分都能追溯到证据或明确标记为估计。',
      '候选机会有目标指标、证据链接，以及 reach、impact、confidence、effort / ease 等输入。',
      'growth_prioritize',
      '用 RICE 排序候选实验；标出事实、估计值和缺失输入，不要为了得到排名而编造分数。',
    ),
    sopStep(
      'review',
      6,
      '复盘与安全回写',
      combinedStatus([input.metrics, input.operations]),
      '把结果、限制、决策、负责人和下一次验证写入固定运营节奏。',
      '报告中的数字都有来源，行动有负责人和日期；写入必须先 preview，再由用户确认。',
      'growth_report → growth_apply(confirm=false) → growth_apply(confirm=true)',
      '生成本周 WBR，先预览；列出结论、限制、决策、负责人和下周行动，不要直接写文件。',
    ),
  ]
  const next = steps.find((step) => step.status !== 'ready')
  return { currentStep: next?.id ?? 'review', steps }
}

export function buildGrowthOnboarding(input: {
  root: string
  notes: OnboardingNote[]
  profiles: DatasetProfile[]
  datasetWarnings: string[]
  scanErrors: string[]
  skippedFiles?: number
}): GrowthOnboardingResult {
  const { notes, profiles } = input
  const data = dataDimension(profiles, input.datasetWarnings)
  const audits = notes
  const text = notes.map((item) => item.note.content).join('\n')
  const jtbd = dimension('jtbd', 'JTBD / ICP', auditScore(audits, 'jtbd'), auditEvidence(audits, 'jtbd'), ['目标用户、触发场景、期望进步和现有替代方案'], '补充目标用户、触发场景、期望进步和现有替代方案')
  const pmf = dimension('pmf', 'PMF 验证', auditScore(audits, 'pmf'), auditEvidence(audits, 'pmf'), ['PMF Survey 或真实使用、留存、复购和推荐证据'], '补充 PMF Survey、真实使用证据和来源，不把 40% 当成结论')
  const northStar = dimension('northStar', 'North Star 与驱动因素', auditScore(audits, 'northStar'), auditEvidence(audits, 'northStar'), ['North Star、驱动因素、基线、目标和统计周期'], '确定一个 North Star，并拆出 3—5 个可行动驱动因素')
  const aarrr = dimension('aarrr', 'AARRR 口径', auditScore(audits, 'aarrr'), auditEvidence(audits, 'aarrr'), ['五个阶段的事件、分子、分母、时间窗口和目标'], '为当前关注的 AARRR 阶段补齐事件、分子、分母和目标')
  const metrics = dimension('metrics', '指标与证据', auditScore(audits, 'metrics'), auditEvidence(audits, 'metrics'), ['公式、数据来源、样本量、时间范围和缺失值规则'], '把关键指标写入指标字典，并绑定来源、时间范围和样本量')
  const experimentation = dimension('experimentation', '实验条件', auditScore(audits, 'experimentation'), auditEvidence(audits, 'experimentation'), ['可证伪假设、主指标、护栏指标、负责人和停止条件'], '把最高优先级问题转成带主指标、护栏指标和负责人的 HADI 实验')
  const operations = metadataDimension(notes)
  const dimensions = [jtbd, pmf, northStar, aarrr, metrics, data.dimension, experimentation, operations]
  const scores = dimensions.map((item) => item.score).filter((score): score is number => score !== null)
  const overallScore = scores.length === 0 ? 0 : Math.round(scores.reduce((sum, score) => sum + score, 0) / dimensions.length)
  const missingOrPartial = dimensions.filter((item) => item.status === 'missing' || item.status === 'partial').length
  const overallStatus: GrowthOnboardingResult['overallStatus'] = overallScore === 0 ? 'blocked' : missingOrPartial === 0 ? 'ready' : 'partial'
  const classicDocumentationMethod = (id: string, name: string, pattern: RegExp, nextAction: string) => {
    const projectStatus = signalStatus(text, pattern)
    return {
      id,
      name,
      pluginCapability: 'documentation' as const,
      projectStatus,
      evidence: projectStatus === 'ready' ? [`${name} is mentioned in the growth notes`] : [],
      nextAction,
    }
  }

  const methods: OnboardingMethod[] = [
    methodFromDimension('jtbd', 'JTBD / ICP', 'audit', jtbd),
    methodFromDimension('pmf', 'PMF Survey', 'template', pmf),
    methodFromDimension('northStar', 'North Star / Driver Tree', 'audit', northStar),
    methodFromDimension('aarrr', 'AARRR Funnel', 'analysis', aarrr),
    {
      id: 'cohort',
      name: 'Cohort / Retention',
      pluginCapability: 'analysis',
      projectStatus: data.eventProfiles.some((profile) => inferStages(profile).some((stage) => stage.name === 'Retention')) ? 'ready' : data.eventProfiles.length > 0 ? 'partial' : 'missing',
      evidence: data.eventProfiles.slice(0, 3).map((profile) => `${profile.source}: ${inferStages(profile).map((stage) => stage.name).join(', ')}`),
      nextAction: data.eventProfiles.length === 0 ? '补充带用户、事件和时间字段的事件数据' : '确认留存事件、队列周期和分群口径',
    },
    {
      id: 'economics',
      name: 'MRR / Unit Economics',
      pluginCapability: 'analysis',
      projectStatus: data.economicsProfiles.length > 0 ? 'ready' : 'missing',
      evidence: data.economicsProfiles.slice(0, 3).map((profile) => `${profile.source}: period/type/amount detected`),
      nextAction: data.economicsProfiles.length === 0 ? '补充 MRR movement、active_customers、spend 和 gross margin 口径' : '确认 amountMode、movementSource、gross margin 和期初 MRR',
    },
    methodFromDimension('hadi', 'HADI Experiments', 'analysis', experimentation),
    {
      id: 'rice',
      name: 'RICE / ICE',
      pluginCapability: 'analysis',
      projectStatus: signalStatus(text, /\bRICE\b|\bICE\b/i),
      evidence: signalStatus(text, /\bRICE\b|\bICE\b/i) === 'ready' ? ['A priority method is mentioned in the growth notes'] : [],
      nextAction: '为候选实验补充 reach、impact、confidence、effort 或 ease，并标注证据与估计值',
    },
    {
      id: 'growth-loops',
      name: 'Growth Loops',
      pluginCapability: 'documentation',
      projectStatus: signalStatus(text, /growth loop|增长循环|增长飞轮/i),
      evidence: signalStatus(text, /growth loop|增长循环|增长飞轮/i) === 'ready' ? ['A loop is mentioned in the growth notes'] : [],
      nextAction: '如果增长依赖循环，补充输入、动作、输出、回流点和限制条件',
    },
    {
      id: 'external-acquisition',
      name: 'External Acquisition Plan / Directory Submission SOP',
      pluginCapability: 'documentation',
      projectStatus: signalStatus(text, /external acquisition|directory submission|backlink|外链|目录提交|渠道提交|外部获客/i),
      evidence: signalStatus(text, /external acquisition|directory submission|backlink|外链|目录提交|渠道提交|外部获客/i) === 'ready' ? ['An external acquisition or directory-submission workflow is mentioned in the growth notes'] : [],
      nextAction: '使用 growth-acquisition-execution skill，先做相关性和合规质量门，产出不超过 10 个站点的试点方案与授权清单；不执行外部提交',
    },
    {
      id: 'ai-discoverability',
      name: 'AI Search / Discoverability Readiness',
      pluginCapability: 'documentation',
      projectStatus: signalStatus(text, /AI search|AI readiness|AI discoverability|LLM|AEO|生成式搜索|AI 搜索|AI 可发现性|结构化数据|Product schema|Merchant Center/i),
      evidence: signalStatus(text, /AI search|AI readiness|AI discoverability|LLM|AEO|生成式搜索|AI 搜索|AI 可发现性|结构化数据|Product schema|Merchant Center/i) === 'ready' ? ['AI search or discoverability readiness is mentioned in the growth notes'] : [],
      nextAction: '使用 growth-ai-discoverability skill，先判断业务类型和适用检查项，产出 AI 搜索可发现性准备度矩阵；不执行网站改造',
    },
    classicDocumentationMethod('value-proposition-canvas', 'Value Proposition Canvas', /value proposition canvas|value proposition|价值主张画布|价值主张/i, '使用 growth-strategy-planning，补齐用户 Jobs / Pains / Gains 与产品匹配证据'),
    classicDocumentationMethod('lean-canvas', 'Lean Canvas', /lean canvas|精益画布/i, '使用 growth-strategy-planning，整理问题、客户、渠道、收入和最高风险假设'),
    classicDocumentationMethod('activation-event', 'Aha Moment / Activation Event', /aha moment|activation event|首次价值行为|激活事件|Aha 时刻/i, '使用 growth-strategy-planning，定义首次价值行为、激活窗口和留存验证'),
    classicDocumentationMethod('churn-winback', 'Churn Taxonomy / Win-back', /churn taxonomy|win-back|winback|流失分类|流失原因|召回|挽回/i, '使用 growth-strategy-planning，建立流失分类、预警信号和召回假设'),
    classicDocumentationMethod('bullseye-channels', 'Bullseye Channel Framework', /bullseye framework|bullseye|靶心框架|渠道假设|渠道优先级/i, '使用 growth-strategy-planning，整理候选、验证和重点渠道，并绑定停止条件'),
    classicDocumentationMethod('opportunity-solution-tree', 'Opportunity Solution Tree', /opportunity solution tree|机会解决方案树|机会树|OST/i, '使用 growth-strategy-planning，把目标、机会、方案和实验分层，避免直接跳到功能'),
    classicDocumentationMethod('customer-research', 'The Mom Test / Switch Interview', /the mom test|mom test|switch interview|用户访谈|客户研究|切换访谈/i, '使用 growth-strategy-planning，生成基于最近真实行为的访谈提纲和证据编码'),
    classicDocumentationMethod('referral-loop', 'Referral Loop / K-factor', /referral loop|k-factor|推荐循环|推荐系数|邀请循环/i, '使用 growth-strategy-planning，定义推荐触发、受邀激活和质量护栏'),
    classicDocumentationMethod('market-sizing', 'TAM / SAM / SOM', /\bTAM\b|\bSAM\b|\bSOM\b|市场规模|可服务市场/i, '使用 growth-strategy-planning，建立带来源、区间和敏感性分析的市场估算'),
    classicDocumentationMethod('pricing-research', 'Pricing Research', /Van Westendorp|Gabor-Granger|定价研究|价格敏感度|套餐设计/i, '使用 growth-strategy-planning，形成价格研究假设、套餐方案和收入护栏'),
    classicDocumentationMethod('b2b-revenue-funnel', 'B2B Revenue Funnel / MEDDICC', /\bMQL\b|\bSQL\b|MEDDICC|B2B 销售漏斗|销售漏斗|机会阶段/i, '使用 growth-strategy-planning，统一线索、机会、成交阶段和证据要求'),
    classicDocumentationMethod('growth-accounting', 'Growth Accounting', /growth accounting|增长核算|用户增长桥|收入增长桥/i, '使用 growth-strategy-planning，拆解新增、留存、流失、召回和扩张贡献'),
    classicDocumentationMethod('operating-cadence', 'OKR / A3 / OODA / Decision Log', /\bOKR\b|A3 problem|5 Whys|\bOODA\b|决策日志|decision log/i, '使用 growth-strategy-planning，统一目标、问题、行动、决策和复盘记录'),
    {
      id: 'operating-review',
      name: 'WBR / MBR / QBR',
      pluginCapability: 'analysis',
      projectStatus: signalStatus(text, /\bWBR\b|\bMBR\b|\bQBR\b/i),
      evidence: signalStatus(text, /\bWBR\b|\bMBR\b|\bQBR\b/i) === 'ready' ? ['An operating review is mentioned in the growth notes'] : [],
      nextAction: '用 growth_report 生成一次只读预览，并绑定指标、发现、实验、行动和 caveats',
    },
    {
      id: 'causal-inference',
      name: '因果推断 / 实验统计',
      pluginCapability: 'not-supported',
      projectStatus: 'not-applicable',
      evidence: ['当前插件不计算显著性、贝叶斯结果或因果效应'],
      nextAction: '需要严格实验统计时，使用外部实验平台或统计分析流程，并把结果作为证据来源接入',
    },
    {
      id: 'market-pricing',
      name: '市场规模 / 竞品 / 定价',
      pluginCapability: 'not-supported',
      projectStatus: 'not-applicable',
      evidence: ['当前插件不连接市场、竞品、CRM 或广告平台数据'],
      nextAction: '先在外部研究或业务文档中完成，再把结论和来源带回增长项目笔记',
    },
  ]

  const sop = buildGrowthSop({
    jtbd,
    northStar,
    metrics,
    data: data.dimension,
    aarrr,
    experimentation,
    operations,
  })

  const actionCandidates = dimensions
    .filter((item) => item.status === 'missing' || item.status === 'partial')
    .toSorted((left, right) => (left.status === 'missing' ? 0 : 1) - (right.status === 'missing' ? 0 : 1))
    .map((item) => item.nextAction)
  const topActions = [...new Set(actionCandidates)].slice(0, 2)
  const questions: string[] = []
  if (jtbd.status !== 'ready') questions.push('产品服务谁？用户在什么场景下想完成什么进步？')
  if (data.eventProfiles.length === 0) questions.push('哪一份事件数据可以代表注册、激活或留存？')
  if (data.economicsProfiles.length === 0) questions.push('本轮是否需要分析收入和获客成本？如果需要，请提供 MRR / 成本数据。')
  if (questions.length < 3 && northStar.status !== 'ready') questions.push('当前最能代表用户获得价值的一个 North Star 指标是什么？')

  const warnings = [...new Set([
    ...input.datasetWarnings,
    ...input.scanErrors,
    ...(input.skippedFiles && input.skippedFiles > 0 ? [`${input.skippedFiles} file(s) were skipped because of scan limits`] : []),
    ...(notes.length === 0 ? ['No growth Markdown note was found; strategy readiness is based on missing evidence, not a product judgment'] : []),
  ])]
  return {
    generatedAt: new Date().toISOString(),
    root: input.root,
    overallStatus,
    overallScore,
    sources: {
      growthNotes: notes.length,
      datasets: profiles.length,
      eventDatasets: data.eventProfiles.map((profile) => profile.source),
      economicsDatasets: data.economicsProfiles.map((profile) => profile.source),
      notes: notes.slice(0, 20).map((item) => ({ path: item.note.path, title: item.note.title, readiness: item.audit.readiness.overall, missingMetadata: item.missingMetadata })),
    },
    dimensions,
    methods,
    sop,
    topActions,
    questions: questions.slice(0, 3),
    warnings,
  }
}

export async function collectOnboardingProfiles(
  fs: FileSystemLike,
  config: GrowthConfig,
  root: string,
  signal?: AbortSignal,
  growthData?: {
    doctor(root: string, signal?: AbortSignal): Promise<{ datasets: Array<{ path: string; status: string; warnings: string[] }>; checks: Array<{ status: string; message: string }> }>
    readDataset(path: string, signal?: AbortSignal): Promise<{ rows: import('./types.js').Row[]; warnings: string[] }>
    profileDataset(path: string, rows: import('./types.js').Row[]): DatasetProfile
  },
): Promise<{ profiles: DatasetProfile[]; warnings: string[] }> {
  const health = await (growthData?.doctor(root, signal) ?? doctorRoot(fs, root, config, signal))
  const warnings = [
    ...health.checks.filter((check) => check.status === 'warning').map((check) => `Data scan: ${check.message}`),
  ]
  const profiles: DatasetProfile[] = []
  for (const summary of health.datasets) {
    if (summary.status === 'error') continue
    try {
      const dataset = await (growthData?.readDataset(summary.path, signal) ?? readDataset(fs, config, summary.path, signal))
      const profile = growthData?.profileDataset(summary.path, dataset.rows) ?? profileDataset(summary.path, dataset.rows)
      profile.quality.warnings = [...new Set([...profile.quality.warnings, ...dataset.warnings, ...summary.warnings])]
      profiles.push(profile)
    } catch (error) {
      warnings.push(`Data scan skipped '${summary.path}': ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return { profiles, warnings }
}
