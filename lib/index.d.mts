import Schema from "@deepseek-ai/schemastery";
import { Context } from "@deepseek-ai/cordis";

//#region src/types.d.ts

interface GrowthConfig {
  defaultRoot: string;
  reportDir: string;
  maxFiles: number;
  maxRows: number;
  maxFileBytes: number;
  maxTextChars: number;
  maxResultChars: number;
  defaultCurrency: string;
  defaultTimezone: string;
}
//#endregion
//#region src/index.d.ts
declare const name = "dsh-growth";
declare const inject: string[];
type Config = GrowthConfig;
declare const Config: Schema<GrowthConfig>;
declare function apply(ctx: Context, config: GrowthConfig): void;
//#endregion
export { Config, apply, inject, name };