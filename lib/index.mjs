import Schema from "@deepseek-ai/schemastery";
import { Service } from "@deepseek-ai/cordis";
import { defineTool } from "@deepseek-ai/dsh-tools";

//#region src/data.ts
function parseCsvLine(line) {
	const cells = [];
	let current = "";
	let quoted = false;
	for (let index = 0; index < line.length; index += 1) {
		const char = line[index];
		if (char === "\"") if (quoted && line[index + 1] === "\"") {
			current += "\"";
			index += 1;
		} else quoted = !quoted;
		else if (char === "," && !quoted) {
			cells.push(current.trim());
			current = "";
		} else current += char;
	}
	cells.push(current.trim());
	return cells;
}
function normalizeCell(value$1) {
	if (value$1 === void 0 || value$1 === null) return value$1;
	if (typeof value$1 !== "string") return value$1;
	const trimmed = value$1.trim();
	if (!trimmed) return "";
	if (trimmed === "true") return true;
	if (trimmed === "false") return false;
	if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
	return trimmed;
}
function parseCsv(content) {
	const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim().length > 0);
	if (lines.length === 0) return [];
	const headers = parseCsvLine(lines[0] ?? "").map((header) => header.trim());
	return lines.slice(1).map((line) => {
		const cells = parseCsvLine(line);
		return Object.fromEntries(headers.map((header, index) => [header, normalizeCell(cells[index])]));
	});
}
function parseJson(content) {
	const parsed = JSON.parse(content);
	if (Array.isArray(parsed)) return parsed.filter((item) => typeof item === "object" && item !== null && !Array.isArray(item));
	if (typeof parsed === "object" && parsed !== null) return [parsed];
	throw new Error("JSON dataset must be an object or an array of objects");
}
function parseJsonLines(content) {
	const rows = [];
	for (const [index, line] of content.split(/\r?\n/).entries()) {
		if (!line.trim()) continue;
		const parsed = JSON.parse(line);
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error(`JSONL line ${index + 1} is not an object`);
		rows.push(parsed);
	}
	return rows;
}
function parseDataset(path, content, maxRows) {
	const lower = path.toLowerCase();
	const warnings = [];
	let rows;
	if (lower.endsWith(".csv")) rows = parseCsv(content);
	else if (lower.endsWith(".jsonl") || lower.endsWith(".ndjson")) rows = parseJsonLines(content);
	else if (lower.endsWith(".json")) rows = parseJson(content);
	else throw new Error(`Unsupported dataset format: ${path}`);
	if (rows.length > maxRows) {
		warnings.push(`Rows truncated from ${rows.length} to configured maxRows ${maxRows}`);
		rows = rows.slice(0, maxRows);
	}
	if (rows.length === 0) warnings.push("Dataset contains no rows");
	return {
		rows,
		warnings
	};
}
async function readDataset(fs, config, path, signal) {
	const target = await fs.resolve(path, { signal });
	const info = await fs.stat(target, signal);
	if (!info || info.type !== "file") throw new Error(`Dataset not found: ${path}`);
	if ((info.size ?? 0) > config.maxFileBytes) throw new Error(`Dataset exceeds maxFileBytes (${config.maxFileBytes})`);
	const content = await fs.readText(target, signal);
	if (content.length > config.maxTextChars) throw new Error(`Dataset exceeds maxTextChars (${config.maxTextChars})`);
	return {
		source: path,
		...parseDataset(path, content, config.maxRows)
	};
}
function value(row, key) {
	if (!key) return void 0;
	return row[key];
}
function stringValue(row, key) {
	const current = value(row, key);
	if (current === void 0 || current === null || current === "") return void 0;
	return String(current);
}
function numberValue(row, key) {
	const current = value(row, key);
	if (typeof current === "number" && Number.isFinite(current)) return current;
	if (typeof current === "string" && current.trim() && Number.isFinite(Number(current))) return Number(current);
}
function dateValue(row, key) {
	const current = stringValue(row, key);
	if (!current) return void 0;
	const date = new Date(current);
	return Number.isNaN(date.getTime()) ? void 0 : date;
}

//#endregion
//#region src/quality.ts
const aliases = {
	userField: [
		"user_id",
		"userid",
		"user",
		"visitor_id",
		"member_id",
		"account_id"
	],
	eventField: [
		"event",
		"event_name",
		"eventname",
		"action",
		"activity"
	],
	timeField: [
		"timestamp",
		"occurred_at",
		"occurredat",
		"datetime",
		"date",
		"time",
		"created_at",
		"createdat"
	],
	channelField: [
		"channel",
		"acquisition_channel",
		"source",
		"utm_source",
		"campaign"
	],
	segmentField: [
		"segment",
		"plan",
		"tier",
		"country",
		"region",
		"cohort"
	],
	periodField: [
		"period",
		"month",
		"week",
		"billing_period"
	],
	typeField: [
		"movement_type",
		"movement",
		"type",
		"kind",
		"change_type"
	],
	amountField: [
		"amount",
		"mrr",
		"revenue",
		"value",
		"arr",
		"delta_mrr"
	],
	customerField: [
		"customer_id",
		"customerid",
		"account_id",
		"user_id"
	],
	spendField: [
		"spend",
		"cost",
		"acquisition_spend",
		"marketing_spend",
		"ad_spend"
	],
	currencyField: [
		"currency",
		"currency_code",
		"currencycode"
	]
};
const supportedExtensions = new Set([
	".csv",
	".json",
	".jsonl",
	".ndjson"
]);
const ignoredDirectories$1 = new Set([
	".git",
	"node_modules",
	"lib",
	".dsh-growth"
]);
function normalized(value$1) {
	return value$1.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}
function nonEmpty(value$1) {
	return value$1 !== void 0 && value$1 !== null && value$1 !== "";
}
function percentage$1(value$1, total) {
	return total === 0 ? 0 : Math.round(value$1 / total * 1e3) / 10;
}
function valuesFor(rows, field) {
	if (!field) return [];
	const values = /* @__PURE__ */ new Set();
	for (const row of rows) {
		const value$1 = stringValue(row, field);
		if (value$1) values.add(value$1);
		if (values.size >= 50) break;
	}
	return [...values].toSorted((left, right) => left.localeCompare(right)).slice(0, 50);
}
function fieldScore(field, role, rows) {
	const normalizedField = normalized(field);
	const roleAliases = aliases[role];
	const exactIndex = roleAliases.indexOf(normalizedField);
	const contains = roleAliases.some((alias) => normalizedField.includes(alias) || alias.includes(normalizedField));
	const coverageCount = rows.filter((row) => nonEmpty(row[field])).length;
	const coverage = percentage$1(coverageCount, rows.length);
	return {
		field,
		score: (exactIndex >= 0 ? 100 : contains ? 60 : 0) + Math.round(coverage / 5),
		coverage,
		nonEmpty: coverageCount,
		reason: exactIndex >= 0 ? `field name matches ${role}` : contains ? `field name is similar to a ${role} alias` : `coverage ${coverage}%`
	};
}
function candidates(columns, role, rows) {
	return columns.map((field) => fieldScore(field, role, rows)).filter((candidate) => candidate.score > 0).toSorted((left, right) => right.score - left.score || right.coverage - left.coverage).slice(0, 5);
}
function selectField(role, fields, hint, columns) {
	if (hint?.trim()) {
		if (!columns.includes(hint.trim())) throw new Error(`${role} hint '${hint}' is not a column in the dataset`);
		return hint.trim();
	}
	return fields[0]?.field ?? null;
}
function rowFingerprint(row) {
	try {
		return JSON.stringify(Object.entries(row).toSorted(([left], [right]) => left.localeCompare(right)));
	} catch {
		return Object.keys(row).toSorted().join("|");
	}
}
function statusFor(rowCount, selectedFields, invalidDateRows, invalidNumberRows, emptySelectedFields) {
	if (rowCount === 0) return "error";
	if (Object.values(selectedFields).filter(Boolean).length === 0) return "error";
	if (emptySelectedFields > 0) return "warning";
	if (invalidDateRows > rowCount * .2 || invalidNumberRows > rowCount * .2) return "warning";
	if (!selectedFields.userField && !selectedFields.customerField) return "warning";
	return "pass";
}
function profileDataset(source, rows, hints = {}) {
	const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))].toSorted();
	const fieldCandidates = Object.fromEntries(Object.keys(aliases).map((role) => [role, candidates(columns, role, rows)]));
	const selectedFields = Object.fromEntries(Object.keys(aliases).map((role) => {
		const typedRole = role;
		return [role, selectField(typedRole, fieldCandidates[typedRole] ?? [], hints[typedRole], columns)];
	}));
	const emptySelectedFields = Object.entries(selectedFields).filter(([, field]) => Boolean(field) && rows.every((row) => !nonEmpty(field ? row[field] : void 0))).map(([role, field]) => `${role}=${field}`);
	const timeField = selectedFields.timeField;
	const amountFields = [selectedFields.amountField, selectedFields.spendField].filter((field) => Boolean(field));
	let missingRows = 0;
	let invalidDateRows = 0;
	let invalidNumberRows = 0;
	let minDate;
	let maxDate;
	const fingerprints = /* @__PURE__ */ new Set();
	let duplicateRows = 0;
	for (const row of rows) {
		if (Object.values(row).every((value$1) => !nonEmpty(value$1))) missingRows += 1;
		const fingerprint = rowFingerprint(row);
		if (fingerprints.has(fingerprint)) duplicateRows += 1;
		fingerprints.add(fingerprint);
		if (timeField && nonEmpty(row[timeField])) {
			const date = dateValue(row, timeField);
			if (!date) invalidDateRows += 1;
			else {
				if (!minDate || date < minDate) minDate = date;
				if (!maxDate || date > maxDate) maxDate = date;
			}
		}
		for (const field of amountFields) if (nonEmpty(row[field]) && numberValue(row, field) === void 0) invalidNumberRows += 1;
	}
	const warnings = [];
	if (!selectedFields.userField && !selectedFields.customerField) warnings.push("No user/customer identifier candidate was found; user-level conversion and retention cannot be trusted");
	if (!selectedFields.eventField && !selectedFields.typeField) warnings.push("No event or movement type candidate was found; event funnel and MRR bridge selection may be unavailable");
	if (!selectedFields.timeField) warnings.push("No timestamp/date candidate was found; time-window analysis will be unavailable");
	if (emptySelectedFields.length > 0) warnings.push(`Detected fields contain no non-empty values: ${emptySelectedFields.join(", ")}`);
	if (invalidDateRows > 0) warnings.push(`${invalidDateRows} rows contain an invalid date in '${timeField}'`);
	if (invalidNumberRows > 0) warnings.push(`${invalidNumberRows} numeric cells are not parseable in amount/spend fields`);
	if (duplicateRows > 0) warnings.push(`${duplicateRows} duplicate rows detected; verify whether they are repeated events or ingestion duplicates`);
	if (missingRows > 0) warnings.push(`${missingRows} completely empty rows detected`);
	const recommendations = [];
	if (selectedFields.userField && selectedFields.eventField && selectedFields.timeField) recommendations.push("Event dataset is ready for funnel and cohort analysis after checking event names");
	else if (selectedFields.periodField && selectedFields.typeField && selectedFields.amountField) recommendations.push("Movement dataset is ready for an MRR bridge after confirming amount sign semantics");
	if (!selectedFields.userField && !selectedFields.customerField) recommendations.push("Add a stable pseudonymous user_id or customer_id; do not use email as a default identifier");
	if (!selectedFields.timeField) recommendations.push("Add an ISO-8601 timestamp or explicit period field before comparing time windows");
	if (emptySelectedFields.length > 0) recommendations.push("Confirm the selected field mapping; a detected column with no values cannot support analysis");
	if (invalidDateRows > 0 || invalidNumberRows > 0) recommendations.push("Fix invalid dates/numbers or provide a mapping before using the result for decisions");
	return {
		source,
		rowCount: rows.length,
		columnCount: columns.length,
		columns,
		fieldCandidates,
		selectedFields,
		distinctValues: {
			events: valuesFor(rows, selectedFields.eventField),
			movementTypes: valuesFor(rows, selectedFields.typeField),
			currencies: valuesFor(rows, selectedFields.currencyField)
		},
		dateRange: minDate && maxDate ? {
			min: minDate.toISOString(),
			max: maxDate.toISOString()
		} : null,
		quality: {
			status: statusFor(rows.length, selectedFields, invalidDateRows, invalidNumberRows, emptySelectedFields.length),
			duplicateRows,
			missingRows,
			invalidDateRows,
			invalidNumberRows,
			warnings
		},
		recommendations
	};
}
function extensionOf$1(path) {
	return /\.[^./\\]+$/.exec(path.toLowerCase())?.[0] ?? "";
}
async function doctorRoot(fs, root, config, signal) {
	const checks = [];
	const datasets = [];
	const byExtension = {};
	let scanned = 0;
	let supported = 0;
	let skipped = 0;
	const rootTarget = await fs.resolve(root, { signal });
	const rootInfo = await fs.stat(rootTarget, signal);
	if (!rootInfo || rootInfo.type !== "directory") throw new Error(`Configured root is not a directory: ${root}`);
	checks.push({
		name: "root",
		status: "pass",
		message: `Root is readable: ${root}`
	});
	async function visit(target, displayPath) {
		if (scanned >= config.maxFiles) {
			skipped += 1;
			return;
		}
		let entries;
		try {
			entries = await fs.listDir(target, signal);
		} catch (error) {
			checks.push({
				name: `directory:${displayPath}`,
				status: "warning",
				message: error instanceof Error ? error.message : String(error)
			});
			return;
		}
		for (const entry of entries) {
			if (scanned >= config.maxFiles) {
				skipped += 1;
				continue;
			}
			if (entry.type === "directory") {
				if (!ignoredDirectories$1.has(entry.name.toLowerCase())) await visit(entry.target, `${displayPath.replace(/[\\/]$/, "")}/${entry.name}`);
				continue;
			}
			if (entry.type !== "file") continue;
			scanned += 1;
			const extension = extensionOf$1(entry.name);
			byExtension[extension || "(none)"] = (byExtension[extension || "(none)"] ?? 0) + 1;
			if (!supportedExtensions.has(extension)) continue;
			supported += 1;
			const path = `${displayPath.replace(/[\\/]$/, "")}/${entry.name}`;
			try {
				const dataset = await readDataset(fs, config, path, signal);
				const profile = profileDataset(path, dataset.rows);
				datasets.push({
					path,
					extension,
					rowCount: profile.rowCount,
					status: profile.quality.status,
					warnings: [...dataset.warnings, ...profile.quality.warnings]
				});
			} catch (error) {
				datasets.push({
					path,
					extension,
					rowCount: null,
					status: "error",
					warnings: [error instanceof Error ? error.message : String(error)]
				});
			}
		}
	}
	await visit(rootTarget, root);
	if (supported === 0) checks.push({
		name: "datasets",
		status: "warning",
		message: "No CSV, JSON or JSONL datasets found under the configured root"
	});
	else checks.push({
		name: "datasets",
		status: datasets.some((item) => item.status === "error") ? "warning" : "pass",
		message: `${supported} supported dataset file(s) discovered`
	});
	if (skipped > 0) checks.push({
		name: "limits",
		status: "warning",
		message: `${skipped} file(s) were skipped because maxFiles=${config.maxFiles}`
	});
	const errors = datasets.filter((item) => item.status === "error").length;
	const warnings = datasets.reduce((sum, item) => sum + item.warnings.length, 0) + checks.filter((item) => item.status === "warning").length;
	const status = errors > 0 ? "error" : warnings > 0 ? "warning" : "pass";
	const nextActions = [];
	if (errors > 0) nextActions.push("Fix unreadable or invalid dataset files before using automated review");
	if (datasets.some((item) => item.warnings.length > 0)) nextActions.push("Open the flagged dataset with growth_profile_dataset and confirm field mappings");
	if (supported === 0) nextActions.push("Add an event or MRR movement export under the configured root");
	if (nextActions.length === 0) nextActions.push("Run growth_review with a business goal and the most relevant event/MRR dataset");
	return {
		generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
		root,
		checks,
		files: {
			scanned,
			supported,
			skipped,
			byExtension
		},
		datasets,
		summary: {
			status,
			errors,
			warnings
		},
		nextActions
	};
}

//#endregion
//#region src/service.ts
var GrowthDataService = class extends Service {
	fs;
	config;
	constructor(ctx, fs, config) {
		super(ctx, "growth-data");
		this.fs = fs;
		this.config = config;
	}
	readDataset(path, signal) {
		return readDataset(this.fs, this.config, path, signal);
	}
	profileDataset(path, rows, hints = {}) {
		return profileDataset(path, rows, hints);
	}
	doctor(root, signal) {
		return doctorRoot(this.fs, root, this.config, signal);
	}
};

