// Generate THIRD_PARTY_NOTICES.json — a machine-readable manifest of every
// bundled grammar's upstream source, SPDX license, and copyright holder.
// Two copies are written from the same in-memory object: one into
// packages/arborium-rt/dist/ so it ships in the npm tarball via the
// existing `"files": ["dist"]` rule, and one at the repo root so the
// list is browsable on GitHub. Output is sorted by id and contains no
// timestamps so successive builds are byte-reproducible.
//
// Source-of-truth fields (repo, commit, license SPDX, grammar name/aliases)
// come from `buildGrammarIndex`, the same scanner that drives `grammars.ts`.
// The copyright line is best-effort regex-extracted from each grammar's
// bundled LICENSE files (first match wins) — CC0-1.0 and Unlicense
// grammars legitimately have no copyright holder, so a miss warns rather
// than failing the build.

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildGrammarIndex, type GrammarIndexEntry } from "./arborium-yaml.js";
import { LICENSE_FILE_RE } from "./fetch-license.js";
import { Logger, paths } from "./util.js";

interface NoticeEntry {
  readonly id: string;
  readonly name: string | undefined;
  readonly aliases?: readonly string[];
  readonly repo: string | undefined;
  readonly commit: string | undefined;
  readonly license: string | undefined;
  readonly copyright: string | null;
  readonly licenseFiles: readonly string[];
}

interface Manifest {
  readonly schemaVersion: 1;
  readonly package: string;
  readonly grammars: readonly NoticeEntry[];
}

export function writeThirdPartyNotices(): void {
  const p = paths();
  const log = new Logger("notices");
  const index = buildGrammarIndex(p.langsRoots);

  if (!existsSync(p.packagesOut)) return;

  const langs = readdirSync(p.packagesOut)
    .filter((name) => statSync(join(p.packagesOut, name)).isDirectory())
    .filter((name) =>
      existsSync(join(p.packagesOut, name, `tree-sitter-${name}.wasm`)),
    )
    .sort();

  const grammars: NoticeEntry[] = [];
  for (const id of langs) {
    const entry = index.get(id);
    if (!entry) {
      log.warn(`no grammar index entry for ${id}; skipping`);
      continue;
    }
    const langDir = join(p.packagesOut, id);
    const licenseFiles = readdirSync(langDir).filter((n) => LICENSE_FILE_RE.test(n)).sort();
    if (licenseFiles.length === 0) {
      // dist/<lang>/ is stale from before the LICENSE-fetch step landed.
      // Skip-and-warn so partial rebuilds (e.g. `package-all --only json`)
      // still produce a valid manifest. A full `build-all` repopulates.
      log.warn(`skipping ${id}: no LICENSE files in ${langDir} — rerun \`arborium-rt build ${entry.group} ${id}\``);
      continue;
    }

    let copyright: string | null = null;
    for (const fname of licenseFiles) {
      copyright = extractCopyright(readFileSync(join(langDir, fname), "utf8"));
      if (copyright !== null) break;
    }
    if (copyright === null) {
      log.warn(`no copyright line found in ${id} LICENSE files — license=${entry.license ?? "?"}`);
    }

    grammars.push(buildEntry(id, entry, copyright, licenseFiles));
  }

  const manifest: Manifest = {
    schemaVersion: 1,
    package: "@discord/arborium-rt",
    grammars,
  };
  const json = JSON.stringify(manifest, null, 2) + "\n";

  writeFileSync(join(p.runtimePackageDir, "dist", "THIRD_PARTY_NOTICES.json"), json);
  writeFileSync(join(p.repoRoot, "THIRD_PARTY_NOTICES.json"), json);

  log.step(`wrote THIRD_PARTY_NOTICES.json (${grammars.length} grammars)`);
}

function buildEntry(
  id: string,
  entry: GrammarIndexEntry,
  copyright: string | null,
  licenseFiles: readonly string[],
): NoticeEntry {
  const aliases = entry.grammar.aliases;
  return {
    id,
    name: entry.grammar.name,
    ...(aliases && aliases.length > 0 ? { aliases } : {}),
    repo: entry.repo,
    commit: entry.commit,
    license: entry.license,
    copyright,
    licenseFiles: licenseFiles.map((fname) => `grammars/${id}/${fname}`),
  };
}

// Pulls the canonical "Copyright (c) <years> <holder>" line out of a LICENSE
// file. We scan only the first 40 lines because the canonical line always
// appears in the preamble of MIT/Apache-2.0/ISC license texts; scanning the
// whole file would risk matching `Copyright` inside the conditions section.
const COPYRIGHT_RE =
  /^\s*Copyright\s*(?:\([cC]\)|©)?\s*([0-9]{4}(?:\s*[-,]\s*[0-9]{4})*)?[,\s]*([^\n]*?)\s*$/m;

function extractCopyright(licenseText: string): string | null {
  const head = licenseText.split("\n").slice(0, 40).join("\n");
  const match = COPYRIGHT_RE.exec(head);
  if (!match) return null;
  const years = match[1]?.trim();
  const holder = match[2]?.trim();
  if (!holder) return null;
  return years ? `Copyright (c) ${years} ${holder}` : `Copyright (c) ${holder}`;
}
