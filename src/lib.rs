//! arborium-emscripten-runtime
//!
//! Packages [`arborium_plugin_runtime::PluginRuntime`] as an emscripten
//! `SIDE_MODULE=2` wasm suitable for loading into web-tree-sitter's
//! `MAIN_MODULE=2` runtime via `Module.loadWebAssemblyModule`. One instance
//! of this module serves many grammars concurrently: each grammar is
//! registered with its language pointer + queries, sessions are created per
//! grammar, and parse results are returned as JSON-encoded
//! [`arborium_wire::Utf16ParseResult`] in shared WASM linear memory.
//!
//! See `README.md` for build and integration instructions.
//!
//! # ABI stability
//!
//! The C function surface defined in `abi.rs` is versioned by
//! [`ABI_VERSION`], returned by `arborium_rt_abi_version()`. Consumers
//! should call it immediately after loading the side module and refuse to
//! proceed on mismatch. Increment [`ABI_VERSION`] whenever the signature,
//! semantics, or JSON payload shape of any `arborium_rt_*` function
//! changes in a breaking way.

mod abi;
mod registry;

/// ABI version exposed via `arborium_rt_abi_version()`. Bump on breakage.
pub const ABI_VERSION: u32 = 1;
