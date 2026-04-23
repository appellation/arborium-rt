//! Host-native build-time helper. Walks `arborium_theme::theme::builtin::
//! all_with_ids()`, renders each theme as a self-contained CSS block, writes
//! `<out-dir>/<id>.css` per theme, and emits a JSON metadata array to stdout
//! for the TS CLI to fold into the published `THEMES` index.
//!
//! The CSS shape is intentionally split from `arborium_theme::Theme::to_css`:
//! per-slot colors are exposed as `--arb-<tag>` custom properties and the
//! element rules reference them via `var()`. Downstream consumers can
//! override any single slot (including background/foreground) by redefining
//! its variable under their own selector — including light/dark conditionals
//! and class-based styling that reference the same vars — without having to
//! re-emit CSS. Modifier-only rules (bold/italic/underline/strikethrough)
//! stay concrete; they're structural, not themable.
//!
//! Lives outside the emscripten SIDE_MODULE runtime on purpose: theme→CSS is
//! a publish-time operation and has no reason to bloat the runtime wasm.
//!
//! Usage: `arborium-rt-theme-codegen <out-dir>`

use std::collections::HashSet;
use std::fmt::Write;
use std::fs;
use std::path::PathBuf;

use arborium_theme::highlights::HIGHLIGHTS;
use arborium_theme::theme::{Style, Theme, builtin};

fn main() {
    let out_dir: PathBuf = std::env::args()
        .nth(1)
        .unwrap_or_else(|| {
            eprintln!("usage: arborium-rt-theme-codegen <out-dir>");
            std::process::exit(2);
        })
        .into();
    fs::create_dir_all(&out_dir).expect("create out dir");

    let mut entries = Vec::new();
    for (theme_id, theme) in builtin::all_with_ids() {
        let css = render_theme_css(theme_id, &theme);
        fs::write(out_dir.join(format!("{theme_id}.css")), css).expect("write CSS");

        entries.push(serde_json::json!({
            "themeId": theme_id,
            "name": theme.name,
            "variant": if theme.is_dark { "dark" } else { "light" },
            "background": theme.background.as_ref().map(|c| c.to_hex()),
            "foreground": theme.foreground.as_ref().map(|c| c.to_hex()),
        }));
    }

    let stdout = std::io::stdout();
    let mut out = stdout.lock();
    serde_json::to_writer(&mut out, &serde_json::Value::Array(entries)).expect("write stdout");
}

/// Emit `.arborium-<theme_id> { --arb-*: ...; a-*: var(--arb-*); ... }` with
/// per-slot custom properties, element rules that consume those vars, and
/// concrete modifier-only declarations. Mirrors `arborium_theme::Theme::
/// to_css`'s parent-tag fallback and dedup-by-tag rules so the slot coverage
/// matches the native highlighter.
fn render_theme_css(theme_id: &str, theme: &Theme) -> String {
    let mut css = String::new();

    writeln!(css, ".arborium-{theme_id} {{").unwrap();

    if let Some(bg) = &theme.background {
        writeln!(css, "  --arb-bg: {};", bg.to_hex()).unwrap();
    }
    if let Some(fg) = &theme.foreground {
        writeln!(css, "  --arb-fg: {};", fg.to_hex()).unwrap();
    }

    // Walk HIGHLIGHTS, resolving each slot's effective style (own if set,
    // else parent_tag's style). Dedup by tag so a category sharing the same
    // tag as a more-general parent doesn't emit twice.
    let mut emitted: HashSet<&'static str> = HashSet::new();
    let resolved: Vec<(&'static str, Style)> = HIGHLIGHTS
        .iter()
        .enumerate()
        .filter_map(|(i, def)| {
            if def.tag.is_empty() || !emitted.insert(def.tag) {
                return None;
            }
            resolve_style(theme, i).map(|style| (def.tag, style))
        })
        .collect();

    // --arb-<tag> custom properties for every slot that defines a foreground.
    for (tag, style) in &resolved {
        if let Some(fg) = &style.fg {
            writeln!(css, "  --arb-{tag}: {};", fg.to_hex()).unwrap();
        }
    }

    // Root-level background/color that consume the --arb-bg/--arb-fg vars.
    if theme.background.is_some() {
        writeln!(css, "  background: var(--arb-bg);").unwrap();
    }
    if theme.foreground.is_some() {
        writeln!(css, "  color: var(--arb-fg);").unwrap();
    }

    // Element rules referencing the per-slot vars + concrete modifier props.
    // A style with only modifiers (no fg) still gets a rule, just no color.
    for (tag, style) in &resolved {
        write!(css, "  a-{tag} {{").unwrap();

        if style.fg.is_some() {
            write!(css, " color: var(--arb-{tag});").unwrap();
        }
        if let Some(bg) = &style.bg {
            // Background modifiers aren't parameterised — these are rare
            // and theme-specific, so bake the concrete color.
            write!(css, " background: {};", bg.to_hex()).unwrap();
        }

        let mut decorations = Vec::new();
        if style.modifiers.underline {
            decorations.push("underline");
        }
        if style.modifiers.strikethrough {
            decorations.push("line-through");
        }
        if !decorations.is_empty() {
            write!(css, " text-decoration: {};", decorations.join(" ")).unwrap();
        }
        if style.modifiers.bold {
            write!(css, " font-weight: bold;").unwrap();
        }
        if style.modifiers.italic {
            write!(css, " font-style: italic;").unwrap();
        }

        writeln!(css, " }}").unwrap();
    }

    writeln!(css, "}}").unwrap();
    css
}

/// Mirrors `arborium_theme::Theme::to_css`'s style resolution: use the
/// slot's own style if non-empty, else fall back to the style indexed by the
/// slot's `parent_tag`. Returns `None` if neither produces a non-empty
/// style — those slots are skipped entirely.
fn resolve_style(theme: &Theme, idx: usize) -> Option<Style> {
    let def = &HIGHLIGHTS[idx];
    let own = &theme.styles[idx];
    if !own.is_empty() {
        return Some(own.clone());
    }
    if def.parent_tag.is_empty() {
        return None;
    }
    let parent_idx = HIGHLIGHTS.iter().position(|d| d.tag == def.parent_tag)?;
    let parent = &theme.styles[parent_idx];
    if parent.is_empty() {
        None
    } else {
        Some(parent.clone())
    }
}
