// Arborium submodule setup: apply local patches to the working tree + render
// Cargo.toml from Cargo.stpl.toml templates.
//
// Patches are applied via `git apply` (working-tree only — no commits, no
// committer identity required). Each run resets the submodule to its pinned
// upstream SHA first, so patches never stack.

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Logger, paths, run } from './util.js';

/** Local version string rendered into each `Cargo.toml` from its template. */
const RENDER_VERSION = '0.0.0-arborium-rt';

export async function bootstrap(): Promise<void> {
    const p = paths();
    const log = new Logger('bootstrap');

    if (!existsSync(join(p.submoduleRoot, '.git'))) {
        throw new Error(
            `submodule not checked out at ${p.submoduleRoot}; run: git submodule update --init --recursive`,
        );
    }

    log.step('resetting submodule to its pinned commit');
    await run(log, 'git', [
        '-C', p.repoRoot,
        'submodule', 'update', '--init', '--force', 'third_party/arborium',
    ]);
    // `-x` also removes gitignored files — our patches produce some (e.g.,
    // arborium-theme/src/builtin_generated.rs) that the submodule's own
    // .gitignore covers, so a plain `clean -fd` leaves them behind and the
    // next bootstrap's `git apply` fails with "already exists".
    await run(log, 'git', ['-C', p.submoduleRoot, 'clean', '-fdx']);

    const patches = readdirSync(p.patchesDir)
        .filter((name) => name.endsWith('.patch'))
        .sort();
    for (const patch of patches) {
        log.step(`applying ${patch}`);
        // git apply tolerates the mbox `From:`/`Subject:` preamble — it
        // reads the unified diff and ignores the commit metadata, so no
        // committer identity is needed.
        await run(log, 'git', [
            '-C', p.submoduleRoot,
            'apply', '--whitespace=nowarn',
            join(p.patchesDir, patch),
        ]);
    }

    log.step(`rendering Cargo.toml from Cargo.stpl.toml (version ${RENDER_VERSION})`);
    const cratesDir = join(p.submoduleRoot, 'crates');
    for (const crate of readdirSync(cratesDir)) {
        const stpl = join(cratesDir, crate, 'Cargo.stpl.toml');
        if (!existsSync(stpl)) continue;
        const template = readFileSync(stpl, 'utf8');
        const rendered = template.replaceAll('<%= version %>', RENDER_VERSION);
        writeFileSync(join(cratesDir, crate, 'Cargo.toml'), rendered);
    }

    log.step('bootstrap complete.');
}
