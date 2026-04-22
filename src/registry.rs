//! Grammar + session registry.
//!
//! A single global [`Mutex<Registry>`] (WASM is single-threaded so contention
//! is zero — the `Mutex` just satisfies Rust's `Sync` bounds for statics)
//! holds every registered grammar's [`PluginRuntime`] and routes sessions to
//! the grammar they belong to. Session IDs are allocated by the registry
//! (not by the underlying `PluginRuntime`) so they're globally unique.

use std::cell::Cell;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use arborium_plugin_runtime::{HighlightConfig, PluginRuntime};
use arborium_tree_sitter::{Language, LanguageFn};

pub(crate) struct Registry {
    grammars: HashMap<u32, PluginRuntime>,
    next_grammar_id: u32,
    sessions: HashMap<u32, SessionEntry>,
    next_session_id: u32,
}

struct SessionEntry {
    grammar_id: u32,
    inner_id: u32,
}

impl Registry {
    fn new() -> Self {
        Self {
            grammars: HashMap::new(),
            next_grammar_id: 1,
            sessions: HashMap::new(),
            next_session_id: 1,
        }
    }

    pub(crate) fn register_grammar(
        &mut self,
        language: Language,
        highlights_query: &str,
        injections_query: &str,
        locals_query: &str,
    ) -> Result<u32, RegistryError> {
        let language_fn = stash_language(language);
        let config = HighlightConfig::new(
            language_fn,
            highlights_query,
            injections_query,
            locals_query,
        )
        .map_err(|_| RegistryError::QueryCompile)?;
        let runtime = PluginRuntime::new(config);
        let id = self.next_grammar_id;
        self.next_grammar_id = self
            .next_grammar_id
            .checked_add(1)
            .ok_or(RegistryError::IdExhausted)?;
        self.grammars.insert(id, runtime);
        Ok(id)
    }

    pub(crate) fn unregister_grammar(&mut self, grammar_id: u32) {
        self.grammars.remove(&grammar_id);
        // Drop all sessions that belonged to this grammar; their inner IDs
        // die with the PluginRuntime.
        self.sessions.retain(|_, s| s.grammar_id != grammar_id);
    }

    pub(crate) fn create_session(&mut self, grammar_id: u32) -> Option<u32> {
        let rt = self.grammars.get_mut(&grammar_id)?;
        let inner_id = rt.create_session();
        let session_id = self.next_session_id;
        self.next_session_id = self.next_session_id.checked_add(1)?;
        self.sessions.insert(
            session_id,
            SessionEntry {
                grammar_id,
                inner_id,
            },
        );
        Some(session_id)
    }

    pub(crate) fn free_session(&mut self, session_id: u32) {
        if let Some(entry) = self.sessions.remove(&session_id)
            && let Some(rt) = self.grammars.get_mut(&entry.grammar_id)
        {
            rt.free_session(entry.inner_id);
        }
    }

    pub(crate) fn with_session<R>(
        &mut self,
        session_id: u32,
        f: impl FnOnce(&mut PluginRuntime, u32) -> R,
    ) -> Option<R> {
        let entry = self.sessions.get(&session_id)?;
        let grammar_id = entry.grammar_id;
        let inner_id = entry.inner_id;
        let rt = self.grammars.get_mut(&grammar_id)?;
        Some(f(rt, inner_id))
    }
}

#[derive(Debug)]
pub(crate) enum RegistryError {
    QueryCompile,
    IdExhausted,
}

thread_local! {
    /// One-shot cell used to hand a `*const TSLanguage` to the stub
    /// `extern "C"` function we pass as a `LanguageFn`.
    ///
    /// `HighlightConfig::new` immediately consumes the `LanguageFn` by
    /// calling it once to produce a `Language`. `stash_language` below
    /// sets this cell, returns a `LanguageFn` pointing at `read_stashed`,
    /// then `HighlightConfig::new` calls the fn, which drains the cell.
    /// The whole dance happens inside `Registry::register_grammar` under
    /// the registry's `Mutex`, so there's no interleaving.
    static PENDING_LANG: Cell<*const ()> = const { Cell::new(core::ptr::null()) };
}

unsafe extern "C" fn read_stashed() -> *const () {
    PENDING_LANG.with(|p| {
        let raw = p.get();
        p.set(core::ptr::null());
        raw
    })
}

fn stash_language(language: Language) -> LanguageFn {
    let raw = language.into_raw();
    PENDING_LANG.with(|p| p.set(raw.cast()));
    // SAFETY: `read_stashed` matches `LanguageFn`'s expected signature and
    // returns a non-null pointer produced above, unless already drained.
    unsafe { LanguageFn::from_raw(read_stashed) }
}

pub(crate) fn registry() -> &'static Mutex<Registry> {
    static REGISTRY: OnceLock<Mutex<Registry>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(Registry::new()))
}
