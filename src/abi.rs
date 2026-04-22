//! C ABI surface.
//!
//! All functions in this module are `#[unsafe(no_mangle)] pub extern "C"`
//! and exposed to consumers via emscripten's dynamic linker. See the
//! crate-level README for the full contract.
//!
//! Pointer rules:
//!
//! - Input buffers (`*const u8`) are borrowed for the duration of the call;
//!   they're never retained.
//! - Output buffers (`arborium_rt_parse_utf16`) are allocated by the runtime
//!   in shared linear memory and ownership transfers to the caller. Callers
//!   **must** return them via `arborium_rt_free(ptr, len)`.
//! - Session IDs and grammar IDs are opaque `u32` handles. `0` is never a
//!   valid ID — the registry starts counting at `1` so `0` can double as a
//!   null-return signal.

use std::alloc::{Layout, alloc, dealloc};
use std::slice;

use arborium_tree_sitter::Language;

use crate::ABI_VERSION;
use crate::registry::registry;

#[unsafe(no_mangle)]
pub extern "C" fn arborium_rt_abi_version() -> u32 {
    ABI_VERSION
}

/// Register a grammar by its `*const TSLanguage` (obtained from the grammar
/// side module's `tree_sitter_<lang>()` export) plus its three query
/// sources. Returns a non-zero grammar ID on success, `0` on failure.
///
/// # Safety
///
/// `language` must be a valid `*const TSLanguage` from a grammar module
/// loaded into the same emscripten runtime. Query pointers must be valid
/// for `*_len` bytes and contain UTF-8. A NULL query pointer with
/// `*_len == 0` represents an empty query.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn arborium_rt_register_grammar(
    language: *const core::ffi::c_void,
    highlights_ptr: *const u8,
    highlights_len: u32,
    injections_ptr: *const u8,
    injections_len: u32,
    locals_ptr: *const u8,
    locals_len: u32,
) -> u32 {
    if language.is_null() {
        return 0;
    }
    let highlights = match unsafe { str_from_parts(highlights_ptr, highlights_len) } {
        Some(s) => s,
        None => return 0,
    };
    let injections = match unsafe { str_from_parts(injections_ptr, injections_len) } {
        Some(s) => s,
        None => return 0,
    };
    let locals = match unsafe { str_from_parts(locals_ptr, locals_len) } {
        Some(s) => s,
        None => return 0,
    };
    let language = unsafe { Language::from_raw(language.cast()) };
    let mut reg = registry().lock().expect("registry poisoned");
    reg.register_grammar(language, highlights, injections, locals)
        .unwrap_or(0)
}

#[unsafe(no_mangle)]
pub extern "C" fn arborium_rt_unregister_grammar(grammar_id: u32) {
    let mut reg = registry().lock().expect("registry poisoned");
    reg.unregister_grammar(grammar_id);
}

#[unsafe(no_mangle)]
pub extern "C" fn arborium_rt_create_session(grammar_id: u32) -> u32 {
    let mut reg = registry().lock().expect("registry poisoned");
    reg.create_session(grammar_id).unwrap_or(0)
}

#[unsafe(no_mangle)]
pub extern "C" fn arborium_rt_free_session(session_id: u32) {
    let mut reg = registry().lock().expect("registry poisoned");
    reg.free_session(session_id);
}

/// Load UTF-8 text for a session. Replaces any previous text. Triggers an
/// immediate parse (matching `PluginRuntime::set_text` semantics).
#[unsafe(no_mangle)]
pub unsafe extern "C" fn arborium_rt_set_text(
    session_id: u32,
    text_ptr: *const u8,
    text_len: u32,
) {
    let text = match unsafe { str_from_parts(text_ptr, text_len) } {
        Some(s) => s,
        None => return,
    };
    let mut reg = registry().lock().expect("registry poisoned");
    reg.with_session(session_id, |rt, inner_id| rt.set_text(inner_id, text));
}

#[unsafe(no_mangle)]
pub extern "C" fn arborium_rt_cancel(session_id: u32) {
    let mut reg = registry().lock().expect("registry poisoned");
    reg.with_session(session_id, |rt, inner_id| rt.cancel(inner_id));
}

/// Execute queries on the session's current tree and return a JSON-encoded
/// `arborium_wire::Utf16ParseResult` in shared linear memory.
///
/// On success: writes a pointer into `*out_ptr` and length into `*out_len`,
/// returns `0`. On failure: leaves outputs untouched, returns non-zero.
/// The caller owns the returned buffer and must return it via
/// `arborium_rt_free(ptr, len)` to avoid leaking.
///
/// # Safety
///
/// `out_ptr` and `out_len` must point to writable `u32`/`u8*` slots the
/// caller controls.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn arborium_rt_parse_utf16(
    session_id: u32,
    out_ptr: *mut *mut u8,
    out_len: *mut u32,
) -> i32 {
    let result = {
        let mut reg = registry().lock().expect("registry poisoned");
        reg.with_session(session_id, |rt, inner_id| rt.parse_utf16(inner_id))
    };
    let parse_result = match result {
        Some(Ok(r)) => r,
        Some(Err(_)) => return 2,
        None => return 1,
    };
    let json = match serde_json::to_vec(&parse_result) {
        Ok(v) => v,
        Err(_) => return 3,
    };
    let len = json.len();
    if len == 0 {
        unsafe {
            *out_ptr = core::ptr::null_mut();
            *out_len = 0;
        }
        return 0;
    }
    // SAFETY: layout is non-zero-sized; alloc returns aligned or null.
    let layout = match Layout::from_size_align(len, 1) {
        Ok(l) => l,
        Err(_) => return 4,
    };
    let ptr = unsafe { alloc(layout) };
    if ptr.is_null() {
        return 5;
    }
    unsafe {
        core::ptr::copy_nonoverlapping(json.as_ptr(), ptr, len);
        *out_ptr = ptr;
        *out_len = len as u32;
    }
    0
}

/// Return an output buffer previously handed out by
/// `arborium_rt_parse_utf16`.
///
/// # Safety
///
/// `ptr` must have been returned by `arborium_rt_parse_utf16` with the same
/// `len`. Passing any other pointer is UB.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn arborium_rt_free(ptr: *mut u8, len: u32) {
    if ptr.is_null() || len == 0 {
        return;
    }
    let Ok(layout) = Layout::from_size_align(len as usize, 1) else {
        return;
    };
    unsafe { dealloc(ptr, layout) };
}

/// Build a `&str` from a raw ptr/len, returning `None` on null+nonzero or
/// on non-UTF-8 contents. Null+zero is treated as an empty string, which
/// matches the convention for "unused query".
unsafe fn str_from_parts<'a>(ptr: *const u8, len: u32) -> Option<&'a str> {
    if ptr.is_null() {
        return if len == 0 { Some("") } else { None };
    }
    let bytes = unsafe { slice::from_raw_parts(ptr, len as usize) };
    core::str::from_utf8(bytes).ok()
}
