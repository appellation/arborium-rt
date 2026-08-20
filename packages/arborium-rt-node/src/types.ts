// Public types for @discord/arborium-rt-node. Kept structurally identical to
// @discord/arborium-rt's user-facing API (ThemedSpan, HighlightSpansResult,
// HighlightHtmlResult, HtmlFormat, HighlightOptions) so the two packages are
// interchangeable for highlighting — the only difference is that this package
// links every grammar statically, so there is no async grammar loading.

/**
 * A themed span emitted by the full highlight pipeline (parse + injection
 * resolution + dedup + coalesce). Offsets are UTF-16 code units; the `tag`
 * is the short theme slot string (`"k"`, `"f"`, `"s"`, …) matching the
 * default `custom-elements` HTML format.
 */
export interface ThemedSpan {
	start: number;
	end: number;
	tag: string;
}

/** A raw highlight-query capture span (UTF-16 offsets, not themed). */
export interface ParseSpan {
	start: number;
	end: number;
	/** Capture name from highlights.scm (e.g. "keyword", "string", "number"). */
	capture: string;
	/** Pattern index from the query; higher = later rule = higher priority. */
	patternIndex: number;
}

/** A language-injection point discovered during the primary parse. */
export interface ParseInjection {
	start: number;
	end: number;
	/** Injected language ID (e.g. "javascript" inside HTML). */
	language: string;
	includeChildren: boolean;
}

/** Raw parse result: the primary grammar's captures + injection points. */
export interface ParseResult {
	spans: ParseSpan[];
	injections: ParseInjection[];
	/**
	 * Query fuel this parse consumed. Fuel models the work tree-sitter's
	 * query cursor did — operations weighted by how many candidate matches
	 * each one had to touch — in place of wall-clock time, so a given
	 * (query, tree) pair always costs the same, on any machine. Charged in
	 * blocks of 100 cursor operations, so a document too small to reach the
	 * first block reports 0.
	 */
	fuelUsed: number;
	/**
	 * `true` if the fuel allotted to this parse ran out before the
	 * QueryCursor finished. `spans` then holds partial output.
	 */
	outOfFuel: boolean;
}

export interface HighlightOptions {
	/**
	 * How deep to follow language injections. `0` disables recursion — only
	 * the primary grammar's captures are considered. The runtime caps this at
	 * 32 internally. Defaults to `3`.
	 */
	maxInjectionDepth?: number;
}

/** Options for HTML highlighting. Adds an output-format selector. */
export interface HighlightToHtmlOptions extends HighlightOptions {
	/** HTML markup style. Defaults to `{ kind: 'custom-elements' }`. */
	format?: HtmlFormat;
}

/** Result from `highlightToSpans`, including any missing injection grammars. */
export interface HighlightSpansResult {
	spans: ThemedSpan[];
	/** Languages referenced by injections but not bundled in this addon. */
	missingInjections: string[];
	/**
	 * Language names whose highlighting is incomplete because the call ran
	 * out of query fuel — a fixed allowance of tree-sitter query-cursor
	 * operations shared by the primary parse and every injected sub-parse.
	 * Empty when the whole document fit in budget. Sorted, deduplicated.
	 */
	outOfFuelLanguages: string[];
	/**
	 * Query fuel this call consumed across every parse it ran. Deterministic
	 * for a given document, so it doubles as a cost metric.
	 */
	fuelUsed: number;
}

/** Result from `highlightToHtml`, including any missing injection grammars. */
export interface HighlightHtmlResult {
	html: string;
	missingInjections: string[];
	outOfFuelLanguages: string[];
	fuelUsed: number;
}

/**
 * Output format for HTML highlighting. Mirrors `arborium_highlight::HtmlFormat`.
 *
 * - `custom-elements`: `<a-k>keyword</a-k>` — default, most compact.
 * - `custom-elements-with-prefix`: `<code-k>keyword</code-k>`.
 * - `class-names`: `<span class="keyword">keyword</span>`.
 * - `class-names-with-prefix`: `<span class="arb-keyword">…</span>`.
 */
export type HtmlFormat =
	| { kind: "custom-elements" }
	| { kind: "custom-elements-with-prefix"; prefix: string }
	| { kind: "class-names" }
	| { kind: "class-names-with-prefix"; prefix: string };
