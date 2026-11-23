#!/bin/bash
set -e

# Forgitten Installer for macOS and Linux
# Usage: curl -fsSL https://raw.githubusercontent.com/orchard-suite/forgitten/main/install.sh | bash
# Uninstall: curl -fsSL https://raw.githubusercontent.com/orchard-suite/forgitten/main/install.sh | bash -s -- --uninstall

REPO="orchard-suite/forgitten"
BINARY_NAME="forgitten"
INSTALL_DIR="${INSTALL_DIR:-/usr/local/bin}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

info() { echo -e "${GREEN}[INFO]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1" >&2; exit 1; }

# Detect OS
detect_os() {
    case "$(uname -s)" in
        Darwin*) echo "osx" ;;
        Linux*)  echo "linux" ;;
        *)       error "Unsupported OS: $(uname -s)" ;;
    esac
}

# Detect architecture
detect_arch() {
    case "$(uname -m)" in
        x86_64|amd64)  echo "x64" ;;
        arm64|aarch64) echo "arm64" ;;
        *)             error "Unsupported architecture: $(uname -m)" ;;
    esac
}

# Get latest release version from GitHub
get_latest_version() {
    curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" 2>/dev/null | \
        grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/'
}

sha256() {
    if command -v sha256sum &> /dev/null; then
        sha256sum "$1" | cut -d' ' -f1
    elif command -v shasum &> /dev/null; then
        shasum -a 256 "$1" | cut -d' ' -f1
    else
        error "Neither sha256sum nor shasum is installed, so the download cannot be checked."
    fi
}

# Uninstall
uninstall() {
    info "Uninstalling ${BINARY_NAME}..."

    if [ -f "${INSTALL_DIR}/${BINARY_NAME}" ]; then
        if [ -w "${INSTALL_DIR}" ]; then
            rm -f "${INSTALL_DIR}/${BINARY_NAME}"
        else
            sudo rm -f "${INSTALL_DIR}/${BINARY_NAME}"
        fi
        info "Removed ${INSTALL_DIR}/${BINARY_NAME}"
    else
        warn "${BINARY_NAME} not found in ${INSTALL_DIR}"
    fi

    info "Uninstall complete"
    exit 0
}

# Install
install() {
    local os arch version
    os=$(detect_os)
    arch=$(detect_arch)
    version="${VERSION:-$(get_latest_version)}"

    if [ -z "$version" ]; then
        error "Could not determine latest version. Set VERSION env var or check GitHub releases."
    fi

    info "Installing ${BINARY_NAME} ${version} for ${os}-${arch}..."

    # Construct download URL
    local asset_name="${BINARY_NAME}-${os}-${arch}"
    local release_url="https://github.com/${REPO}/releases/download/${version}"

    # Create temp directory
    local tmp_dir
    tmp_dir=$(mktemp -d)
    # Expanded now on purpose: tmp_dir is local and gone by the time EXIT fires.
    # shellcheck disable=SC2064
    trap "rm -rf '${tmp_dir}'" EXIT

    # Download binary
    info "Downloading from ${release_url}/${asset_name}..."
    if ! curl -fsSL -o "${tmp_dir}/${BINARY_NAME}" "${release_url}/${asset_name}"; then
        error "Download failed. Check that release ${version} exists with asset ${asset_name}."
    fi

    # Check it against the checksums published with the release
    if ! curl -fsSL -o "${tmp_dir}/SHA256SUMS" "${release_url}/SHA256SUMS"; then
        error "Release ${version} has no SHA256SUMS, so the download cannot be checked."
    fi
    local expected
    expected=$(awk -v name="${asset_name}" '$2 == name || $2 == "*" name { print $1 }' "${tmp_dir}/SHA256SUMS")
    if [ -z "$expected" ]; then
        error "SHA256SUMS for ${version} does not list ${asset_name}."
    fi
    local actual
    actual=$(sha256 "${tmp_dir}/${BINARY_NAME}")
    if [ "$actual" != "$expected" ]; then
        error "Checksum mismatch for ${asset_name}: expected ${expected}, got ${actual}. Nothing was installed."
    fi
    info "Checksum verified"

    # Make executable
    chmod +x "${tmp_dir}/${BINARY_NAME}"

    # Install to target directory
    info "Installing to ${INSTALL_DIR}/${BINARY_NAME}..."
    if [ -w "${INSTALL_DIR}" ]; then
        mv "${tmp_dir}/${BINARY_NAME}" "${INSTALL_DIR}/${BINARY_NAME}"
    else
        sudo mv "${tmp_dir}/${BINARY_NAME}" "${INSTALL_DIR}/${BINARY_NAME}"
    fi

    # Verify installation
    if command -v "${BINARY_NAME}" &> /dev/null; then
        info "Installation complete!"
        info "Run '${BINARY_NAME} --help' to get started"
    else
        warn "Installed to ${INSTALL_DIR}/${BINARY_NAME}"
        warn "Make sure ${INSTALL_DIR} is in your PATH"
    fi
}

# Main
main() {
    case "${1:-}" in
        --uninstall|-u)
            uninstall
            ;;
        --help|-h)
            echo "Forgitten Installer"
            echo ""
            echo "Usage:"
            echo "  Install:   curl -fsSL <url>/install.sh | bash"
            echo "  Uninstall: curl -fsSL <url>/install.sh | bash -s -- --uninstall"
            echo ""
            echo "Environment variables:"
            echo "  VERSION     - Specific version to install (default: latest)"
            echo "  INSTALL_DIR - Installation directory (default: /usr/local/bin)"
            ;;
        *)
            install
            ;;
    esac
}

main "$@"
