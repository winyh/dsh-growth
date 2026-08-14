import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-fs'
import { registerGrowthTools } from './tools.js'
import type { GrowthConfig } from './types.js'

export const name = 'dsh-growth'
export const inject = ['tools', 'fs']

export type Config = GrowthConfig

export const Config: Schema<GrowthConfig> = Schema.object({
  defaultRoot: Schema.string().default('D:\\ObsidianData'),
  reportDir: Schema.string().default('.dsh-growth/reports'),
  maxFiles: Schema.number().default(500),
  maxRows: Schema.number().default(100_000),
  maxFileBytes: Schema.number().default(1_048_576),
  maxTextChars: Schema.number().default(180_000),
  maxResultChars: Schema.number().default(50_000),
  defaultCurrency: Schema.string().default('CNY'),
  defaultTimezone: Schema.string().default('Asia/Shanghai'),
})

export function apply(ctx: Context, config: GrowthConfig): void {
  registerGrowthTools(ctx, config)
}
