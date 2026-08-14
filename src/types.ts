export type GrowthStage = 'acquisition' | 'activation' | 'retention' | 'referral' | 'revenue'
export type ReportType = 'wbr' | 'mbr' | 'qbr' | 'experiment-review'
export type PriorityMethod = 'rice' | 'ice'

export type Primitive = string | number | boolean | null
export type Row = Record<string, Primitive | Primitive[] | Record<string, unknown> | undefined>

export interface Frontmatter {
  [key: string]: unknown
}

export interface MarkdownTable {
  headers: string[]
  rows: Array<Record<string, string>>
}

export interface GrowthNote {
  path: string
  title: string
  content: string
  frontmatter: Frontmatter
  headings: string[]
  tables: MarkdownTable[]
  internalLinks: string[]
  externalLinks: string[]
  wordCount: number
}

export interface GrowthFinding {
  id: string
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  area: 'jtbd' | 'pmf' | 'north-star' | 'aarrr' | 'metrics' | 'evidence' | 'experiment' | 'operations'
  message: string
  evidence: string
  recommendation: string
}

export interface GrowthAuditResult {
  target: string
  generatedAt: string
  readiness: {
    overall: number
    jtbd: number
    pmf: number
    northStar: number
    aarrr: number
    metrics: number
    experimentation: number
  }
  findings: GrowthFinding[]
  topActions: string[]
  missingFields: string[]
}

export interface GrowthScanResult {
  root: string
  generatedAt: string
  scannedFiles: number
  skippedFiles: number
  errors: string[]
  summary: {
    growthNotes: number
    missingMetadata: number
    staleNotes: number
    missingSources: number
    missingTargets: number
    byType: Record<string, number>
    byStatus: Record<string, number>
  }
  priorityFiles: Array<{
    path: string
    title: string
    type: string
    status: string
    reasons: string[]
  }>
}

export interface GrowthConfig {
  defaultRoot: string
  reportDir: string
  maxFiles: number
  maxRows: number
  maxFileBytes: number
  maxTextChars: number
  maxResultChars: number
  defaultCurrency: string
  defaultTimezone: string
}

export interface FileSystemLike {
  resolve(path: string, options?: { cwd?: string; signal?: AbortSignal }): Promise<unknown>
  contains(parent: unknown, child: unknown): boolean
  stat(target: unknown, signal?: AbortSignal): Promise<{ type: string; size?: number; version: unknown } | undefined>
  readText(target: unknown, signal?: AbortSignal): Promise<string>
  listDir(target: unknown, signal?: AbortSignal): Promise<Array<{
    name: string
    type: string
    target: unknown
    size?: number
  }>>
  writeText(target: unknown, content: string, expected?: unknown, signal?: AbortSignal): Promise<unknown>
}

export interface Dataset {
  source: string
  rows: Row[]
  warnings: string[]
}

export type QualityStatus = 'pass' | 'warning' | 'error'

export interface FieldCandidate {
  field: string
  score: number
  coverage: number
  nonEmpty: number
  reason: string
}

export interface DatasetProfile {
  source: string
  rowCount: number
  columnCount: number
  columns: string[]
  fieldCandidates: Record<string, FieldCandidate[]>
  selectedFields: Record<string, string | null>
  distinctValues: {
    events: string[]
    movementTypes: string[]
    currencies: string[]
  }
  dateRange: { min: string; max: string } | null
  quality: {
    status: QualityStatus
    duplicateRows: number
    missingRows: number
    invalidDateRows: number
    invalidNumberRows: number
    warnings: string[]
  }
  recommendations: string[]
}

export interface DoctorFileSummary {
  path: string
  extension: string
  rowCount: number | null
  status: QualityStatus
  warnings: string[]
}

export interface GrowthDoctorResult {
  generatedAt: string
  root: string
  checks: Array<{ name: string; status: QualityStatus; message: string }>
  files: {
    scanned: number
    supported: number
    skipped: number
    byExtension: Record<string, number>
  }
  datasets: DoctorFileSummary[]
  summary: {
    status: QualityStatus
    errors: number
    warnings: number
  }
  nextActions: string[]
}

