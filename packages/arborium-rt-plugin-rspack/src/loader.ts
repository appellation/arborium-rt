// Source-level loader that strips entries out of an eagerly-rendered
// id-keyed object literal. Runs against `@discord/arborium-rt/dist/
// grammars.js` (GRAMMARS) and `dist/themes.js` (THEMES), whose format is
// tightly controlled by the arborium-rt CLI's `write-grammars-index.ts` /
// `write-themes-index.ts` generators — each entry is an indented block
// starting with `    "<id>": {` and ending with `    },`, and there's
// nothing else inside the outer `{ … }` that could confuse the regex.
// A single loader serves both modules because the block shape is identical.

import type { LoaderContext } from '@rspack/core';

import type { AllowDenyFilter } from './index.js';

/**
 * Matches a single grammar entry:
 *
 *     "<id>": {
 *         languageId: "<id>",
 *         ...
 *     },
 *
 * Captures the id. Non-greedy body match, anchored to start-of-line via the
 * `m` flag so indented braces inside `new URL(...)` args can't false-match.
 */
const ENTRY_RE = /^    "([^"]+)": \{\n[\s\S]*?\n    \},\n/gm;

export default function arboriumRtLoader(
    this: LoaderContext<AllowDenyFilter>,
    source: string,
): string {
    const { allow, deny } = this.getOptions() ?? {};
    const allowSet = allow ? new Set(allow) : undefined;
    const denySet = deny ? new Set(deny) : undefined;
    if (!allowSet && !denySet) return source;

    let kept = 0;
    let dropped = 0;
    const result = source.replace(ENTRY_RE, (match, id: string) => {
        const rejected = (allowSet !== undefined && !allowSet.has(id))
            || (denySet !== undefined && denySet.has(id));
        if (rejected) {
            dropped++;
            return '';
        }
        kept++;
        return match;
    });

    const logger = this.getLogger?.('arborium-rt-plugin-rspack');
    logger?.info(`filtered entries: kept ${kept}, dropped ${dropped}`);

    return result;
}
