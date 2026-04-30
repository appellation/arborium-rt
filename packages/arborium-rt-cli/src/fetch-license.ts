// Fetch an upstream LICENSE/COPYING file from a grammar's source repo and
// cache it under `target/grammars/<lang>/LICENSE`. Distributing the parser
// wasm without the upstream license would violate every common OSS
// license we ship under (MIT, Apache-2.0, ISC, CC0-1.0), so this is a hard
// build step — failure to locate a license aborts the build.
//
// Cache semantics: if the destination file already exists and is non-empty,
// no network calls are made. To re-fetch (e.g. after bumping a pinned
// commit), delete `target/grammars/<lang>/LICENSE` first.

import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { Logger } from './util.js';

/**
 * Common LICENSE/COPYING filenames found in tree-sitter grammar repos,
 * tried in order. Most upstream parsers use plain `LICENSE`; the dual-
 * licensed variants (LICENSE-MIT/LICENSE-APACHE) and `COPYING` cover
 * the long tail.
 */
const LICENSE_FILENAMES = [
    'LICENSE',
    'LICENSE.md',
    'LICENSE.txt',
    'license',
    'license.md',
    'license.txt',
    'LICENSE-MIT',
    'LICENSE-APACHE',
    'COPYING',
    'COPYING.md',
] as const;

export interface FetchLicenseArgs {
    /** Upstream repo URL, e.g. `https://github.com/tree-sitter/tree-sitter-json`. */
    repo: string;
    /** Pinned commit SHA, or `undefined` to fall back to the default branch. */
    commit: string | undefined;
    /** Absolute path the LICENSE bytes should be written to. */
    outPath: string;
    /** Logger to surface progress + warnings on. */
    log: Logger;
}

/**
 * Fetch the upstream license and write it to `outPath`. Idempotent: if the
 * file already exists with non-zero size, returns immediately without
 * touching the network.
 */
export async function fetchLicense(args: FetchLicenseArgs): Promise<void> {
    if (existsSync(args.outPath) && statSync(args.outPath).size > 0) {
        args.log.info(`license already cached at ${args.outPath}`);
        return;
    }

    const { owner, name } = parseGithubRepo(args.repo);
    const ref = args.commit ?? 'HEAD';

    const tried: string[] = [];
    for (const fname of LICENSE_FILENAMES) {
        const url = `https://raw.githubusercontent.com/${owner}/${name}/${ref}/${fname}`;
        tried.push(fname);
        const res = await fetch(url);
        if (res.status === 404) continue;
        if (!res.ok) {
            throw new Error(
                `fetching ${url} failed: HTTP ${res.status} ${res.statusText}`,
            );
        }
        const text = await res.text();
        mkdirSync(dirname(args.outPath), { recursive: true });
        writeFileSync(args.outPath, text);
        args.log.step(
            `fetched LICENSE from ${owner}/${name}@${ref.slice(0, 12)}/${fname}`,
        );
        return;
    }

    throw new Error(
        `no license file found in ${owner}/${name}@${ref}; tried ${tried.join(', ')}`,
    );
}

/**
 * Parse `https://github.com/<owner>/<name>(.git)?` into its components.
 * Throws on anything that doesn't look like a GitHub URL — the raw-content
 * URL scheme below is GitHub-specific, and every grammar in the arborium
 * corpus is hosted there.
 */
function parseGithubRepo(repo: string): { owner: string; name: string } {
    const m = /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(
        repo.trim(),
    );
    if (!m || !m[1] || !m[2]) {
        throw new Error(
            `unsupported repo URL for license fetch: ${repo} (expected https://github.com/<owner>/<name>)`,
        );
    }
    return { owner: m[1], name: m[2] };
}
