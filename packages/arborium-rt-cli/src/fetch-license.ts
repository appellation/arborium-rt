// Fetch every upstream LICENSE/COPYING/NOTICE file from a grammar's source
// repo and cache them under `target/grammars/<lang>/`. Distributing the
// parser wasm without the upstream license would violate every common OSS
// license we ship under (MIT, Apache-2.0, ISC, CC0-1.0), so this is a hard
// build step — failure to locate any license aborts the build.
//
// Multi-file behavior: dual-licensed repos (e.g. `MIT OR Apache-2.0`)
// commonly ship `LICENSE-MIT` + `LICENSE-APACHE` and may also have a
// top-level `LICENSE` wrapper. We probe every candidate filename and
// preserve all matches with their original names so the bundle reproduces
// the upstream attribution faithfully.
//
// Cache semantics: if the destination dir already contains any LICENSE-ish
// file, no network calls are made. To re-fetch (e.g. after bumping a pinned
// commit), delete the affected files under `target/grammars/<lang>/`.

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Logger } from './util.js';

/**
 * Filenames probed at the upstream repo's pinned commit. Plain `LICENSE`
 * covers the common case; the `-MIT` / `-APACHE` / `-BSD` variants pick up
 * dual-licensed repos; `COPYING` covers the GNU/BSD long tail; `NOTICE`
 * covers Apache-2.0 §4(d) attribution requirements.
 */
const LICENSE_FILENAMES = [
    'LICENSE',
    'LICENSE.md',
    'LICENSE.txt',
    'license',
    'license.md',
    'license.txt',
    'LICENSE-MIT',
    'LICENSE-MIT.md',
    'LICENSE-MIT.txt',
    'LICENSE-APACHE',
    'LICENSE-APACHE.md',
    'LICENSE-APACHE.txt',
    'LICENSE-BSD',
    'COPYING',
    'COPYING.md',
    'COPYING.txt',
    'NOTICE',
    'NOTICE.md',
    'NOTICE.txt',
] as const;

/**
 * Matches the filenames we recognize as upstream attribution. Used both
 * here (cache check) and downstream (build-package, notices generator)
 * to identify which files in `target/grammars/<lang>/` are licenses
 * versus build artifacts (wasm, .scm).
 */
export const LICENSE_FILE_RE = /^(LICENSE|license|COPYING|NOTICE)/;

export interface FetchLicenseArgs {
    /** Upstream repo URL, e.g. `https://github.com/tree-sitter/tree-sitter-json`. */
    repo: string;
    /** Pinned commit SHA, or `undefined` to fall back to the default branch. */
    commit: string | undefined;
    /** Directory the LICENSE file(s) should be written into. */
    outDir: string;
    /** Logger to surface progress + warnings on. */
    log: Logger;
}

/**
 * Fetch every upstream license file we can find and write them to `outDir`,
 * each preserving its original filename. Idempotent: if `outDir` already
 * contains any LICENSE-ish file, returns immediately without touching the
 * network.
 */
export async function fetchLicense(args: FetchLicenseArgs): Promise<void> {
    if (existsSync(args.outDir) && readdirSync(args.outDir).some((n) => LICENSE_FILE_RE.test(n))) {
        args.log.info(`license already cached at ${args.outDir}`);
        return;
    }

    const { owner, name } = parseGithubRepo(args.repo);
    const ref = args.commit ?? 'HEAD';

    // Probe in parallel — most filenames 404, and the per-grammar latency
    // would otherwise be 19× round-trip time. Keep all 200 responses.
    const probes = await Promise.all(
        LICENSE_FILENAMES.map(async (fname) => {
            const url = `https://raw.githubusercontent.com/${owner}/${name}/${ref}/${fname}`;
            const res = await fetch(url);
            if (res.status === 404) return null;
            if (!res.ok) {
                throw new Error(
                    `fetching ${url} failed: HTTP ${res.status} ${res.statusText}`,
                );
            }
            return { fname, text: await res.text() };
        }),
    );

    const found = probes.filter((p): p is { fname: string; text: string } => p !== null);

    if (found.length === 0) {
        throw new Error(
            `no license file found in ${owner}/${name}@${ref}; tried ${LICENSE_FILENAMES.join(', ')}`,
        );
    }

    mkdirSync(args.outDir, { recursive: true });
    for (const { fname, text } of found) {
        writeFileSync(join(args.outDir, fname), text);
    }
    args.log.step(
        `fetched ${found.length} license file(s) from ${owner}/${name}@${ref.slice(0, 12)}: ${found.map((f) => f.fname).join(', ')}`,
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
