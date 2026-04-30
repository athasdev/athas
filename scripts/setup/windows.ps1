Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$MinimumNodeVersion = [version]"22.0.0"
$MinimumBunVersion = [version]"1.3.2"
$MinimumRustVersion = [version]"1.80.0"
$MinimumZigVersion = [version]"0.16.0"
$NodeWingetId = "OpenJS.NodeJS.22"
$BunWingetId = "Oven-sh.Bun"
$RustupWingetId = "Rustlang.Rustup"
$ZigWingetId = "zig.zig"
$PerlWingetId = "StrawberryPerl.StrawberryPerl"
$LlvmWingetId = "LLVM.LLVM"
$UserBinPaths = @(
    "$env:USERPROFILE\.cargo\bin",
    "$env:USERPROFILE\.bun\bin",
    "$env:LOCALAPPDATA\Programs\Zig",
    "$env:LOCALAPPDATA\Programs\Zig\0.16.0",
    "C:\Strawberry\perl\bin",
    "C:\Program Files\LLVM\bin"
)

function Write-Status {
    param([string]$Message)
    Write-Host "[INFO] $Message" -ForegroundColor Blue
}

function Write-Success {
    param([string]$Message)
    Write-Host "[SUCCESS] $Message" -ForegroundColor Green
}

function Write-WarningStatus {
    param([string]$Message)
    Write-Host "[WARNING] $Message" -ForegroundColor Yellow
}

function Write-Failure {
    param([string]$Message)
    Write-Host "[ERROR] $Message" -ForegroundColor Red
}

function Command-Exists {
    param([string]$Command)
    return $null -ne (Get-Command $Command -ErrorAction SilentlyContinue)
}