//#endregion
//#region src/context.ts
function hasAny(note, patterns) {
	return patterns.some((pattern) => pattern.test(note.content));
}
function score(checks) {
	if (checks.length === 0) return 0;
	return Math.round(checks.filter(Boolean).length / checks.length * 100);
}
function finding(id, severity, area, message, evidence, recommendation) {
	return {
		id,
		severity,
		area,
		message,
		evidence,
		recommendation
	};
}
function auditGrowthNote(note) {
	const jtbdChecks = [
		hasAny(note, [
			/JTBD/i,
			/Jobs to Be Done/i,
			/用户任务/,
			/场景/
		]),
		hasAny(note, [
			/目标用户/,
			/ICP/i,
			/用户画像/
		]),
		hasAny(note, [
			/痛点/,
			/进步/,
			/替代/,
			/为什么购买/
		])
	];
	const pmfChecks = [
		hasAny(note, [
			/PMF/i,
			/Product.?Market.?Fit/i,
			/产品市场匹配/
		]),
		hasAny(note, [
			/非常失望/,
			/very disappointed/i,
			/留存/,
			/复购/
		]),
		note.externalLinks.length > 0
	];
	const northStarChecks = [
		hasAny(note, [/North Star/i, /北极星指标/]),
		hasAny(note, [
			/驱动因素/,
			/输入指标/,
			/drivers?/i
		]),
		hasAny(note, [
			/目标/,
			/基线/,
			/周期/,
			/target/i
		])
	];
	const aarrrChecks = [
		hasAny(note, [/AARRR/i]),
		hasAny(note, [/Acquisition|获客/i]),
		hasAny(note, [/Activation|激活/i]),
		hasAny(note, [/Retention|留存/i]),
		hasAny(note, [/Referral|推荐|裂变/i]),
		hasAny(note, [/Revenue|收入|MRR/i])
	];
	const metricChecks = [
		note.tables.length > 0,
		hasAny(note, [
			/定义/,
			/公式/,
			/分子/,
			/分母/,
			/definition/i
		]),
		hasAny(note, [/数据来源/, /source/i]),
		hasAny(note, [/样本量/, /sample/i]),
		hasAny(note, [
			/时间范围/,
			/周期/,
			/period/i
		])
	];
	const experimentChecks = [
		hasAny(note, [/假设/, /hypothesis/i]),
		hasAny(note, [/实验/, /HADI/i]),
		hasAny(note, [
			/主要指标/,
			/护栏指标/,
			/成功标准/,
			/success criteria/i
		]),
		hasAny(note, [/负责人/, /owner/i])
	];
	const findings = [];
	if (!jtbdChecks[0]) findings.push(finding("JTBD-001", "high", "jtbd", "没有明确记录用户要完成的任务或场景", "文档中未发现 JTBD、用户任务或场景定义", "补充目标用户、触发场景、期望进步和现有替代方案"));
	if (!jtbdChecks[1]) findings.push(finding("JTBD-002", "medium", "jtbd", "目标用户定义不足", "未发现 ICP、目标用户或用户画像描述", "把目标用户限定到可识别的群体和使用场景"));
	if (!pmfChecks[0]) findings.push(finding("PMF-001", "medium", "pmf", "没有 PMF 检验计划", "未发现 PMF 或产品市场匹配定义", "在扩大获客前加入 PMF Survey、留存和真实使用价值证据"));
	if (!northStarChecks[0]) findings.push(finding("NSM-001", "high", "north-star", "没有唯一的 North Star Metric", "未发现北极星指标定义", "定义一个代表用户获得价值且能领先指示收入的指标"));
	if (!northStarChecks[1]) findings.push(finding("NSM-002", "medium", "north-star", "North Star 缺少可行动驱动因素", "未发现驱动因素或输入指标", "拆解 3–5 个团队可以直接影响的驱动因素"));
	if (!aarrrChecks[0]) findings.push(finding("AARRR-001", "medium", "aarrr", "增长计划没有映射到 AARRR 阶段", "未发现 AARRR 结构", "标记当前瓶颈属于获客、激活、留存、推荐还是收入"));
	if (aarrrChecks.filter(Boolean).length < 4) findings.push(finding("AARRR-002", "low", "aarrr", "AARRR 覆盖不完整", `只检测到 ${aarrrChecks.filter(Boolean).length}/6 个阶段信号`, "为每个阶段定义事件、分子、分母和目标"));
	if (!metricChecks[1]) findings.push(finding("METRIC-001", "high", "metrics", "指标没有明确公式或口径", "未发现分子、分母或定义字段", "补充指标定义、公式、时间窗口和边界条件"));
	if (!metricChecks[2]) findings.push(finding("METRIC-002", "high", "evidence", "数据来源不可追溯", "未发现来源 URL、文件或采集说明", "为关键数字补充 source、collectedAt 和来源文件"));
	if (!metricChecks[3]) findings.push(finding("METRIC-003", "medium", "metrics", "缺少样本量和数据质量说明", "未发现样本量或覆盖范围", "报告样本量、缺失率、重复事件和失败采集数"));
	if (!experimentChecks[0]) findings.push(finding("EXP-001", "medium", "experiment", "没有可证伪的增长假设", "未发现 hypothesis 字段或假设句式", "将想法改写为“如果对谁做什么，则哪个指标会如何变化”"));
	if (!experimentChecks[2]) findings.push(finding("EXP-002", "medium", "experiment", "实验缺少成功标准或护栏指标", "未发现主要指标、护栏指标或停止标准", "补充主要指标、护栏指标、成功阈值和停止条件"));
	if (note.externalLinks.length === 0) findings.push(finding("EVIDENCE-001", "low", "evidence", "文档没有外部来源链接", "检测到 0 个外部 URL", "为方法论、行业数据和关键事实保留来源；内部数据注明文件路径"));
	if (!hasAny(note, [/负责人/, /owner/i])) findings.push(finding("OPS-001", "low", "operations", "没有明确负责人", "未发现 owner 或负责人", "为每个行动指定负责人和截止日期"));
	const readiness = {
		jtbd: score(jtbdChecks),
		pmf: score(pmfChecks),
		northStar: score(northStarChecks),
		aarrr: score(aarrrChecks),
		metrics: score(metricChecks),
		experimentation: score(experimentChecks),
		overall: 0
	};
	readiness.overall = Math.round((readiness.jtbd + readiness.pmf + readiness.northStar + readiness.aarrr + readiness.metrics + readiness.experimentation) / 6);
	const topActions = findings.toSorted((left, right) => ({
		critical: 0,
		high: 1,
		medium: 2,
		low: 3,
		info: 4
	}[left.severity] ?? 5) - ({
		critical: 0,
		high: 1,
		medium: 2,
		low: 3,
		info: 4
	}[right.severity] ?? 5)).slice(0, 5).map((item) => item.recommendation);
	return {
		target: note.path,
		generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
		readiness,
		findings,
		topActions,
		missingFields: findings.map((item) => item.id)
	};
}

//#endregion
//#region src/metrics.ts
function safeDivide(numerator, denominator) {
	if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
	return numerator / denominator;
}
function round(value$1, digits = 4) {
	if (value$1 === null || !Number.isFinite(value$1)) return value$1;
	const factor = 10 ** digits;
	return Math.round(value$1 * factor) / factor;
}
function percentage(value$1, digits = 2) {
	return round(value$1 === null ? null : value$1 * 100, digits);
}
function parseList(value$1) {
	if (!value$1?.trim()) return [];
	const trimmed = value$1.trim();
	if (trimmed.startsWith("[")) try {
		const parsed = JSON.parse(trimmed);
		if (Array.isArray(parsed)) return parsed.map(String).map((item) => item.trim()).filter(Boolean);
	} catch {
		return trimmed.split(",").map((item) => item.trim()).filter(Boolean);
	}
	return trimmed.split(",").map((item) => item.trim()).filter(Boolean);
}
function calendarParts(date, timezone) {
	if (timezone === "UTC" || timezone === "Etc/UTC") return {
		year: date.getUTCFullYear(),
		month: date.getUTCMonth() + 1,
		day: date.getUTCDate()
	};
	try {
		const parts = new Intl.DateTimeFormat("en-CA", {
			timeZone: timezone,
			year: "numeric",
			month: "2-digit",
			day: "2-digit"
		}).formatToParts(date);
		const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
		const year = Number(values.year);
		const month = Number(values.month);
		const day = Number(values.day);
		if ([
			year,
			month,
			day
		].every(Number.isFinite)) return {
			year,
			month,
			day
		};
	} catch {}
	return {
		year: date.getUTCFullYear(),
		month: date.getUTCMonth() + 1,
		day: date.getUTCDate()
	};
}
function dayStart(date, timezone) {
	const parts = calendarParts(date, timezone);
	return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
}
function normalizePeriod(date, interval, timezone = "UTC") {
	const { year, month: monthNumber, day: dayNumber } = calendarParts(date, timezone);
	const month = String(monthNumber).padStart(2, "0");
	if (interval === "month") return `${year}-${month}`;
	if (interval === "day") return `${year}-${month}-${String(dayNumber).padStart(2, "0")}`;
	const start = new Date(Date.UTC(year, monthNumber - 1, dayNumber));
	const day = start.getUTCDay() || 7;
	start.setUTCDate(start.getUTCDate() - day + 1);
	return `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}-${String(start.getUTCDate()).padStart(2, "0")}`;
}
function intervalIndex(start, current, interval, timezone = "UTC") {
	const startDay = dayStart(start, timezone);
	const currentDay = dayStart(current, timezone);
	if (interval === "day") return Math.floor((currentDay.getTime() - startDay.getTime()) / 864e5);
	if (interval === "week") return Math.floor((currentDay.getTime() - startDay.getTime()) / (7 * 864e5));
	const startParts = calendarParts(start, timezone);
	const currentParts = calendarParts(current, timezone);
	return (currentParts.year - startParts.year) * 12 + currentParts.month - startParts.month;
}

//#endregion
//#region src/diagnostics.ts
function diagnoseGrowth(options) {
	const delta = options.current - options.previous;
	const deltaRate = percentage(safeDivide(delta, options.previous));
	const direction = delta > 0 ? "上升" : delta < 0 ? "下降" : "持平";
	const hypotheses = [];
	const stage = options.stage?.toLowerCase() ?? "";
	if (stage.includes("acquisition") || stage.includes("获客")) hypotheses.push({
		rank: 1,
		hypothesis: "渠道流量或渠道质量发生变化",
		evidence: ["当前指标被标记为获客阶段"],
		confidence: "medium",
		nextCheck: "按渠道比较有效用户、激活率和 CAC，而不是只看访问量"
	});
	if (stage.includes("activation") || stage.includes("激活")) hypotheses.push({
		rank: 1,
		hypothesis: "首次价值路径或激活事件定义存在摩擦",
		evidence: ["当前指标被标记为激活阶段"],
		confidence: "medium",
		nextCheck: "比较完成关键首次行为与未完成用户的后续留存"
	});
	if (stage.includes("retention") || stage.includes("留存")) hypotheses.push({
		rank: 1,
		hypothesis: "新增用户质量、核心使用频率或产品价值交付发生变化",
		evidence: ["当前指标被标记为留存阶段"],
		confidence: "medium",
		nextCheck: "按注册队列和获客渠道查看留存曲线，区分真实流失与自然生命周期结束"
	});
	if (stage.includes("revenue") || stage.includes("收入") || stage.includes("mrr")) hypotheses.push({
		rank: 1,
		hypothesis: "新增、扩张、收缩、重新激活或流失 MRR 的结构发生变化",
		evidence: ["当前指标被标记为收入阶段"],
		confidence: "medium",
		nextCheck: "生成 MRR Bridge，并按套餐、渠道和客户类型拆分"
	});
	if (hypotheses.length === 0) hypotheses.push({
		rank: 1,
		hypothesis: "指标变化可能由分子、分母或样本构成变化导致",
		evidence: ["未提供足够的漏斗阶段上下文"],
		confidence: "low",
		nextCheck: "先拆分分子、分母、渠道、分群和时间队列"
	});
	if (options.audit && options.audit.readiness.metrics < 60) hypotheses.push({
		rank: hypotheses.length + 1,
		hypothesis: "指标口径或数据来源不稳定，导致变化不可解释",
		evidence: [`指标准备度为 ${options.audit.readiness.metrics}/100`],
		confidence: "high",
		nextCheck: "先补齐公式、来源、时间窗口和样本量，再判断业务原因"
	});
	const dataGaps = ["尚未验证因果关系", "尚未完成渠道、分群和队列拆解"];
	if (!options.context?.trim()) dataGaps.push("没有提供业务背景或同期变更记录");
	return {
		generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
		metric: options.metric,
		current: options.current,
		previous: options.previous,
		delta,
		deltaRate,
		interpretation: `${options.metric} 从 ${options.previous} 变为 ${options.current}，当前判断为${direction}；这描述了结果，不等于因果结论。`,
		hypotheses: hypotheses.map((item, index) => ({
			...item,
			rank: index + 1
		})),
		dataGaps,
		nextActions: [
			"固定指标定义、时间窗口和来源",
			"按渠道、用户分群和队列拆解变化",
			"将最高优先级假设转成带护栏指标的 HADI 实验"
		]
	};
}

//#endregion
//#region src/economics.ts
function hasValue(value$1) {
	return value$1 !== void 0 && value$1 !== null && value$1 !== "";
}
function movementAmount(rows, typeField, amountField, type, mode) {
	const matching = rows.filter((row) => stringValue(row, typeField)?.toLowerCase() === type);
	let value$1 = 0;
	let observed = 0;
	let invalid = 0;
	let missing = 0;
	for (const row of matching) {
		const raw = row[amountField];
		if (!hasValue(raw)) {
			missing += 1;
			continue;
		}
		const numeric = numberValue(row, amountField);
		if (numeric === void 0) {
			invalid += 1;
			continue;
		}
		observed += 1;
		value$1 += mode === "absolute" ? Math.abs(numeric) : numeric;
	}
	return {
		value: matching.length === 0 ? 0 : missing > 0 || invalid > 0 ? null : value$1,
		observed,
		invalid,
		missing
	};
}
function numericField(rows, field) {
	let value$1 = 0;
	let observed = 0;
	let invalid = 0;
	let missing = 0;
	for (const row of rows) {
		const raw = row[field];
		if (!hasValue(raw)) {
			missing += 1;
			continue;
		}
		const numeric = numberValue(row, field);
		if (numeric === void 0) {
			invalid += 1;
			continue;
		}
		observed += 1;
		value$1 += Math.abs(numeric);
	}
	return {
		value: observed === 0 || invalid > 0 ? null : value$1,
		observed,
		invalid,
		missing
	};
}
function newCustomerCount(rows, typeField, customerField) {
	const newRows = rows.filter((row) => stringValue(row, typeField)?.toLowerCase() === "new");
	const ids = new Set(newRows.map((row) => stringValue(row, customerField)).filter((value$1) => Boolean(value$1)));
	return {
		count: ids.size > 0 ? ids.size : newRows.length,
		hasIds: ids.size > 0
	};
}
function snapshotValue(rows, amountField) {
	return rows.map((row) => numberValue(row, "ending_mrr") ?? numberValue(row, amountField)).find((value$1) => value$1 !== void 0);
}
function analyzeEconomics(source, rows, options) {
	const warnings = [];
	const amountMode = options.amountMode ?? "absolute";
	const movementSource = options.movementSource ?? "movement";
	const periods = Array.from(new Set(rows.map((row) => stringValue(row, options.periodField)).filter((item) => Boolean(item)))).sort();
	if (periods.length === 0) warnings.push(`No period values found in '${options.periodField}'`);
	const knownMovementTypes = new Set([
		"new",
		"expansion",
		"reactivation",
		"contraction",
		"churn",
		"churned"
	]);
	const movementTypeValues = rows.map((row) => stringValue(row, options.typeField)?.toLowerCase()).filter((value$1) => Boolean(value$1));
	const unknownMovementTypes = [...new Set(movementTypeValues.filter((value$1) => !knownMovementTypes.has(value$1)))];
	if (movementSource === "movement" && unknownMovementTypes.length > 0) warnings.push(`Unrecognized movement type(s) were ignored: ${unknownMovementTypes.join(", ")}; map them to new, expansion, reactivation, contraction, churn or churned before using the bridge`);
	const signRiskRows = rows.filter((row) => [
		"contraction",
		"churn",
		"churned"
	].includes(stringValue(row, options.typeField)?.toLowerCase() ?? "") && (numberValue(row, options.amountField) ?? 0) !== 0);
	const negativeRisk = signRiskRows.filter((row) => (numberValue(row, options.amountField) ?? 0) < 0).length;
	const positiveRisk = signRiskRows.filter((row) => (numberValue(row, options.amountField) ?? 0) > 0).length;
	if (amountMode === "absolute" && negativeRisk > 0) warnings.push(`${negativeRisk} contraction/churn rows are negative; absolute mode converts them to magnitudes before subtracting`);
	if (amountMode === "signed" && positiveRisk > 0) warnings.push(`${positiveRisk} contraction/churn rows are positive in signed mode; verify that signed inputs really use negative values`);
	if (movementSource === "snapshot") warnings.push("snapshot mode reads ending MRR from ending_mrr or amount and does not infer movement components from snapshots");
	const output = [];
	periods.forEach((period, index) => {
		const currentRows = rows.filter((row) => stringValue(row, options.periodField) === period);
		const beginningMrr = index === 0 ? options.beginningMrr ?? null : output[index - 1]?.endingMrr ?? null;
		const newAmount = movementSource === "snapshot" ? {
			value: 0,
			observed: 0,
			invalid: 0,
			missing: 0
		} : movementAmount(currentRows, options.typeField, options.amountField, "new", amountMode);
		const expansionAmount = movementSource === "snapshot" ? {
			value: 0,
			observed: 0,
			invalid: 0,
			missing: 0
		} : movementAmount(currentRows, options.typeField, options.amountField, "expansion", amountMode);
		const reactivationAmount = movementSource === "snapshot" ? {
			value: 0,
			observed: 0,
			invalid: 0,
			missing: 0
		} : movementAmount(currentRows, options.typeField, options.amountField, "reactivation", amountMode);
		const contractionAmount = movementSource === "snapshot" ? {
			value: 0,
			observed: 0,
			invalid: 0,
			missing: 0
		} : movementAmount(currentRows, options.typeField, options.amountField, "contraction", amountMode);
		const churnAmount = movementSource === "snapshot" ? {
			value: 0,
			observed: 0,
			invalid: 0,
			missing: 0
		} : movementAmount(currentRows, options.typeField, options.amountField, "churn", amountMode);
		const churnedAmount = movementSource === "snapshot" ? {
			value: 0,
			observed: 0,
			invalid: 0,
			missing: 0
		} : movementAmount(currentRows, options.typeField, options.amountField, "churned", amountMode);
		const amountIssues = [
			newAmount,
			expansionAmount,
			reactivationAmount,
			contractionAmount,
			churnAmount,
			churnedAmount
		].reduce((sum, item) => ({
			missing: sum.missing + item.missing,
			invalid: sum.invalid + item.invalid
		}), {
			missing: 0,
			invalid: 0
		});
		const newMrr = newAmount.value;
		const expansionMrr = expansionAmount.value;
		const reactivationMrr = reactivationAmount.value;
		const contractionMrr = contractionAmount.value;
		const churnedMrr = churnAmount.value === null || churnedAmount.value === null ? null : churnAmount.value + churnedAmount.value;
		const explicitEnding = movementSource === "snapshot" ? snapshotValue(currentRows, options.amountField) : currentRows.map((row) => numberValue(row, "ending_mrr")).find((value$1) => value$1 !== void 0);
		const movementDelta = newMrr !== null && expansionMrr !== null && reactivationMrr !== null && contractionMrr !== null && churnedMrr !== null ? amountMode === "signed" ? newMrr + expansionMrr + reactivationMrr + contractionMrr + churnedMrr : newMrr + expansionMrr + reactivationMrr - contractionMrr - churnedMrr : null;
		const endingMrr$1 = explicitEnding ?? (beginningMrr === null || movementDelta === null ? null : movementSource === "snapshot" ? null : beginningMrr + movementDelta);
		const activeCustomers = currentRows.map((row) => numberValue(row, "active_customers")).find((value$1) => value$1 !== void 0) ?? null;
		const spendSummary = numericField(currentRows, options.spendField);
		const customers = newCustomerCount(currentRows, options.typeField, options.customerField);
		const newCustomers = customers.count;
		const arpa = activeCustomers !== null && activeCustomers > 0 && endingMrr$1 !== null ? endingMrr$1 / activeCustomers : null;
		const churnCount = currentRows.filter((row) => ["churn", "churned"].includes(stringValue(row, options.typeField)?.toLowerCase() ?? "")).length;
		const beginningCustomers = index === 0 ? options.beginningCustomers ?? null : output[index - 1]?.activeCustomers ?? null;
		const logoChurn = beginningCustomers === null ? null : safeDivide(churnCount, beginningCustomers);
		const revenueChurn = movementSource === "snapshot" || churnedMrr === null || beginningMrr === null ? null : safeDivide(amountMode === "signed" ? -churnedMrr : churnedMrr, beginningMrr);
		const nrrBase = beginningMrr !== null && movementSource !== "snapshot" && expansionMrr !== null && reactivationMrr !== null && contractionMrr !== null && churnedMrr !== null ? amountMode === "signed" ? beginningMrr + expansionMrr + reactivationMrr + contractionMrr + churnedMrr : beginningMrr + expansionMrr + reactivationMrr - contractionMrr - churnedMrr : null;
		const nrr = nrrBase === null ? null : safeDivide(nrrBase, beginningMrr ?? 0);
		const cac = newCustomers > 0 && spendSummary.value !== null ? spendSummary.value / newCustomers : null;
		const ltv = arpa !== null && options.grossMargin > 0 && revenueChurn !== null && revenueChurn > 0 ? arpa * options.grossMargin / revenueChurn : null;
		const paybackMonths = cac !== null && arpa !== null && arpa > 0 && options.grossMargin > 0 ? cac / (arpa * options.grossMargin) : null;
		if (beginningMrr === null) warnings.push(`Missing beginning MRR for ${period}; MRR growth and NRR are partial`);
		if (amountIssues.missing > 0) warnings.push(`${amountIssues.missing} MRR movement row(s) in ${period} have no amount; affected bridge components are unavailable rather than treated as zero`);
		if (amountIssues.invalid > 0) warnings.push(`${amountIssues.invalid} MRR movement row(s) in ${period} have a non-numeric amount; affected bridge components are unavailable`);
		if (movementSource === "snapshot" && explicitEnding === void 0) warnings.push(`No ending MRR snapshot found for ${period}; snapshot metrics are unavailable`);
		if (activeCustomers === null) warnings.push(`No active_customers value for ${period}; ARPA and logo churn are unavailable`);
		if (churnCount > 0 && beginningCustomers === null) warnings.push(`No beginning customer count for ${period}; logo churn is unavailable`);
		if (newCustomers > 0 && !customers.hasIds) warnings.push(`No customer IDs found for new rows in ${period}; CAC uses new movement rows as a proxy for new customers`);
		if (newCustomers > 0 && spendSummary.value === null) warnings.push(`No usable spend value for ${period}; CAC and payback are unavailable`);
		if (spendSummary.invalid > 0) warnings.push(`${spendSummary.invalid} spend value(s) in ${period} are non-numeric; CAC is unavailable for this period`);
		output.push({
			period,
			beginningMrr: round(beginningMrr, 2),
			newMrr: round(newMrr, 2),
			expansionMrr: round(expansionMrr, 2),
			reactivationMrr: round(reactivationMrr, 2),
			contractionMrr: round(contractionMrr, 2),
			churnedMrr: round(churnedMrr, 2),
			endingMrr: round(endingMrr$1, 2),
			mrrGrowthRate: percentage(beginningMrr === null || endingMrr$1 === null ? null : safeDivide(endingMrr$1 - beginningMrr, beginningMrr)),
			activeCustomers,
			arpa: round(arpa, 2),
			logoChurnRate: percentage(logoChurn),
			revenueChurnRate: percentage(revenueChurn),
			nrr: percentage(nrr),
			cac: round(cac, 2),
			ltv: round(ltv, 2),
			paybackMonths: round(paybackMonths, 2)
		});
	});
	const endingMrr = output.at(-1)?.endingMrr ?? null;
	return {
		generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
		source,
		currency: options.currency,
		amountMode,
		movementSource,
		periods: output,
		totals: {
			endingMrr,
			arr: endingMrr === null ? null : endingMrr * 12,
			totalSpend: numericField(rows, options.spendField).value,
			totalNewCustomers: newCustomerCount(rows, options.typeField, options.customerField).count
		},
		warnings: [...new Set(warnings)]
	};
}

