import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { globSync } from "glob";

// Measure source code complexity (exclude tests, benchmarks, node_modules)
const files = globSync("src/**/*.ts");

let totalLoc = 0;
let functionCount = 0;
let maxFunctionLoc = 0;
let currentFunctionLoc = 0;
let inFunction = false;

for (const file of files) {
	const content = readFileSync(file, "utf8");
	const lines = content.split("\n");

	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed === "" || trimmed.startsWith("//") || trimmed.startsWith("*")) {
			continue;
		}
		totalLoc++;

		// Rough function detection: lines starting with function/const/export function/etc
		if (/^(export\s+)?(async\s+)?function\s+\w+/.test(trimmed) ||
			/^const\s+\w+\s*=/.test(trimmed) ||
			/^(export\s+)?default\s+function/.test(trimmed)) {
			if (inFunction && currentFunctionLoc > 0) {
				functionCount++;
				maxFunctionLoc = Math.max(maxFunctionLoc, currentFunctionLoc);
			}
			inFunction = true;
			currentFunctionLoc = 0;
		}

		if (inFunction) {
			currentFunctionLoc++;
		}

		// End of function: closing brace at start of line (heuristic)
		if (trimmed === "}" && inFunction && currentFunctionLoc > 1) {
			inFunction = false;
			functionCount++;
			maxFunctionLoc = Math.max(maxFunctionLoc, currentFunctionLoc);
			currentFunctionLoc = 0;
		}
	}
}

// Also count files
const fileCount = files.length;

console.log(`METRIC total_loc=${totalLoc}`);
console.log(`METRIC function_count=${functionCount}`);
console.log(`METRIC max_function_loc=${maxFunctionLoc}`);
console.log(`METRIC file_count=${fileCount}`);
console.log(`---`);
console.log(`files=${fileCount}`);
