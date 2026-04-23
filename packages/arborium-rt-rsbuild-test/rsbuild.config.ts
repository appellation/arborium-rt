import { defineConfig } from '@rsbuild/core';

// Minimal rsbuild config — build target is a browser bundle so we exercise
// the same rspack code path that broke before the fix (ENVIRONMENT=web,worker
// on the host mjs, GRAMMARS' URL-typed assets, etc.).
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
});