//#endregion
//#region src/experiments.ts
function calculatePriority(options) {
	const reach = options.reach;
	const impact = options.impact;
	const confidence = options.confidence;
	const effort = options.effort;
	const ease = options.ease;
	let score$1 = null;
	if (options.method === "rice" && reach !== void 0 && impact !== void 0 && confidence !== void 0 && effort !== void 0 && effort > 0) score$1 = reach * impact * confidence / effort;
	if (options.method === "ice" && impact !== void 0 && confidence !== void 0 && ease !== void 0 && ease > 0) score$1 = impact * confidence / ease;
	return {
		method: options.method,
		reach,
		impact,
		confidence,
		effort,
		ease,
		score: score$1,
		title: "",
		targetMetric: void 0
	};
}
function createExperiment(options) {
	const method = options.method ?? "rice";
	const priority = calculatePriority({
		...options,
		method
	});
	priority.title = options.title;
	priority.targetMetric = options.targetMetric;
	const guardrails = options.guardrails.length > 0 ? options.guardrails : [
		"day_7_retention",
		"refund_rate",
		"support_tickets"
	];
	const successCriteria = `在 ${options.durationDays ?? 14} 天内，${options.targetMetric} 相对对照组达到预设提升，并且护栏指标没有恶化。`;
	const stopCriteria = `若主要指标方向相反、样本质量不足，或任一护栏指标达到不可接受阈值，则停止并复盘。`;
	const instrumentation = [
		`记录实验曝光和分组：experiment_id=${options.title}`,
		`记录主要指标事件：${options.targetMetric}`,
		...guardrails.map((item) => `记录护栏指标：${item}`)
	];
	const markdown = [
		"---",
		"type: experiment",
		"status: proposed",
		`title: ${options.title}`,
		`aarrr_stage: ${options.stage}`,
		`primary_metric: ${options.targetMetric}`,
		`method: HADI`,
		`priority_method: ${method.toUpperCase()}`,
		options.owner ? `owner: ${options.owner}` : "",
		"---",
		"",
		`# ${options.title}`,
		"",
		`## 问题\n${options.problem}`,
		"",
		`## 假设\n${options.hypothesis}`,
		"",
		`## 目标用户\n${options.audience ?? "待补充"}`,
		"",
		`## 主要指标\n${options.targetMetric}`,
		"",
		`## 护栏指标\n${guardrails.map((item) => `- ${item}`).join("\n")}`,
		"",
		`## 成功标准\n${successCriteria}`,
		"",
		`## 停止标准\n${stopCriteria}`,
		"",
		`## 埋点要求\n${instrumentation.map((item) => `- ${item}`).join("\n")}`,
		"",
		`## 优先级\n- 方法：${method.toUpperCase()}\n- 分数：${priority.score === null ? "待补充输入" : priority.score.toFixed(2)}`,
		"",
		"## HADI 复盘",
		"- Hypothesis：",
		"- Action：",
		"- Data：",
		"- Insight："
	].filter(Boolean).join("\n");
	return {
		title: options.title,
		problem: options.problem,
		hypothesis: options.hypothesis,
		stage: options.stage,
		targetMetric: options.targetMetric,
		guardrails,
		method: "HADI",
		owner: options.owner,
		audience: options.audience,
		durationDays: options.durationDays,
		successCriteria,
		stopCriteria,
		instrumentation,
		priority,
		markdown
	};
}
function parseGuardrails(value$1) {
	return parseList(value$1);
}

//#endregion
//#region src/funnel.ts
function stageForAnyEvent(rows, options) {
	const usersByEvent = /* @__PURE__ */ new Map();
	for (const stage of options.stages) usersByEvent.set(stage.event, /* @__PURE__ */ new Set());
	for (const row of rows) {
		const user = stringValue(row, options.userField);
		const event = stringValue(row, options.eventField);
		if (!user || !event || !usersByEvent.has(event)) continue;
		usersByEvent.get(event)?.add(user);
	}
	return stageResults(usersByEvent, options.stages);
}
function stageResults(usersByEvent, stages) {
	const entryCount = usersByEvent.get(stages[0]?.event ?? "")?.size ?? 0;
	return stages.map((stage, index) => {
		const users = usersByEvent.get(stage.event)?.size ?? 0;
		const previous = index > 0 ? usersByEvent.get(stages[index - 1]?.event ?? "")?.size ?? 0 : entryCount;
		return {
			name: stage.name,
			event: stage.event,
			users,
			conversionFromPrevious: index === 0 ? 1 : percentage(safeDivide(users, previous)),
			conversionFromEntry: percentage(safeDivide(users, entryCount)),
			dropOffFromPrevious: index === 0 ? 0 : percentage(safeDivide(previous - users, previous))
		};
	});
}
function stageForOrdered(rows, options) {
	const usersByStage = options.stages.map(() => /* @__PURE__ */ new Set());
	const stageEvents = new Set(options.stages.map((stage) => stage.event));
	const timelines = /* @__PURE__ */ new Map();
	rows.forEach((row, rowIndex) => {
		const user = stringValue(row, options.userField);
		const event = stringValue(row, options.eventField);
		if (!user || !event || !stageEvents.has(event)) return;
		const date = dateValue(row, options.timeField ?? "timestamp") ?? dateValue(row, "date") ?? dateValue(row, "occurred_at");
		const timeline = timelines.get(user) ?? [];
		timeline.push({
			event,
			rowIndex,
			time: date?.getTime() ?? null
		});
		timelines.set(user, timeline);
	});
	for (const [user, timeline] of timelines) {
		timeline.sort((left, right) => left.rowIndex - right.rowIndex);
		let lastIndex = -1;
		let entryTime = null;
		for (const [stageIndex, stage] of options.stages.entries()) {
			const match = timeline.find((item) => {
				if (item.event !== stage.event || item.rowIndex <= lastIndex) return false;
				if (stageIndex > 0 && options.conversionWindowDays !== void 0 && entryTime !== null && item.time !== null) return item.time - entryTime <= options.conversionWindowDays * 864e5;
				return true;
			});
			if (!match) break;
			usersByStage[stageIndex]?.add(user);
			lastIndex = match.rowIndex;
			if (stageIndex === 0) entryTime = match.time;
		}
	}
	return stageResults(new Map(options.stages.map((stage, index) => [stage.event, usersByStage[index] ?? /* @__PURE__ */ new Set()])), options.stages);
}
function stageForRows(rows, options) {
	return options.sequenceMode === "ordered" ? stageForOrdered(rows, options) : stageForAnyEvent(rows, options);
}
function grouped(rows, field) {
	if (!field) return {};
	const groups = {};
	for (const row of rows) {
		const key = stringValue(row, field) ?? "unknown";
		groups[key] ??= [];
		groups[key].push(row);
	}
	return groups;
}
function attributedGroups(rows, options) {
	if (!options.channelField) return {};
	const attribution = options.attribution ?? "entry-touch";
	const timelines = /* @__PURE__ */ new Map();
	rows.forEach((row, index) => {
		const user = stringValue(row, options.userField);
		if (!user) return;
		const timeline = timelines.get(user) ?? [];
		const date = dateValue(row, options.timeField ?? "timestamp") ?? dateValue(row, "date") ?? dateValue(row, "occurred_at");
		timeline.push({
			row,
			index,
			time: date?.getTime() ?? null,
			event: stringValue(row, options.eventField)
		});
		timelines.set(user, timeline);
	});
	const groups = {};
	for (const timeline of timelines.values()) {
		const ordered = timeline.toSorted((left, right) => left.index - right.index);
		const first = ordered[0];
		const last = ordered.at(-1);
		const entry = ordered.find((item) => item.event === options.stages[0]?.event) ?? first;
		const selected = attribution === "first-touch" ? first : attribution === "last-touch" ? last : entry;
		const channel = selected ? stringValue(selected.row, options.channelField) ?? "unknown" : "unknown";
		groups[channel] ??= [];
		groups[channel].push(...ordered.map((item) => item.row));
	}
	return groups;
}
function analyzeFunnel(source, rows, options) {
	const warnings = [];
	if (options.stages.length < 2) warnings.push("At least two funnel stages are required for conversion analysis");
	const timeField = options.timeField ?? "timestamp";
	const filtered = rows.filter((row) => {
		const date = dateValue(row, timeField) ?? dateValue(row, "date") ?? dateValue(row, "occurred_at");
		const start = options.start ? new Date(options.start) : void 0;
		const end = options.end ? new Date(options.end) : void 0;
		if (!date || Number.isNaN(date.getTime())) return !start && !end;
		return (!start || date >= start) && (!end || date <= end);
	});
	if (options.sequenceMode === "ordered" && filtered.some((row) => stringValue(row, options.eventField) && !dateValue(row, timeField) && !dateValue(row, "date") && !dateValue(row, "occurred_at"))) warnings.push(`Ordered funnel contains rows without a valid timestamp in '${timeField}'; row order is used as a fallback`);
	if (options.conversionWindowDays !== void 0 && options.conversionWindowDays <= 0) warnings.push("conversionWindowDays must be positive; the window was ignored");
	const users = new Set(filtered.map((row) => stringValue(row, options.userField)).filter((item) => Boolean(item)));
	if (users.size === 0) warnings.push(`No usable user IDs found in field '${options.userField}'`);
	const stages = stageForRows(filtered, options);
	const bottleneck = stages.slice(1).filter((stage) => stage.dropOffFromPrevious !== null).toSorted((left, right) => (right.dropOffFromPrevious ?? -1) - (left.dropOffFromPrevious ?? -1))[0] ?? null;
	const channelGroups = options.channelField ? attributedGroups(filtered, {
		...options,
		attribution: options.attribution ?? "entry-touch"
	}) : {};
	const segmentGroups = grouped(filtered, options.segmentField);
	return {
		generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
		source,
		userCount: users.size,
		eventRows: filtered.length,
		sequenceMode: options.sequenceMode ?? "any-event",
		attribution: options.attribution ?? "entry-touch",
		conversionWindowDays: options.conversionWindowDays ?? null,
		timezone: options.timezone ?? "UTC",
		stages,
		bottleneck,
		byChannel: Object.fromEntries(Object.entries(channelGroups).map(([key, group]) => [key, stageForRows(group, options)])),
		bySegment: Object.fromEntries(Object.entries(segmentGroups).map(([key, group]) => [key, stageForRows(group, options)])),
		warnings
	};
}
function parseStages(value$1) {
	if (!value$1?.trim()) return [
		{
			name: "Acquisition",
			event: "acquired"
		},
		{
			name: "Activation",
			event: "activated"
		},
		{
			name: "Retention",
			event: "retained"
		},
		{
			name: "Referral",
			event: "referred"
		},
		{
			name: "Revenue",
			event: "paid"
		}
	];
	const trimmed = value$1.trim();
	if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
		let parsed;
		try {
			parsed = JSON.parse(trimmed);
		} catch {
			throw new Error("stages JSON is invalid; use [{\"name\":\"Activation\",\"event\":\"activated\"}] or name=event pairs");
		}
		if (!Array.isArray(parsed)) throw new Error("stages JSON must be an array");
		const stages = parsed.flatMap((item) => {
			if (typeof item === "string" && item.trim()) return [{
				name: item.trim(),
				event: item.trim()
			}];
			if (typeof item === "object" && item !== null && "name" in item && "event" in item) {
				const candidate = item;
				const name$1 = String(candidate.name).trim();
				const event = String(candidate.event).trim();
				return name$1 && event ? [{
					name: name$1,
					event
				}] : [];
			}
			return [];
		});
		if (stages.length !== parsed.length) throw new Error("Every stages item must have non-empty name and event values");
		return stages;
	}
	return trimmed.split(",").map((item) => item.trim()).filter(Boolean).map((item) => {
		const [name$1, event] = item.split("=").map((part) => part.trim());
		return {
			name: name$1 || event || item,
			event: event || name$1 || item
		};
	});
}

