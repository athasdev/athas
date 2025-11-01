# Linux Development Setup

## Quick Setup (Recommended)

Use the automated setup script:

```bash
bun setup
```

## Manual Setup

### Prerequisites

1. **Install Bun**: Visit [bun.sh](https://bun.sh) for installation instructions
2. **Install Rust**: Visit [rustup.rs](https://rustup.rs) for installation instructions

**Additional Packages**

When installing `git2` and `ssh2` crates using `vendored-openssl` features, there are additional packages you may need to prevent installation failure

This one's for Fedora, but the packages should be the same for other distros
```sh
sudo dnf install openssl-devel pkgconf perl-FindBin perl-IPC-Cmd perl
```

### Setup

```bash
# Install project dependencies
bun install

# Start development server
bun tauri dev
```
