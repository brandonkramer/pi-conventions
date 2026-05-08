/** @fileoverview Glob pattern compilation and path matching. */
import { normalizeRelativePath } from "./path.ts";

export interface PathPattern {
	source: string;
	matches: (relativePath: string) => boolean;
}

export function compilePathPatterns(paths: string[]): PathPattern[] {
	return paths.map((source) => ({
		source,
		matches: compilePathMatcher(source),
	}));
}

export function compileSpecifierPatterns(specifiers: string[]): PathPattern[] {
	return specifiers.map((source) => ({
		source,
		matches: compileSpecifierMatcher(source),
	}));
}

function compileSpecifierMatcher(
	pattern: string,
): (specifier: string) => boolean {
	if (!hasGlobSyntax(pattern)) {
		return (specifier) => specifier === pattern;
	}
	const regex = globToRegExp(pattern);
	return (specifier) => regex.test(specifier);
}

export function matchesAnyPathPattern(
	relativePath: string,
	patterns: PathPattern[],
): boolean {
	return patterns.some((pattern) => pattern.matches(relativePath));
}

function compilePathMatcher(
	pattern: string,
): (relativePath: string) => boolean {
	const normalized = normalizeRelativePath(pattern);
	if (normalized.endsWith("/") && !hasGlobSyntax(normalized)) {
		return (relativePath) => relativePath.startsWith(normalized);
	}
	if (!hasGlobSyntax(normalized)) {
		return (relativePath) => relativePath === normalized;
	}
	const regex = globToRegExp(normalized);
	return (relativePath) => regex.test(relativePath);
}

function globToRegExp(pattern: string): RegExp {
	let source = "^";
	for (let index = 0; index < pattern.length; index += 1) {
		const char = pattern[index];
		const next = pattern[index + 1];
		if (char === "*" && next === "*") {
			source += ".*";
			index += 1;
		} else if (char === "*") {
			source += "[^/]*";
		} else if (char === "{") {
			const close = pattern.indexOf("}", index + 1);
			if (close > index) {
				const options = pattern
					.slice(index + 1, close)
					.split(",")
					.map(escapeRegExp)
					.join("|");
				source += `(?:${options})`;
				index = close;
			} else {
				source += escapeRegExp(char);
			}
		} else {
			source += escapeRegExp(char);
		}
	}
	return new RegExp(`${source}$`);
}

function hasGlobSyntax(pattern: string): boolean {
	return /[*{}]/.test(pattern);
}

function escapeRegExp(value: string): string {
	return value.replace(/[\\^$+?.()|[\]]/g, "\\$&");
}