//#endregion
//#region src/cohort.ts
function periodDistance(left, right, interval) {
	if (interval === "month") {
		const [leftYear = 0, leftMonth = 0] = left.split("-").map(Number);
		const [rightYear = 0, rightMonth = 0] = right.split("-").map(Number);
		return (rightYear - leftYear) * 12 + rightMonth - leftMonth;
	}
	const leftDate = /* @__PURE__ */ new Date(`${left}T00:00:00Z`);
	const rightDate = /* @__PURE__ */ new Date(`${right}T00:00:00Z`);
	const days = Math.floor((rightDate.getTime() - leftDate.getTime()) / 864e5);
	return interval === "week" ? Math.floor(days / 7) : days;
}
function analyzeCohorts(source, rows, options) {
	const warnings = [];
	const timezone = options.timezone ?? "UTC";
	const cohortStarts = /* @__PURE__ */ new Map();
	for (const row of rows) {
		if (stringValue(row, options.eventField) !== options.cohortEvent) continue;
		const user = stringValue(row, options.userField);
		const date = dateValue(row, options.timeField);
		if (!user || !date) continue;
		const existing = cohortStarts.get(user);
		if (!existing || date < existing) cohortStarts.set(user, date);
	}
	if (cohortStarts.size === 0) warnings.push(`No cohort users found for event '${options.cohortEvent}'`);
	const retained = /* @__PURE__ */ new Map();
	for (const row of rows) {
		if (stringValue(row, options.eventField) !== options.retentionEvent) continue;
		const user = stringValue(row, options.userField);
		const date = dateValue(row, options.timeField);
		const start = user ? cohortStarts.get(user) : void 0;
		if (!user || !date || !start) continue;
		const index = intervalIndex(start, date, options.interval, timezone);
		if (index < 0 || index >= options.maxPeriods) continue;
		const cohort = normalizePeriod(start, options.interval, timezone);
		retained.get(cohort)?.get(index)?.add(user) ?? (() => {
			const periods = retained.get(cohort) ?? /* @__PURE__ */ new Map();
			const users = periods.get(index) ?? /* @__PURE__ */ new Set();
			users.add(user);
			periods.set(index, users);
			retained.set(cohort, periods);
		})();
	}
	const cohortSizes = /* @__PURE__ */ new Map();
	for (const start of cohortStarts.values()) {
		const cohort = normalizePeriod(start, options.interval, timezone);
		cohortSizes.set(cohort, (cohortSizes.get(cohort) ?? 0) + 1);
	}
	const cohorts = Array.from(cohortSizes.entries()).sort(([left], [right]) => left.localeCompare(right)).map(([cohort, size]) => {
		const periods = retained.get(cohort) ?? /* @__PURE__ */ new Map();
		return {
			cohort,
			size,
			cells: Array.from({ length: options.maxPeriods }, (_, period) => {
				const retainedUsers = periods.get(period)?.size ?? 0;
				return {
					period,
					cohortSize: size,
					retainedUsers,
					retentionRate: percentage(retainedUsers / size)
				};
			})
		};
	});
	const lifecycle = {
		new: 0,
		retained: 0,
		resurrected: 0,
		dormant: 0
	};
	const activeByUser = /* @__PURE__ */ new Map();
	for (const row of rows) {
		const user = stringValue(row, options.userField);
		const date = dateValue(row, options.timeField);
		if (!user || !date || stringValue(row, options.eventField) !== options.retentionEvent) continue;
		const period = normalizePeriod(date, options.interval, timezone);
		activeByUser.set(user, [...activeByUser.get(user) ?? [], period]);
	}
	for (const periods of activeByUser.values()) {
		const unique = Array.from(new Set(periods)).sort();
		if (unique.length === 1) lifecycle.new = (lifecycle.new ?? 0) + 1;
		else if (unique.length > 1) if (unique.slice(1).some((period, index) => periodDistance(unique[index] ?? period, period, options.interval) > 1)) lifecycle.resurrected = (lifecycle.resurrected ?? 0) + 1;
		else lifecycle.retained = (lifecycle.retained ?? 0) + 1;
	}
	lifecycle.dormant = Math.max(0, cohortStarts.size - activeByUser.size);
	if (activeByUser.size === 0) warnings.push(`No retention users found for event '${options.retentionEvent}'`);
	return {
		generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
		source,
		cohortEvent: options.cohortEvent,
		retentionEvent: options.retentionEvent,
		interval: options.interval,
		timezone,
		cohorts,
		lifecycle,
		warnings
	};
}

//#endregion
//#region src/markdown.ts
function scalar(value$1) {
	const trimmed = value$1.trim();
	if (!trimmed) return "";
	if (trimmed.startsWith("\"") && trimmed.endsWith("\"") || trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1);
	if (trimmed === "true") return true;
	if (trimmed === "false") return false;
	if (trimmed === "null") return null;
	if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
	if (trimmed.startsWith("[") && trimmed.endsWith("]")) return trimmed.slice(1, -1).split(",").map((item) => item.trim()).filter(Boolean).map(scalar);
	return trimmed;
}
function parseFrontmatter(content) {
	if (!content.startsWith("---")) return {
		frontmatter: {},
		body: content
	};
	const lines = content.split(/\r?\n/);
	if (lines[0]?.trim() !== "---") return {
		frontmatter: {},
		body: content
	};
	const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
	if (end < 0) return {
		frontmatter: {},
		body: content
	};
	const frontmatter = {};
	let activeArrayKey = null;
	for (const line of lines.slice(1, end)) {
		const listItem = line.match(/^\s*-\s+(.+)$/);
		if (listItem && activeArrayKey) {
			const current = frontmatter[activeArrayKey];
			if (Array.isArray(current)) current.push(scalar(listItem[1] ?? ""));
			continue;
		}
		const match = line.match(/^\s*([^:#]+):\s*(.*)$/);
		if (!match) continue;
		const key = (match[1] ?? "").trim();
		const value$1 = (match[2] ?? "").trim();
		if (!value$1) {
			frontmatter[key] = [];
			activeArrayKey = key;
		} else {
			frontmatter[key] = scalar(value$1);
			activeArrayKey = null;
		}
	}
	return {
		frontmatter,
		body: lines.slice(end + 1).join("\n")
	};
}
function parseTableLine(line) {
	return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}
function parseTables(body) {
	const lines = body.split(/\r?\n/);
	const tables = [];
	for (let index = 0; index < lines.length - 1; index += 1) {
		if (!lines[index]?.includes("|") || !lines[index + 1]?.includes("|")) continue;
		const headers = parseTableLine(lines[index] ?? "");
		const separator = parseTableLine(lines[index + 1] ?? "");
		if (headers.length === 0 || separator.length !== headers.length || !separator.every((cell) => /^:?-{3,}:?$/.test(cell))) continue;
		const rows = [];
		let rowIndex = index + 2;
		while (rowIndex < lines.length && lines[rowIndex]?.includes("|")) {
			const values = parseTableLine(lines[rowIndex] ?? "");
			if (values.length !== headers.length) break;
			rows.push(Object.fromEntries(headers.map((header, cellIndex) => [header, values[cellIndex] ?? ""])));
			rowIndex += 1;
		}
		tables.push({
			headers,
			rows
		});
		index = rowIndex - 1;
	}
	return tables;
}
function titleFrom(body, path) {
	const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
	if (heading) return heading;
	return (path.split(/[\\/]/).pop() ?? path).replace(/\.md$/i, "");
}
function parseNote(path, content) {
	const { frontmatter, body } = parseFrontmatter(content.replace(/^\uFEFF/, ""));
	const headings = Array.from(body.matchAll(/^#{1,6}\s+(.+)$/gm)).map((match) => match[1]?.trim() ?? "").filter(Boolean);
	const internalLinks = Array.from(body.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)).map((match) => match[1]?.trim() ?? "").filter(Boolean);
	const externalLinks = Array.from(content.matchAll(/https?:\/\/[^\s)\]>]+/g)).map((match) => match[0].replace(/[.,;!?]+$/, ""));
	const wordCount = body.trim() ? body.trim().split(/\s+/u).length : 0;
	return {
		path,
		title: titleFrom(body, path),
		content,
		frontmatter,
		headings,
		tables: parseTables(body),
		internalLinks,
		externalLinks,
		wordCount
	};
}

//#endregion
//#region src/reports.ts
const labels = {
	wbr: "周增长复盘",
	mbr: "月度增长复盘",
	qbr: "季度增长复盘",
	"experiment-review": "增长实验复盘"
};
function renderReport(input) {
	const metricRows = input.metrics.length === 0 ? "| 指标 | 当前 | 上期 | 变化 | 来源 |\n| --- | --- | --- | --- | --- |\n| 暂无 | - | - | - | - |" : [
		"| 指标 | 当前 | 上期 | 变化 | 来源 |",
		"| --- | --- | --- | --- | --- |",
		...input.metrics.map((metric) => `| ${metric.name} | ${metric.current} | ${metric.previous ?? "-"} | ${metric.delta ?? "-"} | ${metric.source ?? "-"} |`)
	].join("\n");
	const list = (items) => items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- 暂无";
	return [
		`# ${input.title}`,
		"",
		`> 类型：${labels[input.reportType]} | 周期：${input.period}`,
		"",
		"## 结论摘要",
		input.summary || "待补充",
		"",
		"## 指标变化",
		metricRows,
		"",
		"## 主要发现",
		list(input.findings),
		"",
		"## 实验与动作",
		list(input.experiments),
		"",
		"## 下一周期行动",
		list(input.nextActions),
		"",
		"## 口径与限制",
		list(input.caveats),
		"",
		`- 生成时间：${(/* @__PURE__ */ new Date()).toISOString()}`,
		"- 说明：相关性线索不等于因果结论；缺失数据未按零处理。"
	].join("\n");
}

//#endregion
//#region src/output.ts
const resultSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		ok: { type: "boolean" },
		data: { type: "json" },
		warnings: {
			type: "array",
			items: { type: "string" }
		},
		assumptions: {
			type: "array",
			items: { type: "string" }
		},
		lineage: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: true
			}
		},
		nextActions: {
			type: "array",
			items: { type: "string" }
		}
	}
};
function resultEnvelope(options) {
	return {
		ok: true,
		data: options.data,
		warnings: [...options.warnings ?? []],
		assumptions: [...options.assumptions ?? []],
		lineage: [...options.lineage ?? []],
		nextActions: [...options.nextActions ?? []]
	};
}
function renderResult(value$1, maxChars) {
	const text = JSON.stringify(value$1, null, 2);
	return [{
		type: "text",
		text: text.length > maxChars ? `${text.slice(0, maxChars)}\n... result truncated by dsh-growth; use a narrower time window or source ...` : text
	}];
}

//#endregion
//#region src/review.ts
const eventAliases = [
	{
		stage: "Acquisition",
		names: [
			"acquired",
			"acquisition",
			"signup",
			"sign_up",
			"registered",
			"install",
			"lead",
			"注册",
			"获客",
			"安装",
			"线索",
			"报名"
		]
	},
	{
		stage: "Activation",
		names: [
			"activated",
			"activation",
			"onboarding_completed",
			"first_value",
			"aha",
			"激活",
			"完成引导",
			"首次价值",
			"首个价值",
			"首次使用"
		]
	},
	{
		stage: "Retention",
		names: [
			"retained",
			"retention",
			"active",
			"login",
			"returned",
			"留存",
			"活跃",
			"登录",
			"回访",
			"返回"
		]
	},
	{
		stage: "Referral",
		names: [
			"referred",
			"referral",
			"invited",
			"invite_sent",
			"推荐",
			"转介绍",
			"邀请",
			"分享"
		]
	},
	{
		stage: "Revenue",
		names: [
			"paid",
			"purchase",
			"purchased",
			"subscribed",
			"subscription",
			"payment",
			"付费",
			"购买",
			"订阅",
			"支付",
			"成交"
		]
	}
];
function eventKey(value$1) {
	return value$1.normalize("NFKC").toLowerCase().trim().replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_|_$/g, "");
}
function inferStages(profile) {
	const values = new Map(profile.distinctValues.events.map((value$1) => [eventKey(value$1), value$1]));
	return eventAliases.flatMap(({ stage, names }) => {
		const event = names.map(eventKey).map((name$1) => values.get(name$1)).find(Boolean);
		return event ? [{
			name: stage,
			event
		}] : [];
	});
}
function eventReadiness(profile) {
	if (!profile.selectedFields.userField || !profile.selectedFields.eventField || !profile.selectedFields.timeField) return 0;
	const stages = inferStages(profile).length;
	return stages >= 2 ? stages * 10 + Math.min(profile.rowCount, 1e4) / 1e4 : 0;
}
function economicsReadiness(profile) {
	if (!profile.selectedFields.periodField || !profile.selectedFields.typeField || !profile.selectedFields.amountField) return 0;
	const movementTypes = new Set([
		"new",
		"expansion",
		"reactivation",
		"contraction",
		"churn",
		"churned"
	]);
	if (!profile.distinctValues.movementTypes.some((value$1) => movementTypes.has(eventKey(value$1)))) return 0;
	return 10 + Math.min(profile.rowCount, 1e4) / 1e4;
}
function selectReviewSources(profiles) {
	const eventCandidates = profiles.map((profile) => ({
		path: profile.source,
		score: eventReadiness(profile)
	})).filter((candidate) => candidate.score > 0).toSorted((left, right) => right.score - left.score || left.path.localeCompare(right.path));
	const economicsCandidates = profiles.map((profile) => ({
		path: profile.source,
		score: economicsReadiness(profile)
	})).filter((candidate) => candidate.score > 0).toSorted((left, right) => right.score - left.score || left.path.localeCompare(right.path));
	return {
		eventPath: eventCandidates[0]?.path,
		economicsPath: economicsCandidates[0]?.path,
		eventCandidates: eventCandidates.map((candidate) => candidate.path),
		economicsCandidates: economicsCandidates.map((candidate) => candidate.path)
	};
}
function latestRetention(cohort) {
	const cells = cohort.cohorts.flatMap((item) => item.cells.filter((cell) => cell.period > 0 && cell.retentionRate !== null));
	if (cells.length === 0) return null;
	return cells.at(-1)?.retentionRate ?? null;
}
function buildReview(input) {
	const warnings = [...input.warnings ?? [], ...input.profiles.flatMap((profile) => profile.quality.warnings)];
	const bottlenecks = [];
	const hypotheses = [];
	const nextActions = [];
	if (input.funnel?.bottleneck) {
		const bottleneck = input.funnel.bottleneck;
		bottlenecks.push(`${bottleneck.name} is the largest observed funnel drop-off (${bottleneck.dropOffFromPrevious ?? 0}%)`);
		hypotheses.push(`Users may not reach the value moment at ${bottleneck.name}; segment this step by channel and inspect the first failed action before changing acquisition spend`);
		nextActions.push(`Instrument the ${bottleneck.name} failure reason and run one focused HADI experiment`);
	}
	const retention = input.cohort ? latestRetention(input.cohort) : null;
	if (retention !== null) {
		bottlenecks.push(`Latest observed cohort retention is ${retention}% in the supplied window`);
		hypotheses.push("Retention may be constrained by time-to-value or insufficient repeat use; compare retained and dormant cohorts by plan or acquisition channel");
		nextActions.push("Define a retention guardrail and inspect the next two cohort periods before scaling acquisition");
	}
	const latestEconomics = input.economics?.periods.at(-1);
	if (latestEconomics?.nrr !== null && latestEconomics?.nrr !== void 0 && latestEconomics.nrr < 100) {
		bottlenecks.push(`Latest NRR is ${latestEconomics.nrr}%, indicating existing revenue contraction or churn`);
		hypotheses.push("Acquisition growth may be masking expansion, contraction or churn; fix customer health and cancellation reasons before optimizing top-of-funnel volume");
		nextActions.push("Break down churn and contraction by customer segment and validate the MRR movement sign convention");
	}
	if (latestEconomics?.cac !== null && latestEconomics?.cac !== void 0 && latestEconomics?.ltv !== null && latestEconomics?.ltv !== void 0 && latestEconomics.cac >= latestEconomics.ltv) {
		bottlenecks.push(`Latest CAC is not below LTV (${latestEconomics.cac} vs ${latestEconomics.ltv})`);
		nextActions.push("Pause channel scaling until CAC, gross margin and payback inputs are reconciled");
	}
	if (input.noteAudit && input.noteAudit.topActions.length > 0) nextActions.push(...input.noteAudit.topActions.slice(0, 2));
	if (warnings.length > 0) nextActions.push("Resolve the highest-severity data warnings and rerun the review before making a budget or product decision");
	if (nextActions.length === 0) nextActions.push("Choose the next measurable experiment and record owner, target, guardrails and decision date");
	return {
		generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
		goal: input.goal,
		profiles: input.profiles,
		analyses: {
			...input.funnel ? { funnel: input.funnel } : {},
			...input.cohort ? { cohort: input.cohort } : {},
			...input.economics ? { economics: input.economics } : {},
			...input.noteAudit ? { noteAudit: input.noteAudit } : {}
		},
		bottlenecks: [...new Set(bottlenecks)],
		hypotheses: [...new Set(hypotheses)],
		nextActions: [...new Set(nextActions)],
		warnings: [...new Set(warnings)]
	};
}

