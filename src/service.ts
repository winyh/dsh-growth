import { Context, Service } from '@deepseek-ai/cordis'
import { profileDataset as inspectDataset, doctorRoot } from './quality.js'
import { readDataset as loadDataset } from './data.js'
import type { FileSystemLike, GrowthConfig, DatasetProfile, GrowthDoctorResult, Row } from './types.js'

export interface GrowthDataServiceApi {
  readDataset(path: string, signal?: AbortSignal): Promise<{ source: string; rows: Row[]; warnings: string[] }>
  profileDataset(path: string, rows: Row[], hints?: Record<string, string | undefined>): DatasetProfile
  doctor(root: string, signal?: AbortSignal): Promise<GrowthDoctorResult>
}

export class GrowthDataService extends Service<GrowthDataServiceApi> implements GrowthDataServiceApi {
  private readonly fs: FileSystemLike
  private readonly config: GrowthConfig

  constructor(ctx: Context, fs: FileSystemLike, config: GrowthConfig) {
    super(ctx, 'growth-data')
    this.fs = fs
    this.config = config
  }

  readDataset(path: string, signal?: AbortSignal) {
    return loadDataset(this.fs, this.config, path, signal)
  }

  profileDataset(path: string, rows: Row[], hints: Record<string, string | undefined> = {}) {
    return inspectDataset(path, rows, hints)
  }

  doctor(root: string, signal?: AbortSignal) {
    return doctorRoot(this.fs, root, this.config, signal)
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    'growth-data': GrowthDataServiceApi
  }

  interface Events {
    'growth/analysis-started'(payload: { kind: string; sources: string[]; goal?: string }): void
    'growth/analysis-completed'(payload: { kind: string; sources: string[]; warningCount: number }): void
    'growth/warning'(payload: { kind: string; source?: string; message: string }): void
    'growth/report-previewed'(payload: { path?: string; sourceCount: number }): void
    'growth/report-applied'(payload: { path: string }): void
  }
}

