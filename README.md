# arborium-rt

Emscripten `SIDE_MODULE=2` runtime for [arborium](https://github.com/bearcove/arborium) grammar plugins.

Loads once into web-tree-sitter's `MAIN_MODULE=2` wasm and runs
`arborium-plugin-runtime`'s session / highlight / injection logic across
many grammars loaded dynamically at runtime, so the tree-sitter C
runtime and arborium's query runner live once in the browser instead
of being baked into every grammar bundle.

## Architecture

```
┌─────────────────────────────────┐
│ web-tree-sitter.wasm            │   MAIN_MODULE=2, upstream tree-sitter.
│                                 │   Ships the C runtime once (~200 KB).
└──────────────▲──────────────────┘
               │ loadWebAssemblyModule
       ┌───────┴────────┐
       │                │
┌──────┴──────────┐  ┌──┴──────────────────────────────┐
│ tree-sitter-    │  │ arborium_emscripten_runtime.wasm │
│ <grammar>.wasm  │  │  (this crate)                    │
│ one per grammar │  │  one shared copy                 │
└─────────────────┘  └──────────────────────────────────┘
   parser tables       session + query execution in Rust
```

One running instance of the runtime serves many grammars via a
registry keyed by grammar ID. Each grammar is registered by handing
over its `*const TSLanguage` (from its side module's
`tree_sitter_<lang>()` export) plus the three query strings
(`highlights.scm`, `injections.scm`, `locals.scm`). Parse results are
JSON-encoded `arborium_wire::Utf16ParseResult` delivered through
shared linear memory.

See `src/abi.rs` for the full C ABI. Minimal JavaScript integration:

```js
import MainModuleFactory from './web-tree-sitter.mjs';
const Module = await MainModuleFactory();

const runtime = await Module.loadWebAssemblyModule(
    await fetch('arborium_emscripten_runtime.wasm').then(r => r.arrayBuffer()),
    { loadAsync: true });
if (runtime.arborium_rt_abi_version() !== 1)
    throw new Error('arborium_rt ABI mismatch');

const json = await Module.loadWebAssemblyModule(
    await fetch('tree-sitter-json.wasm').then(r => r.arrayBuffer()),
    { loadAsync: true });
const langPtr = json.tree_sitter_json();

function putStr(s) {
    const bytes = new TextEncoder().encode(s);
    const p = Module._malloc(bytes.length);
    Module.HEAPU8.set(bytes, p);
    return [p, bytes.length];
}
const [hPtr, hLen] = putStr(HIGHLIGHTS_SCM);
const [iPtr, iLen] = putStr('');
const [lPtr, lLen] = putStr('');
const grammarId = runtime.arborium_rt_register_grammar(
    langPtr, hPtr, hLen, iPtr, iLen, lPtr, lLen);

const sessionId = runtime.arborium_rt_create_session(grammarId);
const [tPtr, tLen] = putStr('[1, 2, 3]');
runtime.arborium_rt_set_text(sessionId, tPtr, tLen);
Module._free(tPtr);

const outPtr = Module._malloc(4);
const outLen = Module._malloc(4);
if (runtime.arborium_rt_parse_utf16(sessionId, outPtr, outLen) !== 0)
    throw new Error('parse failed');
const payload = JSON.parse(Module.UTF8ToString(
    Module.getValue(outPtr, 'i32'),
    Module.getValue(outLen, 'i32')));
runtime.arborium_rt_free(
    Module.getValue(outPtr, 'i32'),
    Module.getValue(outLen, 'i32'));
Module._free(outPtr);
Module._free(outLen);
```

## Dependency on arborium

This crate depends on four arborium crates by path into the
`third_party/arborium/` git submodule:

- `arborium-plugin-runtime` (unpatched; unpublished upstream)
- `arborium-tree-sitter` (patched — see `patches/`)
- `arborium-sysroot` (patched — see `patches/`)
- `arborium-wire` (unpatched; unpublished upstream)

The submodule points at a specific commit of
`github.com/bearcove/arborium`, currently `b7a8eb8`. It's pinned to a
commit rather than a tag because no upstream release tag contains
`arborium-plugin-runtime` yet — it was added on `main` after v2.16.0.

Two small patches (`patches/0001-*.patch`) apply on top of the pinned
submodule to enable `wasm32-unknown-emscripten` builds:

1. `arborium-tree-sitter/binding_rust/build.rs`: target-gated
   early-return that skips the `cc::Build` step so the tree-sitter C
   runtime isn't statically linked into the side module — the
   MAIN_MODULE resolves those symbols at load time.
2. `arborium-sysroot/{build.rs, src/lib.rs}`: narrow the wasm
   allocator's `cfg`/target gates to exclude emscripten, so emcc's
   libc isn't duplicated.

The patches are trivial target guards; they don't touch logic on any
existing target. They're the minimum surface needed for the emscripten
build to link.

`arborium-rt` also has to run a second bootstrap step because
arborium's `crates/*/Cargo.toml` files are not checked in — they're
generated from `Cargo.stpl.toml` templates by `xtask gen` on arborium's
side. `scripts/bootstrap.sh` takes care of this: it resets the
submodule, applies patches, and renders the manifests. Re-run after
updating the submodule.

## Build

Prereqs:

- [emsdk](https://github.com/emscripten-core/emsdk) 4.0.15 on `PATH`.
- Nightly Rust with the `rust-src` component (for `-Zbuild-std`). No
  rustup needed; a system/nix install is fine.

```sh
git clone --recurse-submodules <this-repo>
cd arborium-rt
./scripts/bootstrap.sh        # apply patches + render Cargo manifests
cargo build --release
```

Output: `target/wasm32-unknown-emscripten/release/arborium_emscripten_runtime.wasm` (~1.1 MB uncompressed).

Verify exports:

```sh
/path/to/emsdk/upstream/bin/llvm-objdump --syms \
  target/wasm32-unknown-emscripten/release/arborium_emscripten_runtime.wasm \
  | grep arborium_rt_
```

Expects: `arborium_rt_abi_version`, `arborium_rt_register_grammar`,
`arborium_rt_unregister_grammar`, `arborium_rt_create_session`,
`arborium_rt_free_session`, `arborium_rt_set_text`, `arborium_rt_cancel`,
`arborium_rt_parse_utf16`, `arborium_rt_free`.

## Bumping the arborium submodule

1. `cd third_party/arborium && git fetch origin && git checkout <new-commit>`
2. `cd ../..`
3. `./scripts/bootstrap.sh` — if the patches no longer apply cleanly,
   `git am` will leave the submodule in a partial state; investigate
   with `git -C third_party/arborium am --show-current-patch=diff`, fix
   the patch in `patches/`, then `git am --abort && ./scripts/bootstrap.sh`
   again.
4. `cargo build --release` to verify.
5. `git add third_party/arborium patches/ && git commit`.

## Host-side requirement

The runtime imports ~29 plain-named `ts_*` symbols (e.g.
`ts_parser_new`, `ts_query_cursor_exec`). Upstream tree-sitter's
`binding_web/lib/exports.txt` currently only exports the `*_wasm`
JS-bridge variants. Until upstream adds the plain names (a small
mechanical follow-up to `tree-sitter/tree-sitter`), consumers of this
runtime must build `web-tree-sitter.wasm` themselves with the extra
symbols included. A reference `build-host.sh` lives on the
`emscripten-dynlink-spike` branch of the associated arborium fork
(`appellation/arborium`).

## Stability

The C ABI is versioned by `ABI_VERSION` (currently `1`) exposed via
`arborium_rt_abi_version()`. Consumers should call it right after
`loadWebAssemblyModule` and refuse to proceed on mismatch. Increment
on any breaking change.

## License

MIT, matching arborium.
