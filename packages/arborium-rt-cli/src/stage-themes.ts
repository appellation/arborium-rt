// Build + invoke the host-native `arborium-rt-theme-codegen` binary, which
// walks `arborium_theme::theme::builtin::all_with_ids()`, renders each theme
// through `Theme::to_css`, writes `dist/themes/<id>.css` into the runtime
// package, and returns the metadata that feeds `packages/arborium-rt/
// src/themes.ts`. The Rust binary lives outside the emscripten SIDE_MODULE
// runtime on purpose — theme→CSS is a publish-time operation and has no
// business bloating the wasm that every consumer loads.
//
// First invocation pays a one-time libstd rebuild for the host triple
// because the root `.cargo/config.toml` enables `-Zbuild-std` (pinned for
// the emscripten target); subsequent calls hit cache.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { Logger, paths, run, type Paths } from './util.js';
import { writeThemesIndexModule, type ThemeIndexEntry } from './write-themes-index.js';

interface CodegenEntry {
    readonly themeId: string;
    readonly name: string;
    readonly variant: 'dark' | 'light';
    readonly background: string | null;
    readonly foreground: string | null;
}

/**
 * Render every bundled theme to `dist/themes/<id>.css` and regenerate the
 * `src/themes.ts` index module. Returns the metadata entries written into
 * the index so callers can log or cross-check counts.
 */
export async function stageThemes(): Promise<readonly ThemeIndexEntry[]> {
    const p = paths();
    const log = new Logger('stage-themes');

    const host = await detectHostTriple();
    const binary = await buildCodegen(p, host, log);

    mkdirSync(p.themesOut, { recursive: true });
    log.step(`rendering themes → ${p.themesOut}`);

    const json = await invokeCodegen(binary, p.themesOut);
    const rawEntries = JSON.parse(json) as readonly CodegenEntry[];
    const entries: ThemeIndexEntry[] = rawEntries.map((e) => ({
        themeId: e.themeId,
        name: e.name,
        variant: e.variant,
        ...(e.background !== null ? { background: e.background } : {}),
        ...(e.foreground !== null ? { foreground: e.foreground } : {}),
    }));

    writeThemesIndexModule(entries);
    log.step(`wrote ${entries.length} theme(s) + regenerated src/themes.ts`);
    return entries;
}

async function detectHostTriple(): Promise<string> {
    const output = await captureStdout('rustc', ['-vV']);
    const m = /^host:\s*(\S+)/m.exec(output);
    if (!m) {
        throw new Error(`could not parse host triple from \`rustc -vV\`:\n${output}`);
    }
    return m[1]!;
}

async function buildCodegen(p: Paths, host: string, log: Logger): Promise<string> {
    log.step(`building theme-codegen (target=${host})`);
    await run(log, 'cargo', [
        'build',
        '--release',
        '--manifest-path', join(p.themeCodegenDir, 'Cargo.toml'),
    ], {
        // Override the repo-root .cargo/config.toml which pins emscripten.
        env: { CARGO_BUILD_TARGET: host },
    });
    const binary = join(p.themeCodegenDir, 'target', host, 'release', 'arborium-rt-theme-codegen');
    if (!existsSync(binary)) {
        throw new Error(`expected theme-codegen binary not found at ${binary}`);
    }
    return binary;
}

function captureStdout(cmd: string, args: readonly string[]): Promise<string> {
    return new Promise((resolvePromise, rejectPromise) => {
        const child = spawn(cmd, [...args], { stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        let err = '';
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => { out += chunk; });
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', (chunk: string) => { err += chunk; });
        child.once('error', rejectPromise);
        child.once('close', (code) => {
            if (code === 0) resolvePromise(out);
            else rejectPromise(new Error(`${cmd} ${args.join(' ')} exited ${code}\n${err}`));
        });
    });
}

function invokeCodegen(binary: string, outDir: string): Promise<string> {
    return new Promise((resolvePromise, rejectPromise) => {
        const child = spawn(binary, [outDir], { stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        let err = '';
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => { out += chunk; });
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', (chunk: string) => { err += chunk; });
        child.once('error', rejectPromise);
        child.once('close', (code) => {
            if (code === 0) resolvePromise(out);
            else rejectPromise(new Error(`theme-codegen exited ${code}\n${err}`));
        });
    });
}
