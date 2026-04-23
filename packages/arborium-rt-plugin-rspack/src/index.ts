// Rspack plugin that filters the bundled `GRAMMARS` map down to a
// user-specified allow/deny list. `@discord/arborium-rt` ships every
// supported language in one eager object — which is convenient for the
// consumer but causes rspack to statically trace and emit every
// `.wasm`/`.scm` asset. This plugin installs a loader that rewrites
// the single `dist/grammars.js` module's source before rspack parses
// it, dropping entries the consumer doesn't want so the resulting
// chunk only references the languages that survive.

import { fileURLToPath } from 'node:url';

import type { Compiler } from '@rspack/core';

export interface ArboriumRtRspackPluginOptions {
    /**
     * Language ids to keep. If provided, any language id NOT in this list
     * is stripped. Unknown ids are ignored (no-op rather than error —
     * misspellings just don't add anything).
     */
    readonly allow?: readonly string[];
    /**
     * Language ids to remove. Applied after `allow`, so an id in both
     * lists ends up denied. Useful for "everything except X, Y, Z".
     */
    readonly deny?: readonly string[];
}

/**
 * Matches the compiled grammars module. Works against both the
 * installed path (`node_modules/@discord/arborium-rt/dist/grammars.js`)
 * and the workspace realpath (`packages/arborium-rt/dist/grammars.js`)
 * that rspack sees after it resolves pnpm's symlinks.
 */
const GRAMMARS_JS_RE = /[\\/]arborium-rt[\\/]dist[\\/]grammars\.js$/;

const LOADER_PATH = fileURLToPath(new URL('./loader.js', import.meta.url));

export class ArboriumRtRspackPlugin {
    private readonly options: ArboriumRtRspackPluginOptions;

    constructor(options: ArboriumRtRspackPluginOptions = {}) {
        this.options = options;
    }

    apply(compiler: Compiler): void {
        if (!this.options.allow && !this.options.deny) return;
        compiler.options.module.rules.push({
            test: GRAMMARS_JS_RE,
            use: [{ loader: LOADER_PATH, options: this.options }],
        });
    }
}

export default ArboriumRtRspackPlugin;