export interface GrowthReviewResult {
  generatedAt: string
  goal: string
  profiles: DatasetProfile[]
  analyses: {
    funnel?: FunnelAnalysis
    cohort?: CohortAnalysis
    economics?: EconomicsAnalysis
    noteAudit?: GrowthAuditResult
  }
  bottlenecks: string[]
  hypotheses: string[]
  nextActions: string[]
  warnings: string[]
}

export interface FunnelStageResult {
  name: string
  event: string
  users: number
  conversionFromPrevious: number | null
  conversionFromEntry: number | null
  dropOffFromPrevious: number | null
}

export interface FunnelAnalysis {
  generatedAt: string
  source: string
  userCount: number
  eventRows: number
  sequenceMode?: 'any-event' | 'ordered'
  attribution?: 'first-touch' | 'last-touch' | 'entry-touch'
  conversionWindowDays?: number | null
  timezone?: string
  stages: FunnelStageResult[]
  bottleneck: FunnelStageResult | null
  byChannel: Record<string, FunnelStageResult[]>
  bySegment: Record<string, FunnelStageResult[]>
  warnings: string[]
}

export interface CohortCell {
  period: number
  cohortSize: number
  retainedUsers: number
  retentionRate: number | null
}

export interface CohortAnalysis {
  generatedAt: string
  source: string
  cohortEvent: string
  retentionEvent: string
  interval: 'day' | 'week' | 'month'
  timezone?: string
  cohorts: Array<{
    cohort: string
    size: number
    cells: CohortCell[]
  }>
  lifecycle: Record<string, number>
  warnings: string[]
}

export interface EconomicsAnalysis {
  generatedAt: string
  source: string
  currency: string
  amountMode?: 'absolute' | 'signed'
  movementSource?: 'movement' | 'snapshot'
  periods: Array<{
    period: string
    beginningMrr: number | null
    newMrr: number | null
    expansionMrr: number | null
    reactivationMrr: number | null
    contractionMrr: number | null
    churnedMrr: number | null
    endingMrr: number | null
    mrrGrowthRate: number | null
    activeCustomers: number | null
    arpa: number | null
    logoChurnRate: number | null
    revenueChurnRate: number | null
    nrr: number | null
    cac: number | null
    ltv: number | null
    paybackMonths: number | null
  }>
  totals: {
    endingMrr: number | null
    arr: number | null
    totalSpend: number | null
    totalNewCustomers: number
  }
  warnings: string[]
}

export interface PriorityItem {
  title: string
  reach?: number
  impact?: number
  confidence?: number
  effort?: number
  ease?: number
  score: number | null
  method: PriorityMethod
  evidence?: string
  targetMetric?: string
}

export interface ExperimentCard {
  title: string
  problem: string
  hypothesis: string
  stage: GrowthStage
  targetMetric: string
  guardrails: string[]
  method: 'HADI'
  owner?: string
  audience?: string
  durationDays?: number
  successCriteria: string
  stopCriteria: string
  instrumentation: string[]
  priority: PriorityItem
  markdown: string
}

export interface DiagnosticHypothesis {
  rank: number
  hypothesis: string
  evidence: string[]
  confidence: 'high' | 'medium' | 'low'
  nextCheck: string
}

export interface DiagnosticResult {
  generatedAt: string
  metric: string
  current: number
  previous: number
  delta: number
  deltaRate: number | null
  interpretation: string
  hypotheses: DiagnosticHypothesis[]
  dataGaps: string[]
  nextActions: string[]
}

export interface ReportInput {
  title: string
  reportType: ReportType
  period: string
  summary: string
  metrics: Array<{ name: string; current: string; previous?: string; delta?: string; source?: string }>
  findings: string[]
  experiments: string[]
  nextActions: string[]
  caveats: string[]
}
