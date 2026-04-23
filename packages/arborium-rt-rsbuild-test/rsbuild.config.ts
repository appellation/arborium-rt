import { ArboriumRtRspackPlugin } from '@discord/arborium-rt-plugin-rspack';
import { defineConfig } from '@rsbuild/core';

// Minimal rsbuild config — build target is a browser bundle so we exercise
// the same rspack code path that broke before the fix (ENVIRONMENT=web,worker
// on the host mjs, GRAMMARS' URL-typed assets, etc.). The
// ArboriumRtRspackPlugin trims GRAMMARS down to the three languages this
// demo actually highlights; without it, rspack would emit every one of the
// ~100 bundled grammars (~160 MB of assets).
export default defineConfig({
    source: {
        entry: {
            index: './src/index.ts',
        },
    },
    output: {
        target: 'web',
    },
    html: {
        title: 'arborium-rt rsbuild integration test',
    },
    tools: {
        rspack: {
            plugins: [
                new ArboriumRtRspackPlugin({
                    allow: ['json', 'rust', 'typescript'],
                }),
            ],
        },
    },
});
