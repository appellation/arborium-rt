#!/usr/bin/env bash
#
# Apply local patches to the upstream arborium submodule.
#
# Run this once after:
#   - cloning the repo fresh (with --recurse-submodules)
#   - bumping the submodule pointer
#   - pulling a branch update that changed either the patches or the submodule
#
# Idempotent: if patches are already applied, it no-ops. If upstream has
# moved in a way that makes a patch fail to apply, `git am` below will
# error and leave the submodule in a partially-applied state; bail out
# manually with `git -C third_party/arborium am --abort` and investigate.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARBORIUM="${REPO_ROOT}/third_party/arborium"
PATCHES_DIR="${REPO_ROOT}/patches"

if [[ ! -d "${ARBORIUM}/.git" && ! -f "${ARBORIUM}/.git" ]]; then
    echo "error: submodule not checked out at ${ARBORIUM}" >&2
    echo "       run: git submodule update --init --recursive" >&2
    exit 1
fi

# Reset the submodule to its pinned commit before applying patches. Using
# `git submodule update --init --force` re-reads the pinned SHA from this
# repo's tree so re-runs never stack patches on top of previously-applied
# ones (git am creates commits; without this reset, those would be
# load-bearing).
echo "==> resetting submodule to its pinned commit"
git -C "${REPO_ROOT}" submodule update --init --force third_party/arborium >/dev/null
git -C "${ARBORIUM}" clean -fd >/dev/null

# git am consumes mbox-formatted patches (which is what `git format-patch`
# produces). It applies each patch as a commit in the submodule's history,
# leaving working-tree state suitable for Cargo path-dep consumption.
for patch in "${PATCHES_DIR}"/*.patch; do
    echo "==> applying $(basename "${patch}")"
    git -C "${ARBORIUM}" am --keep-cr <"${patch}"
done

# Arborium's `crates/*/Cargo.toml` files are gitignored and generated from
# `Cargo.stpl.toml` templates by `xtask gen`. Each template just needs
# `<%= version %>` substituted. We don't need the full xtask pipeline
# (grammar codegen, plugin crates, etc.) — just the shared-crate manifests.
# Pick a stable local version so cargo's dep resolver is deterministic.
RENDER_VERSION="0.0.0-arborium-rt"
echo "==> rendering Cargo.toml from Cargo.stpl.toml (version ${RENDER_VERSION})"
for stpl in "${ARBORIUM}/crates/"*/Cargo.stpl.toml; do
    out="${stpl%.stpl.toml}.toml"
    sed "s/<%= version %>/${RENDER_VERSION}/g" "${stpl}" >"${out}"
done

echo "==> bootstrap complete. Patched submodule HEAD:"
git -C "${ARBORIUM}" log --oneline -3
