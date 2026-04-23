// Source-level loader that strips entries out of the `GRAMMARS` object
// literal. Runs against `@discord/arborium-rt/dist/grammars.js`, whose
// format is tightly controlled by the arborium-rt CLI's
// `write-grammars-index.ts` generator — each entry is a 7-line block
// starting with `    "<id>": {` and ending with `    },`, and there's
// nothing else inside the outer `{ … }` that could confuse the regex.

import type { LoaderContext } from '@rspack/core';

import type { ArboriumRtRspackPluginOptions } from './index.js';

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
    this: LoaderContext<ArboriumRtRspackPluginOptions>,
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
    logger?.info(`filtered GRAMMARS: kept ${kept}, dropped ${dropped}`);

    return result;
}
