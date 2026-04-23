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

// Themes fixture mirrors write-themes-index.ts output. The loader uses the
// same block regex against both modules because the entry shape is
// identical; these tests pin that guarantee.
const THEMES_FIXTURE = `\
export const THEMES = {
    "one-dark": {
        themeId: "one-dark",
        name: "One Dark",
        variant: "dark",
        background: "#282c34",
        foreground: "#abb2bf",
        css: new URL("./themes/one-dark.css", import.meta.url),
    },
    "catppuccin-mocha": {
        themeId: "catppuccin-mocha",
        name: "Mocha",
        variant: "dark",
        background: "#1e1e2e",
        foreground: "#cdd6f4",
        css: new URL("./themes/catppuccin-mocha.css", import.meta.url),
    },
    "github-light": {
        themeId: "github-light",
        name: "GitHub Light",
        variant: "light",
        background: "#ffffff",
        foreground: "#24292e",
        css: new URL("./themes/github-light.css", import.meta.url),
    },
};
`;

describe('ArboriumRtRspackPlugin loader against THEMES', () => {
    it('keeps only allow-listed theme ids', () => {
        const out = runLoader(THEMES_FIXTURE, { allow: ['one-dark'] });
        expect(out).toContain('"one-dark"');
        expect(out).not.toContain('"catppuccin-mocha"');
        expect(out).not.toContain('"github-light"');
        // The `new URL(...)` for dropped themes must disappear — that's the
        // whole point, since rspack traces those statically.
        expect(out).not.toMatch(/themes\/catppuccin-mocha\.css/);
        expect(out).not.toMatch(/themes\/github-light\.css/);
    });

    it('drops deny-listed theme ids', () => {
        const out = runLoader(THEMES_FIXTURE, { deny: ['catppuccin-mocha'] });
        expect(out).toContain('"one-dark"');
        expect(out).toContain('"github-light"');
        expect(out).not.toContain('"catppuccin-mocha"');
    });
});