//#endregion
//#region src/onboarding.ts
const ignoredDirectories = new Set([
	".git",
	"node_modules",
	"lib",
	".dsh-growth"
]);
function extensionOf(path) {
	return /\.[^./\\]+$/.exec(path.toLowerCase())?.[0] ?? "";
}
function isStale$1(value$1) {
	if (typeof value$1 !== "string" || !value$1.trim()) return true;
	const date = new Date(value$1);
	return Number.isNaN(date.getTime()) || Date.now() - date.getTime() > 90 * 864e5;
}
function isGrowthCandidate(note) {
	const type = String(note.frontmatter.type ?? "").toLowerCase();
	if ([
		"growth-project",
		"metric",
		"experiment",
		"campaign",
		"growth-report",
		"channel",
		"pmf-survey"
	].includes(type)) return true;
	return /JTBD|ICP|PMF|North Star|AARRR|MRR|CAC|LTV|HADI|RICE|WBR|MBR|QBR|growth loop|增长|获客|留存|激活|实验|转化/i.test(note.content);
}
function metadataGaps(note) {
	const gaps = [];
	if (!note.frontmatter.type) gaps.push("type");
	if (!note.frontmatter.status) gaps.push("status");
	if (isStale$1(note.frontmatter.updated)) gaps.push("updated");
	if (!note.frontmatter.source && note.externalLinks.length === 0) gaps.push("source");
	if (!note.frontmatter.target && !/target|目标/i.test(note.content)) gaps.push("target");
	if (!note.frontmatter.owner && !/owner|负责人/i.test(note.content)) gaps.push("owner");
	return gaps;
}
async function collectOnboardingNotes(fs, root, config, signal, notePath) {
	const notes = [];
	const errors = [];
	let scannedFiles = 0;
	let skippedFiles = 0;
	const addNote = (path, content, force = false) => {
		const note = parseNote(path, content);
		if (!force && !isGrowthCandidate(note)) return;
		notes.push({
			note,
			audit: auditGrowthNote(note),
			missingMetadata: metadataGaps(note)
		});
	};
	if (notePath) {
		const target = await fs.resolve(notePath, { signal });
		const info = await fs.stat(target, signal);
		if (!info || info.type !== "file") throw new Error(`Markdown file not found: ${notePath}`);
		if ((info.size ?? 0) > config.maxFileBytes) throw new Error(`File exceeds maxFileBytes (${config.maxFileBytes})`);
		const content = await fs.readText(target, signal);
		if (content.length > config.maxTextChars) throw new Error(`File exceeds maxTextChars (${config.maxTextChars})`);
		addNote(notePath, content, true);
		return {
			notes,
			scannedFiles: 1,
			skippedFiles: 0,
			errors
		};
	}
	async function visit(target, displayPath) {
		if (scannedFiles >= config.maxFiles) {
			skippedFiles += 1;
			return;
		}
		let entries;
		try {
			entries = await fs.listDir(target, signal);
		} catch (error) {
			errors.push(`${displayPath}: ${error instanceof Error ? error.message : String(error)}`);
			return;
		}
		for (const entry of entries) {
			if (scannedFiles >= config.maxFiles) {
				skippedFiles += 1;
				continue;
			}
			if (entry.type === "directory") {
				if (!ignoredDirectories.has(entry.name.toLowerCase())) await visit(entry.target, `${displayPath.replace(/[\\/]$/, "")}/${entry.name}`);
				continue;
			}
			if (entry.type !== "file") continue;
			scannedFiles += 1;
			if (extensionOf(entry.name) !== ".md") continue;
			const path = `${displayPath.replace(/[\\/]$/, "")}/${entry.name}`;
			try {
				if ((entry.size ?? 0) > config.maxFileBytes) {
					skippedFiles += 1;
					errors.push(`${path}: exceeds maxFileBytes`);
					continue;
				}
				const content = await fs.readText(entry.target, signal);
				if (content.length > config.maxTextChars) {
					skippedFiles += 1;
					errors.push(`${path}: exceeds maxTextChars`);
					continue;
				}
				addNote(path, content);
			} catch (error) {
				errors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
	}
	await visit(await fs.resolve(root, { signal }), root);
	return {
		notes,
		scannedFiles,
		skippedFiles,
		errors
	};
}
function statusForScore(score$1) {
	if (score$1 === null || score$1 <= 0) return "missing";
	if (score$1 >= 80) return "ready";
	return "partial";
}
function auditScore(audits, key) {
	if (audits.length === 0) return null;
	return Math.max(...audits.map((item) => item.audit.readiness[key]));
}
function auditEvidence(audits, key) {
	return audits.map((item) => ({
		path: item.note.path,
		score: item.audit.readiness[key]
	})).toSorted((left, right) => right.score - left.score || left.path.localeCompare(right.path)).slice(0, 3).map((item) => `${item.path}: ${item.score}/100`);
}
function dimension(id, label, score$1, evidence, missing, nextAction) {
	return {
		id,
		label,
		status: statusForScore(score$1),
		score: score$1,
		evidence,
		missing,
		nextAction
	};
}
function metadataDimension(notes) {
	if (notes.length === 0) return dimension("operations", "运营准备度", null, [], ["项目笔记、负责人、状态、更新时间和来源"], "补充一份带负责人、状态、更新时间和来源的增长项目笔记");
	const healthy = notes.filter((item) => item.missingMetadata.length === 0).length;
	const score$1 = Math.round(healthy / notes.length * 100);
	const missing = [...new Set(notes.flatMap((item) => item.missingMetadata))];
	return dimension("operations", "运营准备度", score$1, notes.slice(0, 3).map((item) => `${item.note.path}: ${item.missingMetadata.length === 0 ? "metadata ready" : `missing ${item.missingMetadata.join(", ")}`}`), missing, missing.length > 0 ? `补齐项目笔记中的 ${missing.join(", ")} 元数据` : "保持项目笔记的状态、更新时间和负责人持续更新");
}
function dataDimension(profiles, warnings) {
	const eventProfiles = profiles.filter((profile) => profile.selectedFields.userField && profile.selectedFields.eventField && profile.selectedFields.timeField && inferStages(profile).length >= 2);
	const movementTypes = new Set([
		"new",
		"expansion",
		"reactivation",
		"contraction",
		"churn",
		"churned"
	]);
	const economicsProfiles = profiles.filter((profile) => profile.selectedFields.periodField && profile.selectedFields.typeField && profile.selectedFields.amountField && profile.distinctValues.movementTypes.some((value$1) => movementTypes.has(value$1.trim().toLowerCase())));
	if (profiles.length === 0) return {
		dimension: dimension("data", "数据基础", 0, [], ["至少一份事件数据；如涉及商业化，还需要 MRR / 成本数据"], "先提供事件导出；如果需要 CAC、LTV 或 Payback，再补充 MRR 和获客成本数据"),
		eventProfiles,
		economicsProfiles
	};
	const qualityReady = warnings.length === 0 && profiles.every((profile) => profile.quality.status === "pass" && profile.quality.warnings.length === 0);
	const score$1 = (eventProfiles.length > 0 ? 50 : 0) + (economicsProfiles.length > 0 ? 30 : 0) + (qualityReady ? 20 : 10);
	const missing = [];
	if (eventProfiles.length === 0) missing.push("可识别至少两个阶段的事件数据");
	if (economicsProfiles.length === 0) missing.push("MRR / 成本数据，或明确暂不进行商业化分析");
	if (!qualityReady) missing.push("修复数据质量警告并确认字段映射");
	return {
		dimension: dimension("data", "数据基础", score$1, profiles.slice(0, 5).map((profile) => `${profile.source}: ${profile.quality.status}, ${profile.rowCount} rows`), missing, missing[0] ?? "确认数据口径、时间窗口和来源后开始增长复盘"),
		eventProfiles,
		economicsProfiles
	};
}
function signalStatus(text, pattern) {
	return pattern.test(text) ? "ready" : "not-detected";
}
function methodFromDimension(id, name$1, capability, item) {
	return {
		id,
		name: name$1,
		pluginCapability: capability,
		projectStatus: item.status,
		evidence: item.evidence,
		nextAction: item.status === "ready" ? void 0 : item.nextAction
	};
}
function combinedStatus(items) {
	const statuses = items.map((item) => item.status);
	if (statuses.every((status) => status === "ready")) return "ready";
	if (statuses.some((status) => status === "missing")) return "missing";
	if (statuses.some((status) => status === "partial")) return "partial";
	if (statuses.some((status) => status === "not-detected")) return "not-detected";
	return "not-applicable";
}
function sopStep(id, order, name$1, status, purpose, gate, tool, prompt) {
	return {
		id,
		order,
		name: name$1,
		status,
		purpose,
		gate,
		tool,
		prompt
	};
}
function buildGrowthSop(input) {
	const steps = [
		sopStep("context", 1, "问题与价值定义", combinedStatus([
			input.jtbd,
			input.northStar,
			input.metrics
		]), "明确服务谁、解决什么任务，以及用哪个指标代表用户获得价值。", "目标用户、JTBD、North Star、驱动指标、基线和周期可以被引用。", "growth_onboarding → growth_audit_note", "先补齐目标用户、JTBD、North Star、指标定义和证据来源，不要直接下增长结论。"),
		sopStep("measurement", 2, "数据与口径体检", input.data.status, "确认数据能回答问题，且字段、时间窗口、样本和缺失值规则可信。", "至少有可识别的事件数据；若本轮涉及收入，还要有 MRR / 成本数据和金额口径。", "growth_doctor → growth_profile_dataset", "检查我的增长目录，列出可用数据、字段映射、时间范围、质量风险和仍需补齐的字段。"),
		sopStep("diagnosis", 3, "瓶颈与证据诊断", combinedStatus([
			input.aarrr,
			input.metrics,
			input.data
		]), "把目标指标拆到漏斗、队列、渠道、分群或收入结构，区分事实与假设。", "来源已经确认，关键指标有分子、分母、周期和 lineage；多个候选数据源已完成选择。", "growth_review → growth_funnel_analyze / growth_cohort_analyze / growth_economics", "以“提升激活率”为目标复盘；先告诉我来源、警告和证据缺口，再给出最大瓶颈，不要把相关性当因果。"),
		sopStep("experiment", 4, "HADI 实验设计", combinedStatus([
			input.aarrr,
			input.metrics,
			input.experimentation
		]), "把最高杠杆问题转成可证伪的动作、主指标、护栏和停止条件。", "实验有明确人群、动作、主指标、护栏指标、负责人、周期、埋点和成功 / 停止标准。", "growth_experiment", "把刚才的最大瓶颈转成 HADI 实验，补充主指标、护栏指标、负责人、周期和停止条件。"),
		sopStep("priority", 5, "机会排序与承诺", combinedStatus([input.metrics, input.experimentation]), "在资源有限时决定先做什么，并让每个评分都能追溯到证据或明确标记为估计。", "候选机会有目标指标、证据链接，以及 reach、impact、confidence、effort / ease 等输入。", "growth_prioritize", "用 RICE 排序候选实验；标出事实、估计值和缺失输入，不要为了得到排名而编造分数。"),
		sopStep("review", 6, "复盘与安全回写", combinedStatus([input.metrics, input.operations]), "把结果、限制、决策、负责人和下一次验证写入固定运营节奏。", "报告中的数字都有来源，行动有负责人和日期；写入必须先 preview，再由用户确认。", "growth_report → growth_apply(confirm=false) → growth_apply(confirm=true)", "生成本周 WBR，先预览；列出结论、限制、决策、负责人和下周行动，不要直接写文件。")
	];
	return {
		currentStep: steps.find((step) => step.status !== "ready")?.id ?? "review",
		steps
	};
}
function buildGrowthOnboarding(input) {
	const { notes, profiles } = input;
	const data = dataDimension(profiles, input.datasetWarnings);
	const audits = notes;
	const text = notes.map((item) => item.note.content).join("\n");
	const jtbd = dimension("jtbd", "JTBD / ICP", auditScore(audits, "jtbd"), auditEvidence(audits, "jtbd"), ["目标用户、触发场景、期望进步和现有替代方案"], "补充目标用户、触发场景、期望进步和现有替代方案");
	const pmf = dimension("pmf", "PMF 验证", auditScore(audits, "pmf"), auditEvidence(audits, "pmf"), ["PMF Survey 或真实使用、留存、复购和推荐证据"], "补充 PMF Survey、真实使用证据和来源，不把 40% 当成结论");
	const northStar = dimension("northStar", "North Star 与驱动因素", auditScore(audits, "northStar"), auditEvidence(audits, "northStar"), ["North Star、驱动因素、基线、目标和统计周期"], "确定一个 North Star，并拆出 3—5 个可行动驱动因素");
	const aarrr = dimension("aarrr", "AARRR 口径", auditScore(audits, "aarrr"), auditEvidence(audits, "aarrr"), ["五个阶段的事件、分子、分母、时间窗口和目标"], "为当前关注的 AARRR 阶段补齐事件、分子、分母和目标");
	const metrics = dimension("metrics", "指标与证据", auditScore(audits, "metrics"), auditEvidence(audits, "metrics"), ["公式、数据来源、样本量、时间范围和缺失值规则"], "把关键指标写入指标字典，并绑定来源、时间范围和样本量");
	const experimentation = dimension("experimentation", "实验条件", auditScore(audits, "experimentation"), auditEvidence(audits, "experimentation"), ["可证伪假设、主指标、护栏指标、负责人和停止条件"], "把最高优先级问题转成带主指标、护栏指标和负责人的 HADI 实验");
	const operations = metadataDimension(notes);
	const dimensions = [
		jtbd,
		pmf,
		northStar,
		aarrr,
		metrics,
		data.dimension,
		experimentation,
		operations
	];
	const scores = dimensions.map((item) => item.score).filter((score$1) => score$1 !== null);
	const overallScore = scores.length === 0 ? 0 : Math.round(scores.reduce((sum, score$1) => sum + score$1, 0) / dimensions.length);
	const missingOrPartial = dimensions.filter((item) => item.status === "missing" || item.status === "partial").length;
	const overallStatus = overallScore === 0 ? "blocked" : missingOrPartial === 0 ? "ready" : "partial";
	const classicDocumentationMethod = (id, name$1, pattern, nextAction) => {
		const projectStatus = signalStatus(text, pattern);
		return {
			id,
			name: name$1,
			pluginCapability: "documentation",
			projectStatus,
			evidence: projectStatus === "ready" ? [`${name$1} is mentioned in the growth notes`] : [],
			nextAction
		};
	};
	const methods = [
		methodFromDimension("jtbd", "JTBD / ICP", "audit", jtbd),
		methodFromDimension("pmf", "PMF Survey", "template", pmf),
		methodFromDimension("northStar", "North Star / Driver Tree", "audit", northStar),
		methodFromDimension("aarrr", "AARRR Funnel", "analysis", aarrr),
		{
			id: "cohort",
			name: "Cohort / Retention",
			pluginCapability: "analysis",
			projectStatus: data.eventProfiles.some((profile) => inferStages(profile).some((stage) => stage.name === "Retention")) ? "ready" : data.eventProfiles.length > 0 ? "partial" : "missing",
			evidence: data.eventProfiles.slice(0, 3).map((profile) => `${profile.source}: ${inferStages(profile).map((stage) => stage.name).join(", ")}`),
			nextAction: data.eventProfiles.length === 0 ? "补充带用户、事件和时间字段的事件数据" : "确认留存事件、队列周期和分群口径"
		},
		{
			id: "economics",
			name: "MRR / Unit Economics",
			pluginCapability: "analysis",
			projectStatus: data.economicsProfiles.length > 0 ? "ready" : "missing",
			evidence: data.economicsProfiles.slice(0, 3).map((profile) => `${profile.source}: period/type/amount detected`),
			nextAction: data.economicsProfiles.length === 0 ? "补充 MRR movement、active_customers、spend 和 gross margin 口径" : "确认 amountMode、movementSource、gross margin 和期初 MRR"
		},
		methodFromDimension("hadi", "HADI Experiments", "analysis", experimentation),
		{
			id: "rice",
			name: "RICE / ICE",
			pluginCapability: "analysis",
			projectStatus: signalStatus(text, /\bRICE\b|\bICE\b/i),
			evidence: signalStatus(text, /\bRICE\b|\bICE\b/i) === "ready" ? ["A priority method is mentioned in the growth notes"] : [],
			nextAction: "为候选实验补充 reach、impact、confidence、effort 或 ease，并标注证据与估计值"
		},
		{
			id: "growth-loops",
			name: "Growth Loops",
			pluginCapability: "documentation",
			projectStatus: signalStatus(text, /growth loop|增长循环|增长飞轮/i),
			evidence: signalStatus(text, /growth loop|增长循环|增长飞轮/i) === "ready" ? ["A loop is mentioned in the growth notes"] : [],
			nextAction: "如果增长依赖循环，补充输入、动作、输出、回流点和限制条件"
		},
		{
			id: "external-acquisition",
			name: "External Acquisition Plan / Directory Submission SOP",
			pluginCapability: "documentation",
			projectStatus: signalStatus(text, /external acquisition|directory submission|backlink|外链|目录提交|渠道提交|外部获客/i),
			evidence: signalStatus(text, /external acquisition|directory submission|backlink|外链|目录提交|渠道提交|外部获客/i) === "ready" ? ["An external acquisition or directory-submission workflow is mentioned in the growth notes"] : [],
			nextAction: "使用 growth-acquisition-execution skill，先做相关性和合规质量门，产出不超过 10 个站点的试点方案与授权清单；不执行外部提交"
		},
		{
			id: "ai-discoverability",
			name: "AI Search / Discoverability Readiness",
			pluginCapability: "documentation",
			projectStatus: signalStatus(text, /AI search|AI readiness|AI discoverability|LLM|AEO|生成式搜索|AI 搜索|AI 可发现性|结构化数据|Product schema|Merchant Center/i),
			evidence: signalStatus(text, /AI search|AI readiness|AI discoverability|LLM|AEO|生成式搜索|AI 搜索|AI 可发现性|结构化数据|Product schema|Merchant Center/i) === "ready" ? ["AI search or discoverability readiness is mentioned in the growth notes"] : [],
			nextAction: "使用 growth-ai-discoverability skill，先判断业务类型和适用检查项，产出 AI 搜索可发现性准备度矩阵；不执行网站改造"
		},
		classicDocumentationMethod("value-proposition-canvas", "Value Proposition Canvas", /value proposition canvas|value proposition|价值主张画布|价值主张/i, "使用 growth-strategy-planning，补齐用户 Jobs / Pains / Gains 与产品匹配证据"),
		classicDocumentationMethod("lean-canvas", "Lean Canvas", /lean canvas|精益画布/i, "使用 growth-strategy-planning，整理问题、客户、渠道、收入和最高风险假设"),
		classicDocumentationMethod("activation-event", "Aha Moment / Activation Event", /aha moment|activation event|首次价值行为|激活事件|Aha 时刻/i, "使用 growth-strategy-planning，定义首次价值行为、激活窗口和留存验证"),
		classicDocumentationMethod("churn-winback", "Churn Taxonomy / Win-back", /churn taxonomy|win-back|winback|流失分类|流失原因|召回|挽回/i, "使用 growth-strategy-planning，建立流失分类、预警信号和召回假设"),
		classicDocumentationMethod("bullseye-channels", "Bullseye Channel Framework", /bullseye framework|bullseye|靶心框架|渠道假设|渠道优先级/i, "使用 growth-strategy-planning，整理候选、验证和重点渠道，并绑定停止条件"),
		classicDocumentationMethod("opportunity-solution-tree", "Opportunity Solution Tree", /opportunity solution tree|机会解决方案树|机会树|OST/i, "使用 growth-strategy-planning，把目标、机会、方案和实验分层，避免直接跳到功能"),
		classicDocumentationMethod("customer-research", "The Mom Test / Switch Interview", /the mom test|mom test|switch interview|用户访谈|客户研究|切换访谈/i, "使用 growth-strategy-planning，生成基于最近真实行为的访谈提纲和证据编码"),
		classicDocumentationMethod("referral-loop", "Referral Loop / K-factor", /referral loop|k-factor|推荐循环|推荐系数|邀请循环/i, "使用 growth-strategy-planning，定义推荐触发、受邀激活和质量护栏"),
		classicDocumentationMethod("market-sizing", "TAM / SAM / SOM", /\bTAM\b|\bSAM\b|\bSOM\b|市场规模|可服务市场/i, "使用 growth-strategy-planning，建立带来源、区间和敏感性分析的市场估算"),
		classicDocumentationMethod("pricing-research", "Pricing Research", /Van Westendorp|Gabor-Granger|定价研究|价格敏感度|套餐设计/i, "使用 growth-strategy-planning，形成价格研究假设、套餐方案和收入护栏"),
		classicDocumentationMethod("b2b-revenue-funnel", "B2B Revenue Funnel / MEDDICC", /\bMQL\b|\bSQL\b|MEDDICC|B2B 销售漏斗|销售漏斗|机会阶段/i, "使用 growth-strategy-planning，统一线索、机会、成交阶段和证据要求"),
		classicDocumentationMethod("growth-accounting", "Growth Accounting", /growth accounting|增长核算|用户增长桥|收入增长桥/i, "使用 growth-strategy-planning，拆解新增、留存、流失、召回和扩张贡献"),
		classicDocumentationMethod("operating-cadence", "OKR / A3 / OODA / Decision Log", /\bOKR\b|A3 problem|5 Whys|\bOODA\b|决策日志|decision log/i, "使用 growth-strategy-planning，统一目标、问题、行动、决策和复盘记录"),
		{
			id: "operating-review",
			name: "WBR / MBR / QBR",
			pluginCapability: "analysis",
			projectStatus: signalStatus(text, /\bWBR\b|\bMBR\b|\bQBR\b/i),
			evidence: signalStatus(text, /\bWBR\b|\bMBR\b|\bQBR\b/i) === "ready" ? ["An operating review is mentioned in the growth notes"] : [],
			nextAction: "用 growth_report 生成一次只读预览，并绑定指标、发现、实验、行动和 caveats"
		},
		{
			id: "causal-inference",
			name: "因果推断 / 实验统计",
			pluginCapability: "not-supported",
			projectStatus: "not-applicable",
			evidence: ["当前插件不计算显著性、贝叶斯结果或因果效应"],
			nextAction: "需要严格实验统计时，使用外部实验平台或统计分析流程，并把结果作为证据来源接入"
		},
		{
			id: "market-pricing",
			name: "市场规模 / 竞品 / 定价",
			pluginCapability: "not-supported",
			projectStatus: "not-applicable",
			evidence: ["当前插件不连接市场、竞品、CRM 或广告平台数据"],
			nextAction: "先在外部研究或业务文档中完成，再把结论和来源带回增长项目笔记"
		}
	];
	const sop = buildGrowthSop({
		jtbd,
		northStar,
		metrics,
		data: data.dimension,
		aarrr,
		experimentation,
		operations
	});
	const actionCandidates = dimensions.filter((item) => item.status === "missing" || item.status === "partial").toSorted((left, right) => (left.status === "missing" ? 0 : 1) - (right.status === "missing" ? 0 : 1)).map((item) => item.nextAction);
	const topActions = [...new Set(actionCandidates)].slice(0, 2);
	const questions = [];
	if (jtbd.status !== "ready") questions.push("产品服务谁？用户在什么场景下想完成什么进步？");
	if (data.eventProfiles.length === 0) questions.push("哪一份事件数据可以代表注册、激活或留存？");
	if (data.economicsProfiles.length === 0) questions.push("本轮是否需要分析收入和获客成本？如果需要，请提供 MRR / 成本数据。");
	if (questions.length < 3 && northStar.status !== "ready") questions.push("当前最能代表用户获得价值的一个 North Star 指标是什么？");
	const warnings = [...new Set([
		...input.datasetWarnings,
		...input.scanErrors,
		...input.skippedFiles && input.skippedFiles > 0 ? [`${input.skippedFiles} file(s) were skipped because of scan limits`] : [],
		...notes.length === 0 ? ["No growth Markdown note was found; strategy readiness is based on missing evidence, not a product judgment"] : []
	])];
	return {
		generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
		root: input.root,
		overallStatus,
		overallScore,
		sources: {
			growthNotes: notes.length,
			datasets: profiles.length,
			eventDatasets: data.eventProfiles.map((profile) => profile.source),
			economicsDatasets: data.economicsProfiles.map((profile) => profile.source),
			notes: notes.slice(0, 20).map((item) => ({
				path: item.note.path,
				title: item.note.title,
				readiness: item.audit.readiness.overall,
				missingMetadata: item.missingMetadata
			}))
		},
		dimensions,
		methods,
		sop,
		topActions,
		questions: questions.slice(0, 3),
		warnings
	};
}
async function collectOnboardingProfiles(fs, config, root, signal, growthData) {
	const health = await (growthData?.doctor(root, signal) ?? doctorRoot(fs, root, config, signal));
	const warnings = [...health.checks.filter((check) => check.status === "warning").map((check) => `Data scan: ${check.message}`)];
	const profiles = [];
	for (const summary of health.datasets) {
		if (summary.status === "error") continue;
		try {
			const dataset = await (growthData?.readDataset(summary.path, signal) ?? readDataset(fs, config, summary.path, signal));
			const profile = growthData?.profileDataset(summary.path, dataset.rows) ?? profileDataset(summary.path, dataset.rows);
			profile.quality.warnings = [...new Set([
				...profile.quality.warnings,
				...dataset.warnings,
				...summary.warnings
			])];
			profiles.push(profile);
		} catch (error) {
			warnings.push(`Data scan skipped '${summary.path}': ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	return {
		profiles,
		warnings
	};
}

//#endregion
//#region src/vault.ts
function isStale(updated) {
	if (typeof updated !== "string" || !updated.trim()) return true;
	const date = new Date(updated);
	if (Number.isNaN(date.getTime())) return true;
	return Date.now() - date.getTime() > 90 * 864e5;
}
function isGrowthNote(note) {
	const type = String(note.frontmatter.type ?? "").toLowerCase();
	if ([
		"growth-project",
		"metric",
		"experiment",
		"campaign",
		"growth-report",
		"channel"
	].includes(type)) return true;
	return /AARRR|North Star|增长|获客|留存|激活|MRR|CAC|LTV|实验|转化/i.test(note.content);
}
async function readNote(fs, path, config, signal) {
	const target = await fs.resolve(path, { signal });
	const info = await fs.stat(target, signal);
	if (!info || info.type !== "file") throw new Error(`Markdown file not found: ${path}`);
	if ((info.size ?? 0) > config.maxFileBytes) throw new Error(`File exceeds maxFileBytes (${config.maxFileBytes})`);
	const content = await fs.readText(target, signal);
	if (content.length > config.maxTextChars) throw new Error(`File exceeds maxTextChars (${config.maxTextChars})`);
	return parseNote(path, content);
}
async function scanGrowthVault(fs, root, config, signal) {
	const errors = [];
	const records = [];
	let scannedFiles = 0;
	let skippedFiles = 0;
	async function visit(target, displayPath) {
		if (scannedFiles >= config.maxFiles) {
			skippedFiles += 1;
			return;
		}
		const entries = await fs.listDir(target, signal);
		for (const entry of entries) {
			if (scannedFiles >= config.maxFiles) {
				skippedFiles += 1;
				continue;
			}
			const childPath = `${displayPath.replace(/[\\/]$/, "")}/${entry.name}`;
			if (entry.type === "directory") {
				await visit(entry.target, childPath);
				continue;
			}
			if (entry.type !== "file" || !entry.name.toLowerCase().endsWith(".md")) continue;
			scannedFiles += 1;
			try {
				if ((entry.size ?? 0) > config.maxFileBytes) {
					skippedFiles += 1;
					errors.push(`${childPath}: exceeds maxFileBytes`);
					continue;
				}
				const content = await fs.readText(entry.target, signal);
				if (content.length > config.maxTextChars) {
					skippedFiles += 1;
					errors.push(`${childPath}: exceeds maxTextChars`);
					continue;
				}
				const note = parseNote(childPath, content);
				if (!isGrowthNote(note)) continue;
				const reasons = [];
				String(note.frontmatter.type ?? "");
				String(note.frontmatter.status ?? "");
				if (!note.frontmatter.type) reasons.push("missing type");
				if (!note.frontmatter.status) reasons.push("missing status");
				if (!note.frontmatter.updated || isStale(note.frontmatter.updated)) reasons.push("stale or missing updated date");
				if (!note.frontmatter.source && note.externalLinks.length === 0) reasons.push("missing source");
				if (!note.frontmatter.target && !/目标|target/i.test(note.content)) reasons.push("missing target");
				if (!note.frontmatter.owner && !/负责人|owner/i.test(note.content)) reasons.push("missing owner");
				records.push({
					note,
					reasons: reasons.length > 0 ? reasons : ["healthy"]
				});
			} catch (error) {
				errors.push(`${childPath}: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
	}
	await visit(await fs.resolve(root, { signal }), root);
	const byType = {};
	const byStatus = {};
	let missingMetadata = 0;
	let staleNotes = 0;
	let missingSources = 0;
	let missingTargets = 0;
	for (const record of records) {
		const type = String(record.note.frontmatter.type ?? "untyped");
		const status = String(record.note.frontmatter.status ?? "unstated");
		byType[type] = (byType[type] ?? 0) + 1;
		byStatus[status] = (byStatus[status] ?? 0) + 1;
		if (!record.note.frontmatter.type || !record.note.frontmatter.status) missingMetadata += 1;
		if (record.reasons.some((reason) => reason.includes("stale"))) staleNotes += 1;
		if (record.reasons.some((reason) => reason.includes("source"))) missingSources += 1;
		if (record.reasons.some((reason) => reason.includes("target"))) missingTargets += 1;
	}
	return {
		root,
		generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
		scannedFiles,
		skippedFiles,
		errors,
		summary: {
			growthNotes: records.length,
			missingMetadata,
			staleNotes,
			missingSources,
			missingTargets,
			byType,
			byStatus
		},
		priorityFiles: records.toSorted((left, right) => right.reasons.length - left.reasons.length).slice(0, 20).map((record) => ({
			path: record.note.path,
			title: record.note.title,
			type: String(record.note.frontmatter.type ?? "untyped"),
			status: String(record.note.frontmatter.status ?? "unstated"),
			reasons: record.reasons
		}))
	};
}

//#endregion
//#region src/tools.ts
function growthOutput(maxChars) {
	return {
		schema: resultSchema,
		render: (_args, value$1) => renderResult(value$1, maxChars)
	};
}
function wrapResult(value$1, options = {}) {
	return resultEnvelope({
		data: value$1,
		warnings: typeof value$1 === "object" && value$1 !== null && "warnings" in value$1 && Array.isArray(value$1.warnings) ? value$1.warnings.filter((warning) => typeof warning === "string") : [],
		assumptions: options.assumptions,
		lineage: options.lineage,
		nextActions: options.nextActions
	});
}
function fsFrom(ctx) {
	return ctx.fs;
}
function growthDataFrom(ctx) {
	return ctx["growth-data"];
}
async function ensureInsideRoot(fs, config, targetPath, signal) {
	const root = await fs.resolve(config.defaultRoot, { signal });
	const target = await fs.resolve(targetPath, { signal });
	if (!fs.contains(root, target)) throw new Error(`Path is outside configured defaultRoot: ${targetPath}`);
}
function priorityItems(value$1) {
	const parsed = JSON.parse(value$1);
	if (!Array.isArray(parsed)) throw new Error("items must be a JSON array");
	return parsed.map((item, index) => {
		if (typeof item !== "object" || item === null) throw new Error(`items[${index}] must be an object`);
		const record = item;
		return {
			...calculatePriority({
				method: validMethod(record.method === void 0 ? void 0 : String(record.method)),
				reach: typeof record.reach === "number" ? record.reach : void 0,
				impact: typeof record.impact === "number" ? record.impact : void 0,
				confidence: typeof record.confidence === "number" ? record.confidence : void 0,
				effort: typeof record.effort === "number" ? record.effort : void 0,
				ease: typeof record.ease === "number" ? record.ease : void 0
			}),
			title: String(record.title ?? `Opportunity ${index + 1}`),
			evidence: record.evidence ? String(record.evidence) : void 0,
			targetMetric: record.targetMetric ? String(record.targetMetric) : void 0
		};
	});
}
function validInterval(value$1) {
	if (value$1 === void 0 || value$1 === "") return "week";
	if (value$1 === "day" || value$1 === "week" || value$1 === "month") return value$1;
	throw new Error(`interval must be one of: day, week, month; received '${value$1}'`);
}
function validStage(value$1) {
	if (value$1 === void 0 || value$1 === "") return "activation";
	if (value$1 === "acquisition" || value$1 === "activation" || value$1 === "retention" || value$1 === "referral" || value$1 === "revenue") return value$1;
	throw new Error(`stage must be one of: acquisition, activation, retention, referral, revenue; received '${value$1}'`);
}
function validReportType(value$1) {
	if (value$1 === void 0 || value$1 === "") return "wbr";
	if (value$1 === "wbr" || value$1 === "mbr" || value$1 === "qbr" || value$1 === "experiment-review") return value$1;
	throw new Error(`reportType must be one of: wbr, mbr, qbr, experiment-review; received '${value$1}'`);
}
function validMethod(value$1) {
	if (value$1 === void 0 || value$1 === "") return "rice";
	if (value$1 === "rice" || value$1 === "ice") return value$1;
	throw new Error(`method must be one of: rice, ice; received '${value$1}'`);
}
function validSequenceMode(value$1) {
	if (value$1 === void 0 || value$1 === "") return "any-event";
	if (value$1 === "any-event" || value$1 === "ordered") return value$1;
	throw new Error(`sequenceMode must be one of: any-event, ordered; received '${value$1}'`);
}
function validAttribution(value$1) {
	if (value$1 === void 0 || value$1 === "") return "entry-touch";
	if (value$1 === "first-touch" || value$1 === "last-touch" || value$1 === "entry-touch") return value$1;
	throw new Error(`attribution must be one of: first-touch, last-touch, entry-touch; received '${value$1}'`);
}
function validWindow(value$1) {
	if (value$1 === void 0) return void 0;
	if (!Number.isInteger(value$1) || value$1 <= 0 || value$1 > 3650) throw new Error(`conversionWindowDays must be an integer from 1 to 3650; received '${value$1}'`);
	return value$1;
}
function validAmountMode(value$1) {
	if (value$1 === void 0 || value$1 === "") return "absolute";
	if (value$1 === "absolute" || value$1 === "signed") return value$1;
	throw new Error(`amountMode must be one of: absolute, signed; received '${value$1}'`);
}
function validMovementSource(value$1) {
	if (value$1 === void 0 || value$1 === "") return "movement";
	if (value$1 === "movement" || value$1 === "snapshot") return value$1;
	throw new Error(`movementSource must be one of: movement, snapshot; received '${value$1}'`);
}
function validGrossMargin(value$1) {
	if (value$1 === void 0) return 1;
	if (!Number.isFinite(value$1) || value$1 <= 0 || value$1 > 1) throw new Error(`grossMargin must be greater than 0 and no greater than 1; received '${value$1}'`);
	return value$1;
}
function validMaxPeriods(value$1) {
	if (value$1 === void 0) return 12;
	if (!Number.isInteger(value$1) || value$1 < 1 || value$1 > 52) throw new Error(`maxPeriods must be an integer from 1 to 52; received '${value$1}'`);
	return value$1;
}
function reportInputFromReview(value$1) {
	const parsed = JSON.parse(value$1);
	const envelope = typeof parsed === "object" && parsed !== null && "data" in parsed ? parsed.data : parsed;
	if (typeof envelope !== "object" || envelope === null || !("goal" in envelope) || !("profiles" in envelope)) throw new Error("reviewJson must be a growth_review result or its data object");
	const review = envelope;
	const metrics = [];
	const sources = review.profiles.map((profile) => profile.source);
	const source = sources[0];
	const funnel = review.analyses.funnel;
	if (funnel) funnel.stages.forEach((stage, index) => metrics.push({
		name: `${stage.name} users`,
		current: String(stage.users),
		previous: index > 0 ? String(funnel.stages[index - 1]?.users ?? "-") : void 0,
		delta: stage.conversionFromPrevious === null ? void 0 : `${stage.conversionFromPrevious}%`,
		source: funnel.source
	}));
	const cohort = review.analyses.cohort;
	if (cohort) {
		const cell = cohort.cohorts[0]?.cells.find((item) => item.period === 1);
		if (cell) metrics.push({
			name: "retention period 1",
			current: `${cell.retentionRate ?? "-"}%`,
			source: cohort.source
		});
	}
	const economics = review.analyses.economics;
	const latest = economics?.periods.at(-1);
	if (economics && latest) {
		metrics.push({
			name: "ending MRR",
			current: String(latest.endingMrr ?? "-"),
			source: economics.source
		});
		metrics.push({
			name: "NRR",
			current: `${latest.nrr ?? "-"}%`,
			source: economics.source
		});
		metrics.push({
			name: "CAC",
			current: String(latest.cac ?? "-"),
			source: economics.source
		});
	}
	return {
		summary: review.bottlenecks[0] ? `${review.goal}; ${review.bottlenecks[0]}` : review.goal,
		metrics,
		findings: review.bottlenecks,
		experiments: review.hypotheses,
		nextActions: review.nextActions,
		caveats: [...review.warnings, ...review.profiles.flatMap((profile) => profile.quality.warnings)],
		sources: source ? [...new Set([source, ...sources])] : [...new Set(sources)]
	};
}
function replacementDiff(before, after) {
	const beforeLines = before.split(/\r?\n/);
	const afterLines = after.split(/\r?\n/);
	const preview = [];
	let changedLines = 0;
	const length = Math.max(beforeLines.length, afterLines.length);
	for (let index = 0; index < length; index += 1) {
		const left = beforeLines[index];
		const right = afterLines[index];
		if (left === right) continue;
		changedLines += 1;
		if (preview.length < 20) {
			if (left !== void 0) preview.push(`- ${left}`);
			if (right !== void 0) preview.push(`+ ${right}`);
		}
	}
	return {
		beforeLines: beforeLines.length,
		afterLines: afterLines.length,
		changedLines,
		preview
	};
}
function emitAnalysisStarted(ctx, kind, sources, goal) {
	ctx.emit("growth/analysis-started", {
		kind,
		sources,
		...goal ? { goal } : {}
	});
}
function emitAnalysisCompleted(ctx, kind, sources, warningCount) {
	ctx.emit("growth/analysis-completed", {
		kind,
		sources,
		warningCount
	});
}
async function discoverReviewDatasets(fs, config, root, signal, growthData) {
	const health = await (growthData?.doctor(root, signal) ?? doctorRoot(fs, root, config, signal));
	const datasets = [];
	const warnings = health.checks.filter((check) => check.status === "warning").map((check) => `Auto-discovery: ${check.message}`);
	for (const summary of health.datasets) {
		if (summary.status === "error") continue;
		try {
			const dataset = await (growthData?.readDataset(summary.path, signal) ?? readDataset(fs, config, summary.path, signal));
			const profile = growthData?.profileDataset(summary.path, dataset.rows) ?? profileDataset(summary.path, dataset.rows);
			profile.quality.warnings = [...new Set([
				...profile.quality.warnings,
				...dataset.warnings,
				...summary.warnings
			])];
			datasets.push({
				path: summary.path,
				rows: dataset.rows,
				warnings: dataset.warnings,
				profile
			});
		} catch (error) {
			warnings.push(`Auto-discovery skipped '${summary.path}': ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	return {
		datasets,
		warnings
	};
}
function registerGrowthTools(ctx, config) {
	const fs = fsFrom(ctx);
	const growthData = growthDataFrom(ctx);
	ctx.tools.register(defineTool({
		name: "growth_audit_note",
		description: "Audit one Markdown growth note for JTBD, PMF, North Star, AARRR, metrics, evidence and experiment readiness. Reads only.",
		parameters: { path: {
			type: "string",
			required: true,
			description: "Absolute or workspace-relative Markdown path."
		} },
		output: growthOutput(config.maxResultChars),
		async execute(args, exec) {
			await ensureInsideRoot(fs, config, args.path, exec.signal);
			return wrapResult(auditGrowthNote(await readNote(fs, args.path, config, exec.signal)), { lineage: [{ source: args.path }] });
		}
	}));
	ctx.tools.register(defineTool({
		name: "growth_audit_vault",
		description: "Scan a local Markdown knowledge base for growth-project, metric, experiment, channel and report quality gaps. Reads only.",
		parameters: { root: {
			type: "string",
			description: "Optional directory under defaultRoot."
		} },
		output: growthOutput(config.maxResultChars),
		async execute(args, exec) {
			const root = args.root?.trim() || config.defaultRoot;
			await ensureInsideRoot(fs, config, root, exec.signal);
			return wrapResult(await scanGrowthVault(fs, root, config, exec.signal), { lineage: [{ source: root }] });
		}
	}));
	ctx.tools.register(defineTool({
		name: "growth_doctor",
		description: "Run a read-only health check on the configured local growth workspace: discover supported datasets, inspect limits, and summarize data quality issues without returning raw rows.",
		parameters: {
			root: {
				type: "string",
				description: "Optional directory under defaultRoot."
			},
			includeDatasets: {
				type: "boolean",
				description: "Whether to include per-file summaries; defaults to true."
			}
		},
		output: growthOutput(config.maxResultChars),
		async execute(args, exec) {
			const root = args.root?.trim() || config.defaultRoot;
			await ensureInsideRoot(fs, config, root, exec.signal);
			emitAnalysisStarted(ctx, "doctor", [root]);
			const result = await (growthData?.doctor(root, exec.signal) ?? doctorRoot(fs, root, config, exec.signal));
			if (args.includeDatasets === false) result.datasets = [];
			emitAnalysisCompleted(ctx, "doctor", [root], result.summary.warnings + result.summary.errors);
			return wrapResult(result, {
				lineage: [{ source: root }],
				nextActions: result.nextActions
			});
		}
	}));
	ctx.tools.register(defineTool({
		name: "growth_onboarding",
		description: "Run a read-only growth readiness check across local strategy notes and datasets. Reports what is ready, partial, missing or not supported, including classic method coverage and the top two gaps to fix next.",
		parameters: {
			root: {
				type: "string",
				description: "Optional project directory under defaultRoot; defaults to defaultRoot."
			},
			notePath: {
				type: "string",
				description: "Optional Markdown strategy note to audit instead of scanning all growth notes under root."
			}
		},
		output: growthOutput(config.maxResultChars),
		async execute(args, exec) {
			const root = args.root?.trim() || config.defaultRoot;
			await ensureInsideRoot(fs, config, root, exec.signal);
			if (args.notePath?.trim()) {
				await ensureInsideRoot(fs, config, args.notePath, exec.signal);
				const rootTarget = await fs.resolve(root, { signal: exec.signal });
				const noteTarget = await fs.resolve(args.notePath, { signal: exec.signal });
				if (!fs.contains(rootTarget, noteTarget)) throw new Error(`notePath must be inside root: ${args.notePath}`);
			}
			emitAnalysisStarted(ctx, "onboarding", [root, ...args.notePath?.trim() ? [args.notePath.trim()] : []]);
			const notes = await collectOnboardingNotes(fs, root, config, exec.signal, args.notePath?.trim() || void 0);
			const datasets = await collectOnboardingProfiles(fs, config, root, exec.signal, growthData);
			const result = buildGrowthOnboarding({
				root,
				notes: notes.notes,
				profiles: datasets.profiles,
				datasetWarnings: datasets.warnings,
				scanErrors: notes.errors,
				skippedFiles: notes.skippedFiles
			});
			emitAnalysisCompleted(ctx, "onboarding", [root], result.warnings.length);
			result.warnings.forEach((message) => ctx.emit("growth/warning", {
				kind: "onboarding",
				source: root,
				message
			}));
			return wrapResult(result, {
				lineage: [{ source: root }, ...args.notePath?.trim() ? [{ source: args.notePath.trim() }] : []],
				assumptions: ["Readiness is based on detected local evidence; an undetected method is not proof that the team has never used it.", "Not-supported methods require an external research, experiment or execution system."],
				nextActions: result.topActions
			});
		}
	}));
	ctx.tools.register(defineTool({
		name: "growth_profile_dataset",
		description: "Profile one local CSV, JSON or JSONL dataset. Infers field mappings, coverage, date range and quality warnings while omitting raw user-level samples.",
		parameters: {
			sourcePath: {
				type: "string",
				required: true,
				description: "CSV, JSON or JSONL dataset path."
			},
			userField: {
				type: "string",
				description: "Optional explicit user/customer identifier field."
			},
			eventField: {
				type: "string",
				description: "Optional explicit event field."
			},
			timeField: {
				type: "string",
				description: "Optional explicit timestamp/date field."
			},
			channelField: {
				type: "string",
				description: "Optional explicit acquisition channel field."
			},
			segmentField: {
				type: "string",
				description: "Optional explicit segment field."
			},
			periodField: {
				type: "string",
				description: "Optional explicit MRR period field."
			},
			typeField: {
				type: "string",
				description: "Optional explicit MRR movement type field."
			},
			amountField: {
				type: "string",
				description: "Optional explicit amount/MRR field."
			},
			customerField: {
				type: "string",
				description: "Optional explicit customer identifier field."
			},
			spendField: {
				type: "string",
				description: "Optional explicit acquisition spend field."
			},
			currencyField: {
				type: "string",
				description: "Optional explicit currency field."
			}
		},
		output: growthOutput(config.maxResultChars),
		async execute(args, exec) {
			await ensureInsideRoot(fs, config, args.sourcePath, exec.signal);
			emitAnalysisStarted(ctx, "profile", [args.sourcePath]);
			const dataset = await (growthData?.readDataset(args.sourcePath, exec.signal) ?? readDataset(fs, config, args.sourcePath, exec.signal));
			const profile = growthData?.profileDataset(args.sourcePath, dataset.rows, {
				userField: args.userField,
				eventField: args.eventField,
				timeField: args.timeField,
				channelField: args.channelField,
				segmentField: args.segmentField,
				periodField: args.periodField,
				typeField: args.typeField,
				amountField: args.amountField,
				customerField: args.customerField,
				spendField: args.spendField,
				currencyField: args.currencyField
			}) ?? profileDataset(args.sourcePath, dataset.rows, {
				userField: args.userField,
				eventField: args.eventField,
				timeField: args.timeField,
				channelField: args.channelField,
				segmentField: args.segmentField,
				periodField: args.periodField,
				typeField: args.typeField,
				amountField: args.amountField,
				customerField: args.customerField,
				spendField: args.spendField,
				currencyField: args.currencyField
			});
			profile.quality.warnings.push(...dataset.warnings);
			emitAnalysisCompleted(ctx, "profile", [args.sourcePath], profile.quality.warnings.length);
			profile.quality.warnings.forEach((message) => ctx.emit("growth/warning", {
				kind: "profile",
				source: args.sourcePath,
				message
			}));
			return wrapResult(profile, {
				lineage: [{
					source: args.sourcePath,
					fields: profile.columns
				}],
				nextActions: profile.recommendations
			});
		}
	}));
	ctx.tools.register(defineTool({
		name: "growth_review",
		description: "Run a goal-oriented local growth review: profile data, choose usable AARRR/cohort/MRR analyses, identify bottlenecks and propose evidence-aware next actions. Paths are optional; when omitted, the configured root is scanned and selected sources are reported.",
		parameters: {
			goal: {
				type: "string",
				required: true,
				description: "Business goal or decision to support, such as improve activation or decide whether to scale a channel."
			},
			root: {
				type: "string",
				description: "Optional directory under defaultRoot to scan when eventPath and economicsPath are omitted."
			},
			eventPath: {
				type: "string",
				description: "Optional event dataset path for funnel/cohort analysis."
			},
			economicsPath: {
				type: "string",
				description: "Optional MRR movement/cost dataset path for unit economics."
			},
			notePath: {
				type: "string",
				description: "Optional Markdown growth note path for context and evidence audit."
			},
			userField: {
				type: "string",
				description: "Optional event user identifier field."
			},
			eventField: {
				type: "string",
				description: "Optional event name field."
			},
			timeField: {
				type: "string",
				description: "Optional event timestamp/date field."
			},
			periodField: {
				type: "string",
				description: "Optional MRR period field."
			},
			typeField: {
				type: "string",
				description: "Optional MRR movement type field."
			},
			amountField: {
				type: "string",
				description: "Optional MRR amount field."
			},
			grossMargin: {
				type: "number",
				description: "Optional gross margin ratio for economics."
			},
			amountMode: {
				type: "string",
				description: "absolute or signed MRR input semantics."
			},
			movementSource: {
				type: "string",
				description: "movement or snapshot economics source."
			}
		},
		output: growthOutput(config.maxResultChars),
		async execute(args, exec) {
			let eventPath = args.eventPath?.trim() || void 0;
			let economicsPath = args.economicsPath?.trim() || void 0;
			const notePath = args.notePath?.trim() || void 0;
			const profiles = [];
			const lineage = [];
			const reviewWarnings = [];
			const reviewAssumptions = [];
			const discoveredByPath = /* @__PURE__ */ new Map();
			if (!eventPath && !economicsPath && !notePath) {
				const root = args.root?.trim() || config.defaultRoot;
				await ensureInsideRoot(fs, config, root, exec.signal);
				const discovered = await discoverReviewDatasets(fs, config, root, exec.signal, growthData);
				const selection = selectReviewSources(discovered.datasets.map((item) => item.profile));
				discovered.datasets.forEach((item) => discoveredByPath.set(item.path, item));
				eventPath = selection.eventPath;
				economicsPath = selection.economicsPath;
				reviewWarnings.push(...discovered.warnings);
				if (eventPath) {
					reviewAssumptions.push(`eventPath was omitted; auto-selected ${eventPath} from ${root} because it contains a user field, event field, timestamp and at least two recognizable stages`);
					if (selection.eventCandidates.length > 1) reviewWarnings.push(`Auto-discovery found multiple event datasets; selected '${eventPath}'. Other candidates: ${selection.eventCandidates.slice(1).join(", ")}`);
				} else reviewWarnings.push(`Auto-discovery found no dataset ready for funnel or cohort analysis under '${root}'`);
				if (economicsPath) {
					reviewAssumptions.push(`economicsPath was omitted; auto-selected ${economicsPath} from ${root} because it contains period, type and amount fields`);
					if (selection.economicsCandidates.length > 1) reviewWarnings.push(`Auto-discovery found multiple MRR datasets; selected '${economicsPath}'. Other candidates: ${selection.economicsCandidates.slice(1).join(", ")}`);
				} else reviewWarnings.push(`Auto-discovery found no dataset ready for MRR or unit-economics analysis under '${root}'`);
				if (!eventPath && !economicsPath) reviewWarnings.push(`No usable event or MRR dataset was found under '${root}'; add a supported CSV, JSON or JSONL export and rerun the review`);
			}
			const selectedSources = [
				eventPath,
				economicsPath,
				notePath
			].filter((path) => Boolean(path));
			emitAnalysisStarted(ctx, "review", selectedSources.length > 0 ? selectedSources : [args.root?.trim() || config.defaultRoot], args.goal);
			let funnel;
			let cohort;
			let economics;
			let noteAudit;
			if (eventPath) {
				await ensureInsideRoot(fs, config, eventPath, exec.signal);
				const discovered = discoveredByPath.get(eventPath);
				const dataset = discovered ?? await (growthData?.readDataset(eventPath, exec.signal) ?? readDataset(fs, config, eventPath, exec.signal));
				const profile = discovered?.profile ?? growthData?.profileDataset(eventPath, dataset.rows, {
					userField: args.userField,
					eventField: args.eventField,
					timeField: args.timeField
				}) ?? profileDataset(eventPath, dataset.rows, {
					userField: args.userField,
					eventField: args.eventField,
					timeField: args.timeField
				});
				profile.quality.warnings.push(...dataset.warnings);
				profiles.push(profile);
				lineage.push({
					source: eventPath,
					fields: [
						profile.selectedFields.userField,
						profile.selectedFields.eventField,
						profile.selectedFields.timeField
					].filter((field) => Boolean(field))
				});
				const stages = inferStages(profile);
				if (stages.length >= 2 && profile.selectedFields.userField && profile.selectedFields.eventField) {
					funnel = analyzeFunnel(eventPath, dataset.rows, {
						stages,
						userField: profile.selectedFields.userField,
						eventField: profile.selectedFields.eventField,
						channelField: profile.selectedFields.channelField ?? void 0,
						segmentField: profile.selectedFields.segmentField ?? void 0,
						timeField: profile.selectedFields.timeField ?? void 0,
						sequenceMode: "ordered",
						attribution: "entry-touch",
						timezone: config.defaultTimezone
					});
					funnel.warnings.push(...dataset.warnings);
					const acquisition = stages.find((stage) => stage.name === "Acquisition");
					const retention = stages.find((stage) => stage.name === "Retention");
					if (acquisition && retention && profile.selectedFields.timeField) {
						cohort = analyzeCohorts(eventPath, dataset.rows, {
							cohortEvent: acquisition.event,
							retentionEvent: retention.event,
							userField: profile.selectedFields.userField,
							eventField: profile.selectedFields.eventField,
							timeField: profile.selectedFields.timeField,
							interval: "week",
							maxPeriods: 12
						});
						cohort.warnings.push(...dataset.warnings);
					}
				} else profile.quality.warnings.push("Fewer than two recognizable funnel event values were found; funnel analysis was skipped");
			}
			if (economicsPath) {
				await ensureInsideRoot(fs, config, economicsPath, exec.signal);
				const discovered = discoveredByPath.get(economicsPath);
				const dataset = discovered ?? await (growthData?.readDataset(economicsPath, exec.signal) ?? readDataset(fs, config, economicsPath, exec.signal));
				const profile = discovered?.profile ?? growthData?.profileDataset(economicsPath, dataset.rows, {
					periodField: args.periodField,
					typeField: args.typeField,
					amountField: args.amountField
				}) ?? profileDataset(economicsPath, dataset.rows, {
					periodField: args.periodField,
					typeField: args.typeField,
					amountField: args.amountField
				});
				profile.quality.warnings.push(...dataset.warnings);
				profiles.push(profile);
				lineage.push({
					source: economicsPath,
					fields: [
						profile.selectedFields.periodField,
						profile.selectedFields.typeField,
						profile.selectedFields.amountField
					].filter((field) => Boolean(field))
				});
				if (profile.selectedFields.periodField && profile.selectedFields.typeField && profile.selectedFields.amountField) {
					economics = analyzeEconomics(economicsPath, dataset.rows, {
						periodField: profile.selectedFields.periodField,
						typeField: profile.selectedFields.typeField,
						amountField: profile.selectedFields.amountField,
						customerField: profile.selectedFields.customerField ?? "customer_id",
						spendField: profile.selectedFields.spendField ?? "spend",
						currency: profile.distinctValues.currencies[0] ?? config.defaultCurrency,
						grossMargin: validGrossMargin(args.grossMargin),
						amountMode: validAmountMode(args.amountMode),
						movementSource: validMovementSource(args.movementSource)
					});
					if (args.grossMargin === void 0) economics.warnings.push("grossMargin was not supplied; LTV uses a 100% gross-margin assumption");
					economics.warnings.push(...dataset.warnings);
				} else profile.quality.warnings.push("Required period/type/amount fields were not all found; economics analysis was skipped");
			}
			if (notePath) {
				await ensureInsideRoot(fs, config, notePath, exec.signal);
				noteAudit = auditGrowthNote(await readNote(fs, notePath, config, exec.signal));
				lineage.push({ source: notePath });
			}
			const review = buildReview({
				goal: args.goal,
				profiles,
				funnel,
				cohort,
				economics,
				noteAudit,
				warnings: reviewWarnings
			});
			emitAnalysisCompleted(ctx, "review", lineage.map((item) => item.source), review.warnings.length);
			review.warnings.forEach((message) => ctx.emit("growth/warning", {
				kind: "review",
				message
			}));
			return wrapResult(review, {
				lineage,
				assumptions: reviewAssumptions,
				nextActions: review.nextActions
			});
		}
	}));
	ctx.tools.register(defineTool({
		name: "growth_funnel_analyze",
		description: "Analyze an event dataset as an AARRR-style funnel, with conversion, drop-off, channel and segment comparisons.",
		parameters: {
			sourcePath: {
				type: "string",
				required: true,
				description: "CSV, JSON or JSONL event dataset path."
			},
			stages: {
				type: "string",
				description: "Comma-separated stage=event pairs or a JSON array."
			},
			userField: {
				type: "string",
				description: "User ID field; defaults to user_id."
			},
			eventField: {
				type: "string",
				description: "Event name field; defaults to event."
			},
			channelField: {
				type: "string",
				description: "Optional acquisition channel field."
			},
			segmentField: {
				type: "string",
				description: "Optional user segment field."
			},
			timeField: {
				type: "string",
				description: "Timestamp/date field; defaults to timestamp."
			},
			start: {
				type: "string",
				description: "Optional ISO start date."
			},
			end: {
				type: "string",
				description: "Optional ISO end date."
			},
			sequenceMode: {
				type: "string",
				description: "any-event counts event presence; ordered requires the stage sequence."
			},
			conversionWindowDays: {
				type: "number",
				description: "Optional positive window from entry to final stage, in days."
			},
			attribution: {
				type: "string",
				description: "first-touch, last-touch or entry-touch channel attribution."
			}
		},
		output: growthOutput(config.maxResultChars),
		async execute(args, exec) {
			await ensureInsideRoot(fs, config, args.sourcePath, exec.signal);
			const dataset = await readDataset(fs, config, args.sourcePath, exec.signal);
			const stages = parseStages(args.stages);
			if (stages.length < 2) throw new Error("stages must contain at least two valid stage/event pairs");
			const result = analyzeFunnel(args.sourcePath, dataset.rows, {
				stages,
				userField: args.userField?.trim() || "user_id",
				eventField: args.eventField?.trim() || "event",
				channelField: args.channelField?.trim() || void 0,
				segmentField: args.segmentField?.trim() || void 0,
				timeField: args.timeField?.trim() || "timestamp",
				start: args.start,
				end: args.end,
				sequenceMode: validSequenceMode(args.sequenceMode),
				conversionWindowDays: validWindow(args.conversionWindowDays),
				attribution: validAttribution(args.attribution),
				timezone: config.defaultTimezone
			});
			result.warnings.push(...dataset.warnings);
			return wrapResult(result, {
				lineage: [{
					source: args.sourcePath,
					fields: [
						args.userField?.trim() || "user_id",
						args.eventField?.trim() || "event",
						args.timeField?.trim() || "timestamp"
					],
					window: {
						start: args.start,
						end: args.end,
						timezone: config.defaultTimezone
					}
				}],
				assumptions: [validSequenceMode(args.sequenceMode) === "ordered" ? "Ordered mode requires each stage to occur after the previous stage for the same user." : "Any-event mode counts distinct users who have each event, regardless of event order."]
			});
		}
	}));
	ctx.tools.register(defineTool({
		name: "growth_cohort_analyze",
		description: "Analyze retention cohorts from an event dataset by day, week or month, including lifecycle counts.",
		parameters: {
			sourcePath: {
				type: "string",
				required: true,
				description: "CSV, JSON or JSONL event dataset path."
			},
			cohortEvent: {
				type: "string",
				required: true,
				description: "Event defining cohort entry, such as signup."
			},
			retentionEvent: {
				type: "string",
				required: true,
				description: "Event defining retained activity, such as active."
			},
			userField: {
				type: "string",
				description: "User ID field; defaults to user_id."
			},
			eventField: {
				type: "string",
				description: "Event name field; defaults to event."
			},
			timeField: {
				type: "string",
				description: "Timestamp field; defaults to timestamp."
			},
			interval: {
				type: "string",
				description: "day, week or month; defaults to week."
			},
			maxPeriods: {
				type: "number",
				description: "Maximum retention periods; defaults to 12."
			}
		},
		output: growthOutput(config.maxResultChars),
		async execute(args, exec) {
			await ensureInsideRoot(fs, config, args.sourcePath, exec.signal);
			const dataset = await readDataset(fs, config, args.sourcePath, exec.signal);
			const result = analyzeCohorts(args.sourcePath, dataset.rows, {
				cohortEvent: args.cohortEvent,
				retentionEvent: args.retentionEvent,
				userField: args.userField?.trim() || "user_id",
				eventField: args.eventField?.trim() || "event",
				timeField: args.timeField?.trim() || "timestamp",
				interval: validInterval(args.interval),
				maxPeriods: validMaxPeriods(args.maxPeriods),
				timezone: config.defaultTimezone
			});
			result.warnings.push(...dataset.warnings);
			return wrapResult(result, { lineage: [{
				source: args.sourcePath,
				fields: [
					args.userField?.trim() || "user_id",
					args.eventField?.trim() || "event",
					args.timeField?.trim() || "timestamp"
				],
				window: { timezone: config.defaultTimezone }
			}] });
		}
	}));
	ctx.tools.register(defineTool({
		name: "growth_economics",
		description: "Calculate MRR bridge, ARR, ARPA, churn, NRR, CAC, LTV and payback from period movement rows.",
		parameters: {
			sourcePath: {
				type: "string",
				required: true,
				description: "CSV, JSON or JSONL MRR/cost dataset path."
			},
			periodField: {
				type: "string",
				description: "Period field; defaults to period."
			},
			typeField: {
				type: "string",
				description: "Movement type field; defaults to type."
			},
			amountField: {
				type: "string",
				description: "MRR movement amount field; defaults to amount."
			},
			customerField: {
				type: "string",
				description: "Customer ID field; defaults to customer_id."
			},
			spendField: {
				type: "string",
				description: "Acquisition spend field; defaults to spend."
			},
			currency: {
				type: "string",
				description: "Currency code; defaults to configured currency."
			},
			grossMargin: {
				type: "number",
				description: "Gross margin ratio, such as 0.8. Omit to use 1.0 with a warning."
			},
			amountMode: {
				type: "string",
				description: "absolute treats contraction/churn as magnitudes; signed expects input signs to carry the direction."
			},
			movementSource: {
				type: "string",
				description: "movement for bridge rows; snapshot for ending-MRR snapshots."
			},
			beginningMrr: {
				type: "number",
				description: "Optional beginning MRR before the first supplied period."
			},
			beginningCustomers: {
				type: "number",
				description: "Optional beginning customer count."
			}
		},
		output: growthOutput(config.maxResultChars),
		async execute(args, exec) {
			await ensureInsideRoot(fs, config, args.sourcePath, exec.signal);
			const dataset = await readDataset(fs, config, args.sourcePath, exec.signal);
			const result = analyzeEconomics(args.sourcePath, dataset.rows, {
				periodField: args.periodField?.trim() || "period",
				typeField: args.typeField?.trim() || "type",
				amountField: args.amountField?.trim() || "amount",
				customerField: args.customerField?.trim() || "customer_id",
				spendField: args.spendField?.trim() || "spend",
				currency: args.currency?.trim() || config.defaultCurrency,
				grossMargin: validGrossMargin(args.grossMargin),
				amountMode: validAmountMode(args.amountMode),
				movementSource: validMovementSource(args.movementSource),
				beginningMrr: args.beginningMrr,
				beginningCustomers: args.beginningCustomers
			});
			if (args.grossMargin === void 0) result.warnings.push("grossMargin was not supplied; LTV uses a 100% gross-margin assumption");
			result.warnings.push(...dataset.warnings);
			return wrapResult(result, {
				lineage: [{
					source: args.sourcePath,
					fields: [
						args.periodField?.trim() || "period",
						args.typeField?.trim() || "type",
						args.amountField?.trim() || "amount"
					]
				}],
				assumptions: [
					args.grossMargin === void 0 ? "grossMargin defaults to 1.0 when omitted." : `grossMargin=${args.grossMargin}`,
					`amountMode=${validAmountMode(args.amountMode)}`,
					`movementSource=${validMovementSource(args.movementSource)}`
				]
			});
		}
	}));
	ctx.tools.register(defineTool({
		name: "growth_diagnose",
		description: "Diagnose a metric change using evidence, stage context and explicit data gaps. It does not claim causality without supporting data.",
		parameters: {
			metric: {
				type: "string",
				required: true,
				description: "Metric name."
			},
			current: {
				type: "number",
				required: true,
				description: "Current metric value."
			},
			previous: {
				type: "number",
				required: true,
				description: "Previous or baseline metric value."
			},
			stage: {
				type: "string",
				description: "AARRR stage, such as retention or revenue."
			},
			context: {
				type: "string",
				description: "Optional context about product, channel or recent changes."
			},
			path: {
				type: "string",
				description: "Optional growth Markdown note to audit for metric quality."
			}
		},
		output: growthOutput(config.maxResultChars),
		async execute(args, exec) {
			let audit;
			if (args.path?.trim()) {
				await ensureInsideRoot(fs, config, args.path, exec.signal);
				audit = auditGrowthNote(await readNote(fs, args.path, config, exec.signal));
			}
			return wrapResult(diagnoseGrowth({
				metric: args.metric,
				current: args.current,
				previous: args.previous,
				stage: args.stage,
				context: args.context,
				audit
			}), { lineage: args.path ? [{ source: args.path }] : [] });
		}
	}));
	ctx.tools.register(defineTool({
		name: "growth_experiment",
		description: "Create a HADI growth experiment card with primary metric, guardrails, instrumentation and optional RICE/ICE score.",
		parameters: {
			title: {
				type: "string",
				required: true,
				description: "Experiment title."
			},
			problem: {
				type: "string",
				required: true,
				description: "Observed growth problem."
			},
			hypothesis: {
				type: "string",
				required: true,
				description: "Falsifiable if/then hypothesis."
			},
			stage: {
				type: "string",
				required: true,
				description: "acquisition, activation, retention, referral or revenue."
			},
			targetMetric: {
				type: "string",
				required: true,
				description: "Primary metric."
			},
			guardrails: {
				type: "string",
				description: "Comma-separated guardrail metrics."
			},
			owner: {
				type: "string",
				description: "Experiment owner."
			},
			audience: {
				type: "string",
				description: "Target audience or segment."
			},
			durationDays: {
				type: "number",
				description: "Experiment duration; defaults to 14."
			},
			reach: {
				type: "number",
				description: "RICE reach estimate."
			},
			impact: {
				type: "number",
				description: "RICE/ICE impact estimate."
			},
			confidence: {
				type: "number",
				description: "RICE/ICE confidence ratio, such as 0.8."
			},
			effort: {
				type: "number",
				description: "RICE effort estimate."
			},
			ease: {
				type: "number",
				description: "ICE ease estimate."
			},
			method: {
				type: "string",
				description: "rice or ice; defaults to rice."
			}
		},
		output: growthOutput(config.maxResultChars),
		async execute(args) {
			const method = validMethod(args.method);
			return wrapResult(createExperiment({
				title: args.title,
				problem: args.problem,
				hypothesis: args.hypothesis,
				stage: validStage(args.stage),
				targetMetric: args.targetMetric,
				guardrails: parseGuardrails(args.guardrails),
				owner: args.owner,
				audience: args.audience,
				durationDays: args.durationDays,
				reach: args.reach,
				impact: args.impact,
				confidence: args.confidence,
				effort: args.effort,
				ease: args.ease,
				method
			}), { nextActions: ["Record the experiment owner, launch date, decision date and instrumentation before starting."] });
		}
	}));
	ctx.tools.register(defineTool({
		name: "growth_prioritize",
		description: "Rank growth opportunities using RICE or ICE from a JSON array of scored opportunity objects.",
		parameters: { items: {
			type: "string",
			required: true,
			description: "JSON array with title, method, reach, impact, confidence, effort/ease, evidence and targetMetric."
		} },
		output: growthOutput(config.maxResultChars),
		async execute(args) {
			const items = priorityItems(args.items).toSorted((left, right) => (right.score ?? -1) - (left.score ?? -1)).map((item, index) => ({
				rank: index + 1,
				...item
			}));
			return wrapResult({
				generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
				items,
				warnings: items.some((item) => item.score === null) ? ["Some items lack enough inputs for a numeric priority score"] : []
			}, { nextActions: ["Validate the evidence and target metric for the top-ranked opportunity before committing delivery capacity."] });
		}
	}));
	ctx.tools.register(defineTool({
		name: "growth_report",
		description: "Generate a WBR, MBR, QBR or experiment-review Markdown report from explicit metrics, findings, experiments and actions.",
		parameters: {
			title: {
				type: "string",
				required: true,
				description: "Report title."
			},
			reportType: {
				type: "string",
				description: "wbr, mbr, qbr or experiment-review."
			},
			period: {
				type: "string",
				required: true,
				description: "Report period."
			},
			summary: {
				type: "string",
				description: "Answer-first summary; optional when reviewJson is supplied."
			},
			reviewJson: {
				type: "string",
				description: "Optional JSON from growth_review; automatically maps analyses, findings, caveats and sources into the report."
			},
			metrics: {
				type: "string",
				description: "JSON array of metric rows with name/current/previous/delta/source."
			},
			findings: {
				type: "string",
				description: "Newline-separated findings."
			},
			experiments: {
				type: "string",
				description: "Newline-separated experiments or decisions."
			},
			nextActions: {
				type: "string",
				description: "Newline-separated next actions."
			},
			caveats: {
				type: "string",
				description: "Newline-separated caveats."
			}
		},
		output: growthOutput(config.maxResultChars),
		async execute(args) {
			const review = args.reviewJson ? reportInputFromReview(args.reviewJson) : void 0;
			const metrics = review?.metrics ?? (args.metrics ? JSON.parse(args.metrics) : []);
			const report = renderReport({
				title: args.title,
				reportType: validReportType(args.reportType),
				period: args.period,
				summary: args.summary ?? review?.summary ?? "",
				metrics,
				findings: review?.findings ?? parseList(args.findings?.replace(/\n/g, ",")),
				experiments: review?.experiments ?? parseList(args.experiments?.replace(/\n/g, ",")),
				nextActions: review?.nextActions ?? parseList(args.nextActions?.replace(/\n/g, ",")),
				caveats: review?.caveats ?? parseList(args.caveats?.replace(/\n/g, ","))
			});
			ctx.emit("growth/report-previewed", { sourceCount: review?.sources.length ?? 0 });
			return wrapResult(report, {
				assumptions: [review ? "The report was assembled from the supplied growth_review result; it does not infer causality." : "The report uses only the explicitly supplied metrics and findings; it does not infer causality."],
				lineage: review?.sources.map((source) => ({ source })) ?? []
			});
		}
	}));
	ctx.tools.register(defineTool({
		name: "growth_apply",
		description: "Preview or apply a complete Markdown replacement under defaultRoot using a stale-version guard. Set confirm=true only after explicit approval.",
		parameters: {
			path: {
				type: "string",
				required: true,
				description: "Markdown file to update."
			},
			content: {
				type: "string",
				required: true,
				description: "Complete replacement Markdown content."
			},
			confirm: {
				type: "boolean",
				required: true,
				description: "false previews only; true applies the guarded write."
			}
		},
		output: growthOutput(config.maxResultChars),
		async execute(args, exec) {
			await ensureInsideRoot(fs, config, args.path, exec.signal);
			if (args.content.length > config.maxTextChars) throw new Error(`Replacement exceeds maxTextChars (${config.maxTextChars})`);
			const target = await fs.resolve(args.path, { signal: exec.signal });
			const info = await fs.stat(target, exec.signal);
			if (!info || info.type !== "file") throw new Error(`File not found: ${args.path}`);
			const current = await fs.readText(target, exec.signal);
			if (!args.confirm) {
				ctx.emit("growth/report-previewed", {
					path: args.path,
					sourceCount: 1
				});
				return wrapResult({
					status: "preview-only",
					path: args.path,
					changed: args.content !== current,
					applied: false,
					title: parseNote(args.path, args.content).title,
					diff: replacementDiff(current, args.content)
				}, { nextActions: ["Review the proposed replacement and call again with confirm=true only after explicit approval."] });
			}
			await fs.writeText(target, args.content, {
				kind: "replaceIfVersion",
				version: info.version
			}, exec.signal);
			ctx.emit("growth/report-applied", { path: args.path });
			return wrapResult({
				status: "applied",
				path: args.path,
				changed: args.content !== current,
				applied: true,
				guarded: true
			}, { lineage: [{ source: args.path }] });
		}
	}));
	ctx.logger.info(`[dsh-growth] registered growth tools for ${config.defaultRoot}`);
}

//#endregion
//#region src/index.ts
const name = "dsh-growth";
const inject = ["tools", "fs"];
const Config = Schema.object({
	defaultRoot: Schema.string().default("D:\\ObsidianData"),
	reportDir: Schema.string().default(".dsh-growth/reports"),
	maxFiles: Schema.number().default(500),
	maxRows: Schema.number().default(1e5),
	maxFileBytes: Schema.number().default(1048576),
	maxTextChars: Schema.number().default(18e4),
	maxResultChars: Schema.number().default(5e4),
	defaultCurrency: Schema.string().default("CNY"),
	defaultTimezone: Schema.string().default("Asia/Shanghai")
});
function apply(ctx, config) {
	const fs = ctx.fs;
	new GrowthDataService(ctx, fs, config);
	registerGrowthTools(ctx, config);
}

//#endregion
export { Config, apply, inject, name };