param(
    [switch]$SkipWinget,
    [switch]$Interactive,
    [switch]$DryRun,
    [ValidateSet("x64", "arm64")]
    [string]$Architecture,
    [string]$Version,
    [string]$InstallDir,
    [string]$PackageId = "AthasDev.Athas"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Repository = "athasdev/athas"
$ReleaseBaseUrl = "https://github.com/$Repository/releases"
$TempRoot = Join-Path ([System.IO.Path]::GetTempPath()) "athas-installer"

function Write-Status {
    param([string]$Message)
    Write-Host "[INFO] $Message" -ForegroundColor Blue
}

function Write-Success {
    param([string]$Message)
    Write-Host "[SUCCESS] $Message" -ForegroundColor Green
}

function Write-WarningMessage {
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

function Resolve-Architecture {
    if ($Architecture) {
        return $Architecture
    }

    $processorArchitecture = $env:PROCESSOR_ARCHITECTURE
    $wow64Architecture = $env:PROCESSOR_ARCHITEW6432

    if ($processorArchitecture -match "ARM64" -or $wow64Architecture -match "ARM64") {
        return "arm64"
    }

    if ($processorArchitecture -match "AMD64" -or $processorArchitecture -match "x86") {
        return "x64"
    }

    throw "Unsupported Windows architecture: $processorArchitecture"
}

function Get-LatestVersion {
    if ($Version) {
        return $Version.TrimStart("v")
    }

    $latestUrl = "https://api.github.com/repos/$Repository/releases/latest"
    Write-Status "Resolving latest Athas release..."
    $release = Invoke-RestMethod -Uri $latestUrl -Headers @{ "User-Agent" = "athas-installer" }
    return ([string]$release.tag_name).TrimStart("v")
}

function Invoke-Download {
    param(
        [string]$Uri,
        [string]$OutFile
    )

    if ($DryRun) {
        Write-Status "Dry run: would download $Uri"
        Write-Status "Dry run: target path $OutFile"
        return
    }

    if (Command-Exists "curl.exe") {
        & curl.exe --fail --location --show-error --output $OutFile $Uri
        if ($LASTEXITCODE -ne 0) {
            throw "curl.exe failed to download $Uri"
        }
        return
    }

    Invoke-WebRequest -Uri $Uri -OutFile $OutFile -Headers @{ "User-Agent" = "athas-installer" }
}

function Get-ExpectedHashFromLines {
    param(
        [string[]]$ChecksumLines,
        [string]$FileName
    )

    $escapedFileName = [regex]::Escape($FileName)
    $line = $ChecksumLines | Where-Object { $_ -match "^\s*([a-fA-F0-9]{64})\s+$escapedFileName\s*$" } | Select-Object -First 1
    if (-not $line) {
        throw "Could not find SHA256 checksum for $FileName"
    }

    return ([regex]::Match($line, "([a-fA-F0-9]{64})")).Groups[1].Value.ToLowerInvariant()
}

function Get-ExpectedHash {
    param(
        [string]$ChecksumsPath,
        [string]$FileName
    )

    return Get-ExpectedHashFromLines -ChecksumLines (Get-Content $ChecksumsPath) -FileName $FileName
}

function Test-InstallerHash {
    param(
        [string]$InstallerPath,
        [string]$ExpectedHash
    )

    $actualHash = (Get-FileHash -Path $InstallerPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $ExpectedHash) {
        throw "SHA256 mismatch for $InstallerPath. Expected $ExpectedHash, got $actualHash"
    }

    Write-Success "Verified installer SHA256: $actualHash"
}

function Install-WithWinget {
    if ($SkipWinget) {
        Write-Status "Skipping winget install."
        return $false
    }

    if (-not (Command-Exists "winget")) {
        Write-WarningMessage "winget is not available; falling back to GitHub Releases."
        return $false
    }

    $wingetArgs = @(
        "install",
        "--exact",
        "--id",
        $PackageId,
        "--source",
        "winget",
        "--accept-package-agreements",
        "--accept-source-agreements"
    )

    if ($Interactive) {
        $wingetArgs += "--interactive"
    } else {
        $wingetArgs += "--silent"
    }

    if ($InstallDir) {
        $wingetArgs += @("--location", $InstallDir)
    }

    Write-Status "Trying winget package: $PackageId"
    if ($DryRun) {
        Write-Status "Dry run: winget $($wingetArgs -join ' ')"
        return $false
    }

    & winget @wingetArgs
    if ($LASTEXITCODE -eq 0) {
        Write-Success "Athas installed with winget."
        return $true
    }

    Write-WarningMessage "winget install failed with exit code $LASTEXITCODE; falling back to GitHub Releases."
    return $false
}

function Install-FromGitHubRelease {
    $resolvedArchitecture = Resolve-Architecture
    $resolvedVersion = Get-LatestVersion
    $tag = "v$resolvedVersion"
    $installerName = "Athas_${resolvedVersion}_${resolvedArchitecture}-setup.exe"
    $installerUrl = "$ReleaseBaseUrl/download/$tag/$installerName"
    $checksumsUrl = "$ReleaseBaseUrl/download/$tag/SHA256SUMS.txt"
    $downloadDir = Join-Path $TempRoot $tag
    $installerPath = Join-Path $downloadDir $installerName
    $checksumsPath = Join-Path $downloadDir "SHA256SUMS.txt"

    Write-Status "Selected Windows $resolvedArchitecture installer for Athas $tag."
    Write-Status "Installer: $installerUrl"
    Write-Status "Checksums: $checksumsUrl"

    if ($DryRun) {
        $checksumText = Invoke-RestMethod -Uri $checksumsUrl -Headers @{ "User-Agent" = "athas-installer" }
        $checksumLines = [string[]]($checksumText -split "`r?`n")
        $expectedHash = Get-ExpectedHashFromLines -ChecksumLines $checksumLines -FileName $installerName
        Write-Status "Dry run: expected SHA256 $expectedHash"
        Write-Status "Dry run: skipping installer download, verification, and execution."
        return
    }

    New-Item -ItemType Directory -Path $downloadDir -Force | Out-Null
    Invoke-Download -Uri $installerUrl -OutFile $installerPath
    Invoke-Download -Uri $checksumsUrl -OutFile $checksumsPath

    $expectedHash = Get-ExpectedHash -ChecksumsPath $checksumsPath -FileName $installerName
    Test-InstallerHash -InstallerPath $installerPath -ExpectedHash $expectedHash

    $installerArgs = @()
    if (-not $Interactive) {
        $installerArgs += "/S"
    }
    if ($InstallDir) {
        $installerArgs += "/D=$InstallDir"
    }

    Write-Status "Starting Athas installer..."
    $process = Start-Process -FilePath $installerPath -ArgumentList $installerArgs -Wait -PassThru
    if ($process.ExitCode -ne 0) {
        throw "Athas installer failed with exit code $($process.ExitCode)"
    }

    Write-Success "Athas installer completed."
}

function Main {
    if ($env:OS -and $env:OS -ne "Windows_NT") {
        throw "This installer is designed for Windows."
    }

    if (Install-WithWinget) {
        return
    }

    Install-FromGitHubRelease
}

try {
    Main
} catch {
    Write-Failure $_.Exception.Message
    exit 1
}
