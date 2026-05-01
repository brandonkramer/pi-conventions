import { readFile } from "node:fs/promises";

export interface MutationContentInput {
	content?: unknown;
	oldText?: unknown;
	newText?: unknown;
	edits?: unknown;
}

export async function derivePostMutationContent(
	input: MutationContentInput,
	absolutePath: string,
	isWrite: boolean,
): Promise<string | undefined> {
	if (isWrite) {
		return typeof input.content === "string" ? input.content : undefined;
	}

	const edits = normalizeEditInputs(input);
	if (edits.length === 0) {
		return undefined;
	}

	try {
		const currentContent = await readFile(absolutePath, "utf8");
		return applyExactEdits(currentContent, edits);
	} catch {
		return undefined;
	}
}

function normalizeEditInputs(
	input: MutationContentInput,
): Array<{ oldText: string; newText: string }> {
	if (typeof input.oldText === "string" && typeof input.newText === "string") {
		return [{ oldText: input.oldText, newText: input.newText }];
	}
	if (!Array.isArray(input.edits)) {
		return [];
	}
	const edits: Array<{ oldText: string; newText: string }> = [];
	for (const edit of input.edits) {
		if (
			typeof edit?.oldText !== "string" ||
			typeof edit?.newText !== "string"
		) {
			return [];
		}
		edits.push({ oldText: edit.oldText, newText: edit.newText });
	}
	return edits;
}

function applyExactEdits(
	content: string,
	edits: Array<{ oldText: string; newText: string }>,
): string | undefined {
	const ranges: Array<{ start: number; end: number; newText: string }> = [];
	for (const edit of edits) {
		const start = content.indexOf(edit.oldText);
		if (
			start === -1 ||
			content.indexOf(edit.oldText, start + edit.oldText.length) !== -1
		) {
			return undefined;
		}
		ranges.push({
			start,
			end: start + edit.oldText.length,
			newText: edit.newText,
		});
	}

	ranges.sort((left, right) => left.start - right.start);
	for (let index = 1; index < ranges.length; index += 1) {
		if (ranges[index].start < ranges[index - 1].end) {
			return undefined;
		}
	}

	let result = content;
	for (const range of ranges.reverse()) {
		result = `${result.slice(0, range.start)}${range.newText}${result.slice(range.end)}`;
	}
	return result;
}
