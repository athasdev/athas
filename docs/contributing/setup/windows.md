# Windows Development Setup

## Quick Setup (Recommended)

Use the automated setup script (runs as Administrator):

```powershell
bun setup
```

This script automatically installs Microsoft C++ Build Tools, checks for WebView2, installs Rust, Bun, and project dependencies.

## Manual Setup

### Prerequisites

1. **Microsoft C++ Build Tools**
   - Download and install [Visual Studio 2022 Build Tools](https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022) or [Visual Studio Community](https://visualstudio.microsoft.com/downloads/)
   - During installation, select the "Desktop development with C++" workload
   - This is required for the MSVC toolchain to compile Rust and Tauri applications

2. **WebView2 Runtime**
   - Pre-installed on Windows 10 (version 1803+) and Windows 11
   - If not installed, download from [Microsoft Edge WebView2](https://developer.microsoft.com/microsoft-edge/webview2/)
   - Required by Tauri for rendering the web interface

3. **Rust**
   - Install from [rustup.rs](https://rustup.rs)
   - Ensure you install the MSVC toolchain (default on Windows)
   - The GNU toolchain is not supported for this project

4. **Bun**
   - Install from [bun.sh](https://bun.sh)

5. **Perl**
   - Install from [perl.org](https://www.perl.org) or [Strawberry Perl](https://strawberryperl.com/)
   - Required for compiling OpenSSL dependencies used by `git2` and `ssh2` crates

### Important: Terminal Environment

Use native Windows terminals for building the project:
- PowerShell (recommended)
- Command Prompt
- Windows Terminal
- Developer Command Prompt for Visual Studio (optional)

**Do NOT use MINGW64, Git Bash, or WSL** when building with the MSVC toolchain. These environments can cause linker errors and path resolution issues.

### Setup

```powershell
# Install project dependencies
bun install

# Start development server
bun dev

# Start with react-scan (tracks re-renders)
bun dev:scan
```

### Troubleshooting

**Build fails with linker errors:**
- Ensure you're using a native Windows terminal (PowerShell/CMD), not Git Bash
- Verify Visual Studio Build Tools are installed with C++ workload
- Try running from Developer Command Prompt for Visual Studio

**"WebView2 not found" error:**
- Download and install from [Microsoft Edge WebView2](https://developer.microsoft.com/microsoft-edge/webview2/)
- Restart your terminal after installation

**OpenSSL compilation errors:**
- Ensure Perl is installed and available in PATH
- Try reinstalling Perl or using Strawberry Perl
