# Windows Development Setup

This guide covers the setup process for Windows developers.

---

## Quick Start

For experienced developers familiar with Rust on Windows, the process is straightforward.

### Prerequisites

1.  **Install Bun**: Visit [bun.sh](https://bun.sh) for installation instructions.
2.  **Install Rust**: Visit [rustup.rs](https://rustup.rs) for installation instructions. Ensure you have the `msvc` toolchain and necessary C++ build tools.

### Setup

```cmd
# Install project dependencies
bun install

# Start development server
bun run tauri dev
```

---

## Detailed Windows Setup Guide

If you are new to Rust development on Windows or encounter build errors, follow these steps carefully.

### Mandatory Prerequisites

Building a Tauri application on Windows requires more than just Rust and Bun. You must have the correct build environment.

1.  **Microsoft C++ Build Tools**:
    *   This is the most common source of build failures. The Rust `msvc` toolchain depends on Microsoft's linker (`link.exe`).
    *   Go to the [Visual Studio download page](https://visualstudio.microsoft.com/downloads/).
    *   Under "All downloads" -> "Tools for Visual Studio", find and run the **Build Tools for Visual Studio**.
    *   In the installer, select the "**Desktop development with C++**" workload and click "Install".

2.  **WebView2 Runtime**:
    *   Tauri uses the WebView2 runtime to render the UI. Modern Windows versions usually have it pre-installed.
    *   If the application fails to launch, you may need to [download and install it from the official Microsoft page](https://developer.microsoft.com/en-us/microsoft-edge/webview2/).

3.  **Rust**:
    *   Install Rust via `rustup` from [rustup.rs](https://rustup.rs). The default `x86_64-pc-windows-msvc` toolchain is correct.

4.  **Bun**:
    *   Install the Bun runtime from [bun.sh](https://bun.sh).

### Important: Running Build Commands

**Warning: Avoid using Git Bash (MINGW64)**

Using a MINGW64 terminal (like Git Bash) with the Rust `msvc` toolchain will likely cause linker errors.

**Example Error:**
```text
error: linking with link.exe failed: exit code: 1
...
note: link: extra operand 'C:\Users\...\some-file.o'
```

This happens because of a shell mismatch that confuses the MSVC linker.

**Correct Approach: Use the Developer Command Prompt**

To ensure a stable build environment, **always** run `cargo` or `bun run tauri dev` commands from the correct terminal:

1.  Press the `Windows` key.
2.  Type `Developer Command Prompt` in the search bar.
3.  Select **Developer Command Prompt for VS 2022** (or your version).
4.  Run the setup commands inside this prompt.

```cmd
# Inside the Developer Command Prompt

# Install project dependencies
bun install

# Start development server
bun run tauri dev
```