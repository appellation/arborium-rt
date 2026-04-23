// Tiny demo that exercises the full @discord/arborium-rt surface: host load,
// a bundled grammar from GRAMMARS, and the HTML highlight pipeline. The point
// of this package isn't the runtime behavior (the arborium-rt Vitest suite
// already covers that) — it's to prove the package bundles under rspack/rsbuild.

import { GRAMMARS, loadArboriumRuntime, type BundledGrammarId } from '@discord/arborium-rt';

const SAMPLE: Record<BundledGrammarId | string, string> = {
    json: '{"name": "arborium-rt", "answer": 42}',
    rust: 'fn main() { println!("hello, {}!", "world"); }',
    typescript: 'const greet = (name: string): string => `hello, ${name}!`;',
};

async function render(lang: BundledGrammarId, code: string): Promise<string> {
    const runtime = await loadArboriumRuntime();
    const grammar = await runtime.loadGrammar(GRAMMARS[lang]);
    const session = grammar.createSession();
    try {
        session.setText(code.endsWith('\n') ? code : code + '\n');
        return session.highlightToHtml({ format: { kind: 'class-names' } });
    } finally {
        session.free();
        grammar.unregister();
    }
}

async function main(): Promise<void> {
    const root = document.createElement('div');
    root.style.fontFamily = 'ui-monospace, SFMono-Regular, monospace';
    document.body.appendChild(root);

    for (const lang of ['json', 'rust', 'typescript'] as const) {
        const code = SAMPLE[lang]!;
        const heading = document.createElement('h2');
        heading.textContent = lang;
        const pre = document.createElement('pre');
        pre.innerHTML = await render(lang, code);
        root.appendChild(heading);
        root.appendChild(pre);
    }
}

main().catch((err: unknown) => {
    const pre = document.createElement('pre');
    pre.style.color = 'crimson';
    pre.textContent = err instanceof Error ? err.stack ?? err.message : String(err);
    document.body.appendChild(pre);
});
