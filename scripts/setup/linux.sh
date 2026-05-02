#!/bin/bash

set -e

echo "Setting up Athas development environment for Linux..."

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'
REQUIRED_ZIG_VERSION="0.16.0"

print_status() { echo -e "${BLUE}[INFO]${NC} $1"; }
print_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
print_error() { echo -e "${RED}[ERROR]${NC} $1"; }

detect_distro() {
    local os_id=""
    local os_like=""

    if [[ -f /etc/os-release ]]; then
        os_id="$(. /etc/os-release && echo "${ID:-}")"
        os_like="$(. /etc/os-release && echo "${ID_LIKE:-}")"
    fi

    if [[ "$os_id" == "chimera" ]]; then
        DISTRO="chimera"
    elif [[ "$os_id" == "alpine" || "$os_like" == *"alpine"* ]]; then
        DISTRO="alpine"
    elif command -v apt-get &> /dev/null; then
        DISTRO="ubuntu"
    elif command -v dnf &> /dev/null; then
        DISTRO="fedora"
    elif command -v pacman &> /dev/null; then
        DISTRO="arch"
    elif command -v zypper &> /dev/null; then
        DISTRO="opensuse"
    else
        DISTRO="unknown"
    fi
}

detect_libc() {
    LIBC="unknown"

    if ldd --version 2>&1 | grep -qi "musl"; then
        LIBC="musl"
    elif ldd --version 2>&1 | grep -Eqi "glibc|GNU libc"; then
        LIBC="glibc"
    elif ls /lib/ld-musl-*.so.1 /usr/lib/ld-musl-*.so.1 >/dev/null 2>&1; then
        LIBC="musl"
    fi
}

command_exists() {
    command -v "$1" &> /dev/null
}

version_at_least() {
    local current="$1"
    local minimum="$2"

    if [[ -z "$current" ]]; then
        return 1
    fi

    [[ "$(printf '%s\n%s\n' "$minimum" "$current" | sort -V | head -n1)" == "$minimum" ]]
}

get_zig_version() {
    if ! command_exists zig; then
        return 1
    fi

    zig version 2>/dev/null | grep -Eo '[0-9]+(\.[0-9]+){1,3}' | head -n1
}

install_system_deps() {
    print_status "Installing system dependencies for $DISTRO..."

    case $DISTRO in
        "ubuntu")
            sudo apt-get update
            sudo apt-get install -y build-essential curl wget file xz-utils libssl-dev libgtk-3-dev libwebkit2gtk-4.1-dev libsoup-3.0-dev libayatana-appindicator3-dev librsvg2-dev pkg-config
            # Deps for git2 and ssh2
            sudo apt-get install -y libssl-dev pkgconf perl
            ;;
        "fedora")
            sudo dnf install -y gcc gcc-c++ make curl wget file xz openssl-devel gtk3-devel webkit2gtk4.1-devel libsoup3-devel libayatana-appindicator-gtk3-devel librsvg2-devel pkgconf-pkg-config
            # Deps for git2 and ssh2
            sudo dnf install -y openssl-devel pkgconf perl-FindBin perl-IPC-Cmd perl
            ;;
        "arch")
            sudo pacman -S --needed --noconfirm base-devel curl wget file xz openssl gtk3 webkit2gtk-4.1 libsoup3 libayatana-appindicator librsvg pkgconf
            # Deps for git2 and ssh2
            sudo pacman -S --needed --noconfirm openssl pkgconf perl
            ;;
        "opensuse")
            sudo zypper install -y gcc gcc-c++ make curl wget file xz libopenssl-devel gtk3-devel webkit2gtk3-devel libsoup3-devel libayatana-appindicator3-devel librsvg-devel pkg-config
            # Deps for git2 and ssh2
            sudo zypper install -y openssl-devel pkgconf perl-FindBin perl-IPC-Cmd perl
            ;;
        "chimera"|"alpine")
            print_error "$DISTRO uses musl libc. This development setup script does not yet know the correct WebKitGTK/Tauri dependency set for this distribution."
            print_error "Athas-managed tool downloads must use statically linked binaries or unknown-linux-musl assets on this system."
            exit 1
            ;;
        *)
            print_error "Unsupported Linux distribution: $DISTRO"
            exit 1
            ;;
    esac

    print_success "System dependencies installed successfully"
}

install_zig_with_package_manager() {
    case $DISTRO in
        "ubuntu")
            sudo apt-get install -y zig
            ;;
        "fedora")
            sudo dnf install -y zig
            ;;
        "arch")
            sudo pacman -S --needed --noconfirm zig
            ;;
        "opensuse")
            sudo zypper install -y zig
            ;;
        *)
            return 1
            ;;
    esac
}

