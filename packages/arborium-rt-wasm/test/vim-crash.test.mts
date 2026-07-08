import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { loadArboriumRuntime } from "../dist/index.js";

// Regression: the vim external scanner's SEP_FIRST branch calls `iswpunct`,
// which upstream's stdlib-symbols.txt omits from the host's libc exports (it
// ships the rest of the isw* family). So the vim SIDE_MODULE's `iswpunct`
// import resolved to `undefined` on the wasm host, and the parser trapped in
// the native stack the first time it reached that scanner state — which is any
// time a command-position token starts with a punctuation character. A bare
// "[" is the whole reproducer; real reports came from pasting non-vim log text
// (e.g. Maven build errors full of "[ERROR]").
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const VIM_WASM = `${REPO_ROOT}target/grammars/vim/tree-sitter-vim.wasm`;
const VIM_HIGHLIGHTS = `${REPO_ROOT}target/grammars/vim/highlights.scm`;

const PAYLOAD = "[";

it("highlights punctuation-led text as vim without crashing", async () => {
	const [wasm, highlights] = await Promise.all([
		readFile(VIM_WASM),
		readFile(VIM_HIGHLIGHTS, "utf8"),
	]);

	const runtime = await loadArboriumRuntime();
	const grammar = await runtime.loadGrammar({
		languageId: "vim",
		languageExport: "tree_sitter_vim",
		wasm,
		highlights,
	});
	const session = grammar.createSession();
	try {
		session.setText(PAYLOAD);
		const result = session.highlightToSpans();
		expect(Array.isArray(result.spans)).toBe(true);
	} finally {
		session.free();
		grammar.unregister();
	}
});
