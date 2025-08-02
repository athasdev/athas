Set-StrictMode -Version Latest

function Write-Status {
    param([string]$Message)
    Write-Host "[INFO] $Message" -ForegroundColor Blue
}

function Write-Success {
    param([string]$Message)
    Write-Host "[SUCCESS] $Message" -ForegroundColor Green
}

function Write-Warning {
    param([string]$Message)
    Write-Host "[WARNING] $Message" -ForegroundColor Yellow
}

function Write-Error {
    param([string]$Message)
    Write-Host "[ERROR] $Message" -ForegroundColor Red
}

function Command-Exists {
    param([string]$Command)
    return (Get-Command $Command -ErrorAction SilentlyContinue)
}


function Install-VSBuildTools {
    Write-Status "Checking for Microsoft C++ Build Tools..."
    $vsWherePath = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
    if (Test-Path $vsWherePath) {
        $vsInstallations = & $vsWherePath -property installationPath
        if ($vsInstallations) {
            Write-Success "Visual Studio Build Tools appear to be installed."
            return
        }
    }

    Write-Status "Installing Microsoft C++ Build Tools..."
    Write-Warning "This will launch a new window. Please install the 'Desktop development with C++' workload."
    Invoke-WebRequest -Uri "https://aka.ms/vs/17/release/vs_BuildTools.exe" -OutFile "vs_BuildTools.exe"
    Start-Process -FilePath ".\vs_BuildTools.exe" -ArgumentList "--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --wait" -Wait
    Remove-Item "vs_BuildTools.exe"
    Write-Success "Microsoft C++ Build Tools installation process completed."
}

function Check-WebView2 {
    Write-Status "Checking for WebView2 Runtime..."
    $webView2Path = "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
    if (Test-Path $webView2Path) {
        Write-Success "WebView2 Runtime is already installed."
    } else {
        Write-Warning "WebView2 Runtime not found. Tauri will attempt to install it on the first run if needed."
    }
}

function Install-Rust {
    if (Command-Exists "rustc") {
        $version = rustc --version
        Write-Success "Rust is already installed ($version)"
    } else {
        Write-Status "Installing Rust..."
        Invoke-WebRequest -Uri "https://win.rustup.rs/x86_64" -OutFile "rustup-init.exe"
        .\rustup-init.exe -y --default-toolchain stable
        $env:Path += ";$env:USERPROFILE\.cargo\bin"
        Remove-Item "rustup-init.exe"
        Write-Success "Rust installed successfully."
    }
}

function Install-TauriCLI {
    Write-Status "Installing Tauri CLI..."
    cargo install tauri-cli --locked
    if (Command-Exists "tauri") {
        Write-Success "Tauri CLI installed successfully."
    } else {
        Write-Warning "Tauri CLI installation may have failed. Please ensure '$env:USERPROFILE\.cargo\bin' is in your PATH."
    }
}

function Install-Bun {
    if (Command-Exists "bun") {
        $version = bun --version
        Write-Success "Bun is already installed (v$version)"
    } else {
        Write-Status "Installing Bun..."
        powershell -c "irm https://bun.sh/install.ps1 | iex"
        $env:Path += ";$env:USERPROFILE\.bun\bin"
        Write-Success "Bun installation completed."
    }
}

function Install-Node {
    if (Command-Exists "node") {
        $nodeVersion = (node --version).Substring(1)
        if ([version]$nodeVersion -ge [version]"18.0.0") {
            Write-Success "Node.js is already installed ($(node --version))"
            return
        }
    }

    Write-Status "Installing Node.js LTS via nvm-windows..."
    Invoke-WebRequest -Uri "https://github.com/coreybutler/nvm-windows/releases/latest/download/nvm-setup.zip" -OutFile "nvm-setup.zip"
    Expand-Archive -Path "nvm-setup.zip" -DestinationPath ".\nvm-installer"
    Start-Process -FilePath ".\nvm-installer\nvm-setup.exe" -Wait
    Remove-Item "nvm-setup.zip" -Recurse
    Remove-Item "nvm-installer" -Recurse

    Write-Success "NVM for Windows installed. Please run 'nvm install lts' and 'nvm use lts' in a new terminal."
}

# 7. Install Project Dependencies
function Install-ProjectDeps {
    Write-Status "Installing project dependencies..."
    if (Command-Exists "bun") {
        bun install
        Write-Success "Dependencies installed with Bun."
    } elseif (Command-Exists "npm") {
        npm install
        Write-Success "Dependencies installed with npm."
    } else {
        Write-Warning "Package manager not found, but continuing..."
    }
}

function main {
    Write-Status "Starting Athas development environment setup..."

    if ($env:OS -ne "Windows_NT") {
        Write-Error "This script is designed for Windows only."
        exit 1
    }

    Install-VSBuildTools
    Check-WebView2
    Install-Rust
    Install-TauriCLI
    Install-Bun
    Install-ProjectDeps

    Write-Success "🎉 Setup complete!"
    Write-Status "To start development:"
    Write-Host "  bun run tauri dev" -ForegroundColor Green
    echo ""
    Write-Warning "If 'tauri' or 'bun' commands are not found, please restart your terminal."
}

main