install_zig_from_archive() {
    local machine
    local zig_target
    local install_root
    local install_dir
    local archive_dir
    local archive_url
    local temp_dir

    machine="$(uname -m)"
    case "$machine" in
        "x86_64")
            zig_target="x86_64-linux"
            ;;
        "aarch64"|"arm64")
            zig_target="aarch64-linux"
            ;;
        *)
            print_error "Unsupported architecture for Zig install: $machine"
            return 1
            ;;
    esac

    install_root="$HOME/.local/share/athas-dev/zig"
    install_dir="$install_root/$REQUIRED_ZIG_VERSION"
    archive_dir="zig-$zig_target-$REQUIRED_ZIG_VERSION"
    archive_url="https://ziglang.org/download/$REQUIRED_ZIG_VERSION/$archive_dir.tar.xz"
    temp_dir="$(mktemp -d)"

    print_status "Downloading Zig $REQUIRED_ZIG_VERSION from ziglang.org..."
    curl -fL "$archive_url" -o "$temp_dir/zig.tar.xz"

    rm -rf "$install_dir"
    mkdir -p "$install_root" "$HOME/.local/bin"
    tar -xJf "$temp_dir/zig.tar.xz" -C "$install_root"
    mv "$install_root/$archive_dir" "$install_dir"
    ln -sfn "$install_dir/zig" "$HOME/.local/bin/zig"
    export PATH="$HOME/.local/bin:$PATH"
    rm -rf "$temp_dir"
}

install_zig() {
    local zig_version

    zig_version="$(get_zig_version || true)"
    if version_at_least "$zig_version" "$REQUIRED_ZIG_VERSION"; then
        print_success "Zig is already installed (v$zig_version)"
        return
    fi

    print_status "Installing Zig $REQUIRED_ZIG_VERSION+..."
    if ! install_zig_with_package_manager; then
        print_warning "Could not install Zig with the system package manager."
    fi

    zig_version="$(get_zig_version || true)"
    if version_at_least "$zig_version" "$REQUIRED_ZIG_VERSION"; then
        print_success "Zig is ready (v$zig_version)"
        return
    fi

    print_warning "System package manager did not provide Zig $REQUIRED_ZIG_VERSION+."
    install_zig_from_archive

    zig_version="$(get_zig_version || true)"
    if ! version_at_least "$zig_version" "$REQUIRED_ZIG_VERSION"; then
        print_error "Zig $REQUIRED_ZIG_VERSION+ is required, but setup could not verify the installed version."
        exit 1
    fi

    print_success "Zig is ready (v$zig_version)"
}

install_rust() {
    if command_exists rustc && command_exists cargo; then
        print_success "Rust is already installed ($(rustc --version))"
    else
        print_status "Installing Rust..."
        curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable
        source ~/.cargo/env
        print_success "Rust installed successfully"
    fi
}

install_tauri_cli() {
    source ~/.cargo/env 2>/dev/null || true
    export PATH="$HOME/.cargo/bin:$PATH"

    print_status "Installing Tauri CLI..."
    cargo install tauri-cli --locked 2>/dev/null || true

    if [ -f "$HOME/.cargo/bin/tauri" ]; then
        print_success "Tauri CLI installed successfully"
    else
        print_warning "Tauri CLI installation may have failed, but continuing..."
    fi
}

install_bun() {
    if command_exists bun; then
        print_success "Bun is already installed (v$(bun --version))"
    else
        print_status "Installing Bun..."
        curl -fsSL https://bun.sh/install | bash
        export PATH="$HOME/.bun/bin:$PATH"
        print_success "Bun installation completed"
    fi
}

install_project_deps() {
    print_status "Installing project dependencies..."

    export PATH="$HOME/.bun/bin:$PATH"

    if command_exists bun; then
        bun install
        print_success "Dependencies installed with Bun"
    else
        print_warning "Package manager not found, but continuing..."
    fi
}

verify_basic() {
    print_status "Basic verification..."

    if pkg-config --exists javascriptcoregtk-4.1 2>/dev/null && pkg-config --exists libsoup-3.0 2>/dev/null; then
        print_success "Required system libraries found"
    else
        print_error "Required system libraries missing"
        return 1
    fi

    if [ -f "$HOME/.cargo/bin/tauri" ] || command_exists tauri; then
        print_success "Tauri CLI found"
    else
        print_warning "Tauri CLI not found, but may work after restart"
    fi

    local zig_version
    zig_version="$(get_zig_version || true)"
    if version_at_least "$zig_version" "$REQUIRED_ZIG_VERSION"; then
        print_success "Zig found (v$zig_version)"
    else
        print_error "Zig $REQUIRED_ZIG_VERSION+ missing"
        return 1
    fi

    return 0
}

main() {
    print_status "Starting Athas development environment setup..."

    if [[ "$OSTYPE" != linux* ]]; then
        print_error "This script is designed for Linux only."
        exit 1
    fi

    detect_distro
    print_status "Detected distribution: $DISTRO"
    detect_libc
    print_status "Detected libc: $LIBC"

    install_system_deps
    install_zig
    install_rust
    install_tauri_cli
    install_bun
    install_project_deps
    verify_basic

    print_success "Setup complete!"
    print_status "To start development:"
    echo -e "  ${GREEN}source ~/.zshrc${NC}     - Reload shell environment"
    echo -e "  ${GREEN}bun run tauri dev${NC}   - Start development server"
    echo ""
    print_warning "If 'tauri' command not found, restart your terminal first"
}

main "$@"
