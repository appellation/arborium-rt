// Arborium submodule setup: apply local patches to the working tree + render
// Cargo.toml from Cargo.stpl.toml templates.
//
// Patches are applied via `git apply` (working-tree only — no commits, no
// committer identity required). Each run resets the submodule to its pinned
// upstream SHA first, so patches never stack.

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { paths, run, step } from './util.js';

/** Local version string rendered into each `Cargo.toml` from its template. */
const RENDER_VERSION = '0.0.0-arborium-rt';

export async function bootstrap(): Promise<void> {
    const p = paths();

    if (!existsSync(join(p.submoduleRoot, '.git'))) {
        throw new Error(
            `submodule not checked out at ${p.submoduleRoot}; run: git submodule update --init --recursive`,
        );
    }

    step('resetting submodule to its pinned commit');
    await run('git', [
        '-C', p.repoRoot,
        'submodule', 'update', '--init', '--force', 'third_party/arborium',
    ]);
    await run('git', ['-C', p.submoduleRoot, 'clean', '-fd']);

    const patches = readdirSync(p.patchesDir)
        .filter((name) => name.endsWith('.patch'))
        .sort();
    for (const patch of patches) {
        step(`applying ${patch}`);
        // git apply tolerates the mbox `From:`/`Subject:` preamble — it
        // reads the unified diff and ignores the commit metadata, so no
        // committer identity is needed.
        await run('git', [
            '-C', p.submoduleRoot,
            'apply', '--whitespace=nowarn',
            join(p.patchesDir, patch),
        ]);
    }

    step(`rendering Cargo.toml from Cargo.stpl.toml (version ${RENDER_VERSION})`);
    const cratesDir = join(p.submoduleRoot, 'crates');
    for (const crate of readdirSync(cratesDir)) {
        const stpl = join(cratesDir, crate, 'Cargo.stpl.toml');
        if (!existsSync(stpl)) continue;
        const template = readFileSync(stpl, 'utf8');
        const rendered = template.replaceAll('<%= version %>', RENDER_VERSION);
        writeFileSync(join(cratesDir, crate, 'Cargo.toml'), rendered);
    }

    step('bootstrap complete.');
}
