// Unit tests for the loader's source transform. Run the loader against a
// hand-authored fixture whose shape mirrors what `write-grammars-index.ts`
// emits, then assert which entries survived.

import { describe, expect, it } from 'vitest';

import arboriumRtLoader from '../dist/loader.js';

const FIXTURE = `\
export const GRAMMARS = {
    "ada": {
        languageId: "ada",
        languageExport: "tree_sitter_ada",
        wasm: new URL("./grammars/ada/tree-sitter-ada.wasm", import.meta.url),
        highlights: new URL("./grammars/ada/highlights.scm", import.meta.url),
    },
    "json": {
        languageId: "json",
        languageExport: "tree_sitter_json",
        wasm: new URL("./grammars/json/tree-sitter-json.wasm", import.meta.url),
        highlights: new URL("./grammars/json/highlights.scm", import.meta.url),
    },
    "rust": {
        languageId: "rust",
        languageExport: "tree_sitter_rust",
        wasm: new URL("./grammars/rust/tree-sitter-rust.wasm", import.meta.url),
        highlights: new URL("./grammars/rust/highlights.scm", import.meta.url),
        injections: new URL("./grammars/rust/injections.scm", import.meta.url),
    },
};
`;

function runLoader(source: string, options: unknown): string {
    const ctx = {
        getOptions: () => options,
        getLogger: () => ({ info: () => {} }),
    };
    return arboriumRtLoader.call(ctx as never, source);
}

describe('ArboriumRtRspackPlugin loader', () => {
    it('passes source through untouched when no options are set', () => {
        expect(runLoader(FIXTURE, {})).toBe(FIXTURE);
        expect(runLoader(FIXTURE, undefined)).toBe(FIXTURE);
    });

    it('keeps only allow-listed ids', () => {
        const out = runLoader(FIXTURE, { allow: ['json'] });
        expect(out).toContain('"json"');
        expect(out).not.toContain('"ada"');
        expect(out).not.toContain('"rust"');
    });

    it('drops deny-listed ids', () => {
        const out = runLoader(FIXTURE, { deny: ['rust'] });
        expect(out).toContain('"ada"');
        expect(out).toContain('"json"');
        expect(out).not.toContain('"rust"');
    });

    it('applies deny after allow — intersection wins', () => {
        const out = runLoader(FIXTURE, { allow: ['ada', 'json'], deny: ['json'] });
        expect(out).toContain('"ada"');
        expect(out).not.toContain('"json"');
        expect(out).not.toContain('"rust"');
    });

    it('unknown ids in allow/deny are silently ignored', () => {
        const out = runLoader(FIXTURE, { allow: ['ada', 'klingon'], deny: ['vulcan'] });
        expect(out).toContain('"ada"');
        expect(out).not.toContain('"json"');
        expect(out).not.toContain('"rust"');
    });

    it('preserves the surrounding scaffolding', () => {
        const out = runLoader(FIXTURE, { allow: ['json'] });
        expect(out).toMatch(/export const GRAMMARS = \{/);
        expect(out).toMatch(/\};\n$/);
    });
});
