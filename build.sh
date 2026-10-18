#!/usr/bin/env bash
set -euo pipefail

# Build Orion's Linux packages in Podman without clearing existing platform artifacts.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"
if command -v cygpath >/dev/null 2>&1; then
  PODMAN_ROOT_DIR="$(cygpath -m "$ROOT_DIR")"
else
  PODMAN_ROOT_DIR="$ROOT_DIR"
fi
command -v bun >/dev/null || { echo "build.sh requires Bun 1.4.3 or newer." >&2; exit 1; }
VERSION="$(bun -e "console.log(require('./package.json').version)")"
RELEASE_DIR="$ROOT_DIR/release/$VERSION"
STAGING_DIR="$ROOT_DIR/.release-staging-$VERSION-$(date +%s)-$$"
STAGING_NAME="$(basename "$STAGING_DIR")"
IMAGE="${ORION_BUILDER_IMAGE:-docker.io/electronuserland/builder:wine}"

command -v podman >/dev/null || { echo "build.sh requires Podman." >&2; exit 1; }
[[ -n "$VERSION" ]] || { echo "Could not determine the package version." >&2; exit 1; }
rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR" "$RELEASE_DIR/appimage" "$RELEASE_DIR/deb" "$RELEASE_DIR/rpm" "$RELEASE_DIR/exe"

echo "Building Orion $VERSION Linux packages in Podman ($IMAGE)…"
MSYS_NO_PATHCONV=1 podman run --rm --cgroups=disabled --userns=keep-id \
  -e HOME=/tmp/orion-home \
  -e ORION_STAGING_NAME="$STAGING_NAME" \
  -v "$PODMAN_ROOT_DIR:/workspace:Z" \
  -w /workspace \
  "$IMAGE" bash -lc '
    set -euo pipefail
    export HOME=/tmp/orion-home
    mkdir -p "$HOME"
    curl -fsSL https://bun.com/install | bash -s "bun-v1.4.3"
    export PATH="$HOME/.bun/bin:$PATH"
    bun install --frozen-lockfile
    bun run build
    bunx --bun electron-builder --linux AppImage deb rpm --x64 --publish never \
      --config.directories.output="/workspace/$ORION_STAGING_NAME"
  '

shopt -s nullglob
for artifact in "$STAGING_DIR"/*; do
  case "$artifact" in
    *.AppImage) mv "$artifact" "$RELEASE_DIR/appimage/" ;;
    *.deb) mv "$artifact" "$RELEASE_DIR/deb/" ;;
    *.rpm) mv "$artifact" "$RELEASE_DIR/rpm/" ;;
  esac
done
shopt -u nullglob
rm -rf "$STAGING_DIR"
for directory in appimage deb rpm; do
  find "$RELEASE_DIR/$directory" -maxdepth 1 -type f -print -quit | grep -q . || {
    echo "No artifact was produced for $directory." >&2
    exit 1
  }
done
echo "Linux release artifacts written under $RELEASE_DIR"
find "$RELEASE_DIR" -maxdepth 2 -type f -printf '%P\n' | sort
