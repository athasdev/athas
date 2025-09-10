#!/bin/bash

set -e

echo "🚀 Setting up Athas development environment for Linux..."

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_status() { echo -e "${BLUE}[INFO]${NC} $1"; }
print_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
print_error() { echo -e "${RED}[ERROR]${NC} $1"; }

detect_distro() {
    if command -v apt-get &> /dev/null; then
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

command_exists() {
    command -v "$1" &> /dev/null
}

install_system_deps() {
    print_status "Installing system dependencies for $DISTRO..."

    case $DISTRO in
        "ubuntu")
            sudo apt update
            sudo apt install -y build-essential curl wget file libssl-dev libgtk-3-dev libwebkit2gtk-4.1-dev libsoup-3.0-dev libayatana-appindicator3-dev librsvg2-dev pkg-config
            # Deps for git2 and ssh2
            sudo apt install -y openssl-devel pkgconf perl-FindBin perl-IPC-Cmd perl
            ;;
        "fedora")
            sudo dnf install -y gcc gcc-c++ make curl wget file openssl-devel gtk3-devel webkit2gtk4.1-devel libsoup3-devel libayatana-appindicator-gtk3-devel librsvg2-devel pkgconf-pkg-config
            # Deps for git2 and ssh2
            sudo dnf install -y openssl-devel pkgconf perl-FindBin perl-IPC-Cmd perl
            ;;
        "arch")
            sudo pacman -S --needed --noconfirm base-devel curl wget file openssl gtk3 webkit2gtk-4.1 libsoup3 libayatana-appindicator librsvg pkgconf
            # Deps for git2 and ssh2
            sudo pacman -S --needed --noconfirm openssl-devel pkgconf perl-FindBin perl-IPC-Cmd perl
            ;;
        "opensuse")
            sudo zypper install -y gcc gcc-c++ make curl wget file libopenssl-devel gtk3-devel webkit2gtk3-devel libsoup3-devel libayatana-appindicator3-devel librsvg-devel pkg-config
            # Deps for git2 and ssh2
            sudo zypper install -y openssl-devel pkgconf perl-FindBin perl-IPC-Cmd perl
            ;;
        *)
            print_error "Unsupported Linux distribution: $DISTRO"
            exit 1
            ;;
    esac

    print_success "System dependencies installed successfully"
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

    return 0
}

main() {
    print_status "Starting Athas development environment setup..."

    if [[ "$OSTYPE" != "linux-gnu"* ]]; then
        print_error "This script is designed for Linux only."
        exit 1
    fi

    detect_distro
    print_status "Detected distribution: $DISTRO"

    install_system_deps
    install_rust
    install_tauri_cli
    install_bun
    install_project_deps
    verify_basic

    print_success "🎉 Setup complete!"
    print_status "To start development:"
    echo -e "  ${GREEN}source ~/.zshrc${NC}     - Reload shell environment"
    echo -e "  ${GREEN}bun run tauri dev${NC}   - Start development server"
    echo ""
    print_warning "If 'tauri' command not found, restart your terminal first"
}

main "$@"
