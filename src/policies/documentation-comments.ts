export interface CommentLine {
	line: number;
	text: string;
}

export interface LeadingBlockComment {
	line: number;
	text: string;
}

export function extractCommentLines(content: string): CommentLine[] {
	const result: CommentLine[] = [];
	const lines = content.split(/\r?\n/);
	for (let index = 0; index < lines.length; index += 1) {
		const match = /\/\/\s*(.*)|\/\*+\s*(.*?)\s*\*\//.exec(lines[index]);
		if (match) {
			result.push({ line: index + 1, text: match[1] ?? match[2] ?? "" });
		}
	}
	return result;
}

export function extractComments(content: string): string[] {
	const comments: string[] = [];
	for (const match of content.matchAll(/\/\/([^\n]*)|\/\*[\s\S]*?\*\//g)) {
		comments.push(match[1] ?? match[0]);
	}
	return comments;
}

export function findLeadingBlockComment(
	content: string,
): LeadingBlockComment | undefined {
	let pos = 0;
	if (content.startsWith("#!")) {
		const nl = content.indexOf("\n", pos);
		pos = nl === -1 ? content.length : nl + 1;
	}
	while (pos < content.length) {
		const c = content[pos];
		if (c === " " || c === "\t" || c === "\r" || c === "\n") {
			pos++;
		} else {
			break;
		}
	}
	if (!content.startsWith("/**", pos)) return undefined;

	const start = pos;
	const end = content.indexOf("*/", pos + 3);
	if (end === -1) return undefined;

	let line = 1;
	for (let i = 0; i < start; i++) {
		if (content[i] === "\n") line++;
	}
	return { line, text: content.slice(start, end + 2) };
}
