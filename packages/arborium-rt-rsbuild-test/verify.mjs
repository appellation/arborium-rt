// Post-build check: scan `dist/` for the theme markers proving our
// statically-imported `@discord/arborium-rt/themes/one-dark.css` actually
// reached the bundle. rsbuild emits CSS side-effect imports as part of its
// own stylesheet output; the file layout can vary between versions, so we
// walk `dist/` and grep for identifiers that only exist in theme-codegen's
// output. Keeps the smoke test honest — plain `rsbuild build` success
// doesn't tell us whether the subpath export resolved.

import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const distDir = join(dirname(fileURLToPath(import.meta.url)), 'dist');

const MARKERS = [
    /\.arborium-one-dark\b/,       // scoped selector for the bundled theme
    /--arb-bg\b/,                  // per-slot vars emitted by theme-codegen
    /var\(--arb-[a-z]+\)/,         // element rules consume the vars
];

async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...(await walk(path)));
        } else {
            files.push(path);
        }
    }
    return files;
}

async function main() {
    await stat(distDir).catch(() => {
        throw new Error(`dist/ not found — did rsbuild build run? (${distDir})`);
    });

    const files = (await walk(distDir)).filter((p) => /\.(css|js)$/.test(p));
    const contents = await Promise.all(
        files.map(async (p) => ({ path: p, body: await readFile(p, 'utf8') })),
    );

    const missing = MARKERS.filter(
        (re) => !contents.some(({ body }) => re.test(body)),
    );
    if (missing.length > 0) {
        const examined = contents.map((c) => c.path.slice(distDir.length + 1)).join('\n  ');
        throw new Error(
            `theme CSS did not reach the bundle — missing markers:\n  ${missing
                .map((r) => r.source)
                .join('\n  ')}\n\nExamined files:\n  ${examined}`,
        );
    }

    console.log(`✓ theme CSS markers present in ${files.length} build artifact(s)`);
}

main().catch((err) => {
    console.error(err instanceof Error ? err.stack ?? err.message : err);
    process.exit(1);
});
