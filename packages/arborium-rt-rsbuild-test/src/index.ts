// Tiny demo that exercises the full @discord/arborium-rt surface: host load,
// a bundled grammar from GRAMMARS, the HTML highlight pipeline, and a
// statically-imported bundled theme. The point of this package isn't the
// runtime behavior (the arborium-rt Vitest suite already covers that) —
// it's to prove the package bundles under rspack/rsbuild. Specifically:
//
//  * Grammar URL assets traced out of GRAMMARS and shrunk by the rspack
//    plugin.
//  * Theme CSS resolved via the `./themes/*.css` subpath export and
//    pulled in as a static side-effect import. rspack treats it as a
//    regular CSS asset; loading the bundle in a browser gives the `<pre>`
//    live arborium colors via the `.arborium-<id>` class scope.

import { GRAMMARS, loadArboriumRuntime, type BundledGrammarId } from '@discord/arborium-rt';
import '@discord/arborium-rt/themes/one-dark.css';

const THEME_CLASS = 'arborium-one-dark';

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
        return session.highlightToHtml();
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
        pre.className = THEME_CLASS;
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
