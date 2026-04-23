// Rspack plugin that filters the bundled `GRAMMARS` and `THEMES` maps down
// to user-specified allow/deny lists. `@discord/arborium-rt` ships every
// supported language + every bundled theme in two eager objects — which is
// convenient for the consumer but causes rspack to statically trace and
// emit every `.wasm`/`.scm`/`.css` asset even when the consumer never
// references those entries. This plugin installs a loader that rewrites
// `dist/grammars.js` / `dist/themes.js` source before rspack parses it,
// dropping entries the consumer doesn't want.

import { fileURLToPath } from 'node:url';

import type { Compiler } from '@rspack/core';

export interface AllowDenyFilter {
    /**
     * Ids to keep. If provided, any id NOT in this list is stripped.
     * Unknown ids are ignored (no-op rather than error).
     */
    readonly allow?: readonly string[];
    /**
     * Ids to remove. Applied after `allow`, so an id in both lists ends
     * up denied. Useful for "everything except X, Y, Z".
     */
    readonly deny?: readonly string[];
}

export interface ArboriumRtRspackPluginOptions extends AllowDenyFilter {
    /**
     * Filter for the bundled `THEMES` map. Left unset, every theme's CSS
     * asset is emitted (~140 KB total) because rspack traces the `new
     * URL(...)` references in the generated module. Set `themes.allow` to
     * a short list to shrink the output to just the themes you actually
     * render.
     */
    readonly themes?: AllowDenyFilter;
}

/**
 * Matches the compiled grammars / themes modules. Works against both the
 * installed path (`node_modules/@discord/arborium-rt/dist/<name>.js`) and
 * the workspace realpath (`packages/arborium-rt/dist/<name>.js`) that
 * rspack sees after it resolves pnpm's symlinks.
 */
const GRAMMARS_JS_RE = /[\\/]arborium-rt[\\/]dist[\\/]grammars\.js$/;
const THEMES_JS_RE = /[\\/]arborium-rt[\\/]dist[\\/]themes\.js$/;

const LOADER_PATH = fileURLToPath(new URL('./loader.js', import.meta.url));

export class ArboriumRtRspackPlugin {
    private readonly options: ArboriumRtRspackPluginOptions;

    constructor(options: ArboriumRtRspackPluginOptions = {}) {
        this.options = options;
    }

    apply(compiler: Compiler): void {
        const { allow, deny, themes } = this.options;
        if (allow || deny) {
            compiler.options.module.rules.push({
                test: GRAMMARS_JS_RE,
                use: [{ loader: LOADER_PATH, options: { allow, deny } }],
            });
        }
        if (themes?.allow || themes?.deny) {
            compiler.options.module.rules.push({
                test: THEMES_JS_RE,
                use: [{ loader: LOADER_PATH, options: themes }],
            });
        }
    }
}

export default ArboriumRtRspackPlugin;
