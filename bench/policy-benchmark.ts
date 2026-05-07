import { performance } from "node:perf_hooks";

// Import the policies to benchmark
import {
	normalizeDocumentationPolicy,
	evaluateDocumentationViolation,
} from "../src/policies/documentation.ts";
import { compilePathPatterns, matchesAnyPathPattern } from "../src/core/pattern.ts";
import { normalizeRelativePath } from "../src/core/path.ts";
import { uniqueStrings } from "../src/core/strings.ts";
import { extractCommentLines, extractComments, findLeadingBlockComment } from "../src/policies/documentation-comments.ts";

// Build a realistic config with all documentation rule types
const config = normalizeDocumentationPolicy({
	mode: "warn",
	editMode: "warn",
	rules: [
		{
			kind: "requireTsdocOnExports",
			paths: ["src/**/*.ts"],
			declarations: ["interface", "type", "function", "class", "const"],
			requireRemarks: true,
		},
		{
			kind: "requireFileOverview",
			paths: ["src/**/*.ts"],
			requiredTags: ["@fileoverview"],
			requiredSections: ["Design:"],
		},
		{
			kind: "forbidFileHeaders",
			paths: ["src/**"],
			patterns: ["copyright", "licensed under", "spdx-license-identifier"],
		},
		{
			kind: "forbidCommentPatterns",
			paths: ["src/**"],
			patterns: ["PR #", "ticket"],
		},
		{
			kind: "todoFormat",
			paths: ["src/**"],
			allowedTags: ["TODO", "FIXME"],
			format: "TAG: concrete action - referent",
		},
		{
			kind: "requireRationaleComments",
			paths: ["src/http/*.ts"],
			commentKeywords: ["SSRF", "security", "invariant", "because", "must"],
			minMatches: 1,
		},
	],
});

if (!config) {
	throw new Error("Failed to normalize config");
}

// Generate synthetic file contents at different sizes
function generateSmallFile(): string {
	return `/**\n * @fileoverview Small module.\n * Design: Simple fetch wrapper.\n */\nexport interface Options { url: string; }\nexport async function fetch(url: string): Promise<string> {\n  // TODO: add retry backoff - see http/retry.ts\n  return "ok";\n}\n`;
}

function generateMediumFile(): string {
	let out = `/**\n * @fileoverview Medium module with many exports.\n * Design: Pipeline orchestration.\n */\n\n`;
	for (let i = 0; i < 50; i++) {
		out += `/**\n * Helper ${i}.\n * @remarks Handles edge case ${i}.\n */\nexport function helper${i}(x: number): number {\n  return x + ${i};\n}\n\n`;
	}
	out += `// FIXME: validate input boundaries - see validation.ts\nexport const MAX = 1000;\n`;
	return out;
}

function generateLargeFile(): string {
	let out = `/**\n * @fileoverview Large module.\n * Design: Complex orchestration layer.\n */\n\n`;
	for (let i = 0; i < 300; i++) {
		out += `/**\n * Process ${i}.\n * @remarks Pipeline optimized for cache locality.\n * Performance: ~7ms for 100KB.\n */\nexport async function process${i}(input: string[]): Promise<string[]> {\n  const results: string[] = [];\n  for (const item of input) {\n    results.push(item.toUpperCase());\n  }\n  return results;\n}\n\n`;
	}
	return out;
}

function time<T>(fn: () => T, runs = 1000): { result: T; medianMs: number } {
	const times: number[] = [];
	let result: T;
	for (let i = 0; i < runs; i++) {
		const start = performance.now();
		result = fn();
		const end = performance.now();
		times.push(end - start);
	}
	times.sort((a, b) => a - b);
	const median = times[Math.floor(times.length / 2)];
	return { result: result!, medianMs: median };
}

function timeOnce<T>(fn: () => T): { result: T; ms: number } {
	const start = performance.now();
	const result = fn();
	const end = performance.now();
	return { result, ms: end - start };
}

// --- Benchmarks ---

const small = generateSmallFile();
const medium = generateMediumFile();
const large = generateLargeFile();

// 1. Config normalization (one-time cost per session)
const normTime = timeOnce(() =>
	normalizeDocumentationPolicy({
		mode: "warn",
		rules: [
			{ kind: "requireTsdocOnExports", paths: ["src/**/*.ts"], declarations: ["interface", "type", "function", "class", "const"], requireRemarks: true },
			{ kind: "requireFileOverview", paths: ["src/**/*.ts"], requiredTags: ["@fileoverview"], requiredSections: ["Design:"] },
			{ kind: "forbidFileHeaders", paths: ["src/**"], patterns: ["copyright", "licensed under", "spdx-license-identifier"] },
			{ kind: "forbidCommentPatterns", paths: ["src/**"], patterns: ["PR #", "ticket"] },
			{ kind: "todoFormat", paths: ["src/**"], allowedTags: ["TODO", "FIXME"], format: "TAG: concrete action - referent" },
			{ kind: "requireRationaleComments", paths: ["src/http/*.ts"], commentKeywords: ["SSRF", "security", "invariant", "because", "must"], minMatches: 1 },
		],
	}),
);

// 2. Full violation evaluation (hot path on every write/edit)
const smallEval = time(() => evaluateDocumentationViolation("src/fetch.ts", true, small, config!), 1000);
const mediumEval = time(() => evaluateDocumentationViolation("src/pipeline.ts", true, medium, config!), 500);
const largeEval = time(() => evaluateDocumentationViolation("src/orchestrator.ts", true, large, config!), 100);

// 3. Individual parser components
const commentLinesBench = time(() => extractCommentLines(medium), 1000);
const commentsBench = time(() => extractComments(medium), 1000);
const overviewBench = time(() => findLeadingBlockComment(medium), 1000);

// 4. Path pattern compilation + matching
const patterns = compilePathPatterns(["src/**/*.ts", "src/http/*.ts", "src/tools/{define,result,progress}.ts"]);
const pathMatchBench = time(() => matchesAnyPathPattern("src/http/client.ts", patterns), 10000);

// 5. String utilities
const strsBench = time(() => uniqueStrings(["a", "b", "a", "c", "b", "d"], (s) => s), 10000);
const normPathBench = time(() => normalizeRelativePath("./src//foo/../bar.ts"), 10000);

// Output
console.log(`METRIC norm_ms=${(normTime.ms * 1000).toFixed(1)}`);
console.log(`METRIC eval_small_us=${(smallEval.medianMs * 1000).toFixed(1)}`);
console.log(`METRIC eval_medium_us=${(mediumEval.medianMs * 1000).toFixed(1)}`);
console.log(`METRIC eval_large_us=${(largeEval.medianMs * 1000).toFixed(1)}`);
console.log(`METRIC extract_comment_lines_us=${(commentLinesBench.medianMs * 1000).toFixed(1)}`);
console.log(`METRIC extract_comments_us=${(commentsBench.medianMs * 1000).toFixed(1)}`);
console.log(`METRIC find_overview_us=${(overviewBench.medianMs * 1000).toFixed(1)}`);
console.log(`METRIC path_match_us=${(pathMatchBench.medianMs * 1000).toFixed(1)}`);
console.log(`METRIC unique_strings_us=${(strsBench.medianMs * 1000).toFixed(1)}`);
console.log(`METRIC norm_path_us=${(normPathBench.medianMs * 1000).toFixed(1)}`);
console.log(`---`);
console.log(`file_sizes chars small=${small.length} medium=${medium.length} large=${large.length}`);