function Parse-Version {
    param([string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return $null
    }

    $match = [regex]::Match($Value, "\d+(\.\d+){1,3}")
    if (-not $match.Success) {
        return $null
    }

    return [version]$match.Value
}

function Test-MinimumVersion {
    param(
        [version]$Current,
        [version]$Minimum
    )

    if ($null -eq $Current) {
        return $false
    }

    return $Current -ge $Minimum
}

function Refresh-ProcessPath {
    $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $combinedPath = @($machinePath, $userPath) -join ";"

    foreach ($binPath in $UserBinPaths) {
        if ([string]::IsNullOrWhiteSpace($binPath)) {
            continue
        }

        if ((Test-Path $binPath) -and ($combinedPath -notlike "*$binPath*")) {
            $combinedPath = "$combinedPath;$binPath"
        }
    }

    $env:Path = $combinedPath
}

function Ensure-UserPathEntry {
    param([string]$PathEntry)

    if (-not (Test-Path $PathEntry)) {
        return
    }

    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $parts = @()
    if (-not [string]::IsNullOrWhiteSpace($userPath)) {
        $parts = $userPath.Split(";") | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    }

    if ($parts -contains $PathEntry) {
        return
    }

    $updatedPath = @($parts + $PathEntry) -join ";"
    [Environment]::SetEnvironmentVariable("Path", $updatedPath, "User")
}

function Ensure-LibclangPath {
    $llvmBinPath = "C:\Program Files\LLVM\bin"
    if (-not (Test-Path (Join-Path $llvmBinPath "clang.dll"))) {
        return
    }

    $current = [Environment]::GetEnvironmentVariable("LIBCLANG_PATH", "User")
    if ($current -ne $llvmBinPath) {
        [Environment]::SetEnvironmentVariable("LIBCLANG_PATH", $llvmBinPath, "User")
    }

    $env:LIBCLANG_PATH = $llvmBinPath
}

function Get-WingetPath {
    $paths = @(
        "$env:LOCALAPPDATA\Microsoft\WindowsApps\winget.exe",
        "winget.exe"
    )

    foreach ($path in $paths) {
        if ($path -eq "winget.exe") {
            $cmd = Get-Command winget.exe -ErrorAction SilentlyContinue
            if ($cmd) {
                return $cmd.Source
            }
            continue
        }

        if (Test-Path $path) {
            return $path
        }
    }

    throw "WinGet was not found. Please install App Installer from Microsoft Store and rerun setup."
}

function Install-WithWinget {
    param(
        [string]$PackageId,
        [string]$DisplayName
    )

    $winget = Get-WingetPath
    Write-Status "Installing $DisplayName with WinGet..."
    & $winget install --id $PackageId --exact --accept-package-agreements --accept-source-agreements
    Refresh-ProcessPath
    Write-Success "$DisplayName installation completed."
}

function Get-NodeVersion {
    if (-not (Command-Exists "node")) {
        return $null
    }

    return Parse-Version (node --version)
}

function Ensure-Node {
    $nodeVersion = Get-NodeVersion
    if (Test-MinimumVersion $nodeVersion $MinimumNodeVersion) {
        Write-Success "Node.js is already installed (v$nodeVersion)"
        return
    }

    Install-WithWinget -PackageId $NodeWingetId -DisplayName "Node.js 22"

    $nodeVersion = Get-NodeVersion
    if (-not (Test-MinimumVersion $nodeVersion $MinimumNodeVersion)) {
        throw "Node.js 22+ is required, but setup could not verify the installed version."
    }

    Write-Success "Node.js is ready (v$nodeVersion)"
}

function Get-BunVersion {
    if (-not (Command-Exists "bun")) {
        return $null
    }

    return Parse-Version (bun --version)
}

function Ensure-Bun {
    $bunVersion = Get-BunVersion
    if (Test-MinimumVersion $bunVersion $MinimumBunVersion) {
        Write-Success "Bun is already installed (v$bunVersion)"
        return
    }

    Install-WithWinget -PackageId $BunWingetId -DisplayName "Bun"

    $bunVersion = Get-BunVersion
    if (-not (Test-MinimumVersion $bunVersion $MinimumBunVersion)) {
        throw "Bun 1.3.2+ is required, but setup could not verify the installed version."
    }

    Write-Success "Bun is ready (v$bunVersion)"
}

function Get-RustVersion {
    if (-not (Command-Exists "rustc")) {
        return $null
    }

    return Parse-Version (rustc --version)
}

function Ensure-Rust {
    $rustVersion = Get-RustVersion
    if (Test-MinimumVersion $rustVersion $MinimumRustVersion) {
        Write-Success "Rust is already installed (v$rustVersion)"
        return
    }

    Install-WithWinget -PackageId $RustupWingetId -DisplayName "Rustup"
    Refresh-ProcessPath

    if (-not (Command-Exists "rustup")) {
        throw "Rustup was installed but is not available in PATH. Restart your terminal and rerun setup."
    }

    Write-Status "Ensuring the stable Rust toolchain is installed..."
    rustup default stable
    Refresh-ProcessPath

    $rustVersion = Get-RustVersion
    if (-not (Test-MinimumVersion $rustVersion $MinimumRustVersion)) {
        throw "Rust is required, but setup could not verify the installed compiler version."
    }

    Write-Success "Rust is ready (v$rustVersion)"
}

function Get-ZigVersion {
    if (-not (Command-Exists "zig")) {
        return $null
    }

    return Parse-Version (zig version)
}

function Ensure-Zig {
    $zigVersion = Get-ZigVersion
    if (Test-MinimumVersion $zigVersion $MinimumZigVersion) {
        Write-Success "Zig is already installed (v$zigVersion)"
        return
    }

    Install-WithWinget -PackageId $ZigWingetId -DisplayName "Zig"
    Refresh-ProcessPath

    $zigInstallRoot = "$env:LOCALAPPDATA\Programs\Zig"
    $zigExpectedPath = Join-Path $zigInstallRoot "0.16.0"
    Ensure-UserPathEntry -PathEntry $zigInstallRoot
    Ensure-UserPathEntry -PathEntry $zigExpectedPath
    Refresh-ProcessPath

    $zigVersion = Get-ZigVersion
    if (-not (Test-MinimumVersion $zigVersion $MinimumZigVersion)) {
        throw "Zig 0.16.0+ is required, but setup could not verify the installed version."
    }

    Write-Success "Zig is ready (v$zigVersion)"
}

function Ensure-Perl {
    if (Command-Exists "perl") {
        Write-Success "Perl is already installed."
        return
    }

    Install-WithWinget -PackageId $PerlWingetId -DisplayName "Strawberry Perl"
    Ensure-UserPathEntry -PathEntry "C:\Strawberry\perl\bin"
    Refresh-ProcessPath

    if (-not (Command-Exists "perl")) {
        throw "Perl is required, but setup could not find it after installation."
    }

    Write-Success "Perl is ready."
}

function Ensure-Llvm {
    $clangDllPath = "C:\Program Files\LLVM\bin\clang.dll"
    if (Test-Path $clangDllPath) {
        Ensure-UserPathEntry -PathEntry "C:\Program Files\LLVM\bin"
        Ensure-LibclangPath
        Write-Success "LLVM/libclang is already installed."
        return
    }

    Install-WithWinget -PackageId $LlvmWingetId -DisplayName "LLVM"
    Ensure-UserPathEntry -PathEntry "C:\Program Files\LLVM\bin"
    Refresh-ProcessPath
    Ensure-LibclangPath

    if (-not (Test-Path $clangDllPath)) {
        throw "LLVM/libclang is required, but setup could not find clang.dll after installation."
    }

    Write-Success "LLVM/libclang is ready."
}

function Install-VSBuildTools {
    Write-Status "Checking for Microsoft C++ Build Tools..."
    $vsWherePath = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
    if (Test-Path $vsWherePath) {
        $vsInstallation = & $vsWherePath -products * `
            -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
            -property installationPath
        if ($vsInstallation) {
            Write-Success "Visual Studio C++ Build Tools are already installed."
            return
        }
    }

    Write-Status "Installing Microsoft C++ Build Tools..."
    Write-WarningStatus "A Visual Studio installer window may appear. The C++ build tools workload will be installed."
    $installerPath = Join-Path $PWD "vs_BuildTools.exe"
    Invoke-WebRequest -Uri "https://aka.ms/vs/17/release/vs_BuildTools.exe" -OutFile $installerPath
    Start-Process -FilePath $installerPath -ArgumentList @(
        "--wait",
        "--passive",
        "--norestart",
        "--add", "Microsoft.VisualStudio.Workload.VCTools",
        "--includeRecommended"
    ) -Wait
    Remove-Item $installerPath -Force

    if (-not (Test-Path $vsWherePath)) {
        throw "Visual Studio Build Tools installation did not complete correctly."
    }

    $vsInstallation = & $vsWherePath -products * `
        -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
        -property installationPath
    if (-not $vsInstallation) {
        throw "Visual Studio C++ Build Tools are still missing after installation."
    }

    Write-Success "Visual Studio C++ Build Tools are ready."
}

function Check-WebView2 {
    Write-Status "Checking for WebView2 Runtime..."
    $webView2Path = "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
    if (Test-Path $webView2Path) {
        Write-Success "WebView2 Runtime is already installed."
    } else {
        Write-WarningStatus "WebView2 Runtime was not found. Tauri may install it on first run if Windows does not already provide it."
    }
}

function Install-ProjectDeps {
    Write-Status "Installing project dependencies with Bun..."
    $env:BUN_INSTALL_CACHE_DIR = Join-Path $PWD ".bun-cache"
    $env:TEMP = Join-Path $PWD ".tmp"
    $env:TMP = $env:TEMP
    bun install
    Write-Success "Project dependencies installed."
}

function Show-Summary {
    Write-Success "Windows development setup is complete."
    Write-Status "Validated tools:"
    Write-Host "  Node.js $(node --version)"
    Write-Host "  Bun v$(bun --version)"
    Write-Host "  Rust $(rustc --version)"
    Write-Host "  Zig $(zig version)"
    Write-Host "  Perl $(perl -e 'print $^V')"
    Write-Host "  LIBCLANG_PATH=$env:LIBCLANG_PATH"
    Write-Host ""
    Write-Status "Start the app with:"
    Write-Host "  bun dev" -ForegroundColor Green
}

function main {
    Write-Status "Starting Athas Windows development environment setup..."

    if ($env:OS -ne "Windows_NT") {
        Write-Failure "This script is designed for Windows only."
        exit 1
    }

    Refresh-ProcessPath
    Install-VSBuildTools
    Check-WebView2
    Ensure-Node
    Ensure-Bun
    Ensure-Rust
    Ensure-Zig
    Ensure-Perl
    Ensure-Llvm
    Refresh-ProcessPath
    Ensure-LibclangPath
    Install-ProjectDeps
    Show-Summary
}

try {
    main
} catch {
    Write-Failure $_.Exception.Message
    exit 1
}
