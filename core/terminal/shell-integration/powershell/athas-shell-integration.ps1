# Athas shell integration for PowerShell (Windows PowerShell 5.1 and pwsh 7+).
# Loaded with -NoExit -Command so the user's profile has already run; wraps the
# prompt to emit OSC 133 marks and OSC 7 directory reports, and uses PSReadLine
# to mark the moment a command starts.
if ($env:ATHAS_SHELL_INTEGRATION_LOADED -or -not $env:ATHAS_SHELL_INTEGRATION) {
    return
}
$env:ATHAS_SHELL_INTEGRATION_LOADED = "1"

$Global:__AthasEsc = [char]27
$Global:__AthasBel = [char]7
$Global:__AthasCommandRunning = $false
$Global:__AthasUserPrompt = $null
if (Test-Path Function:\Prompt) {
    $Global:__AthasUserPrompt = (Get-Item Function:\Prompt).ScriptBlock
}

function Global:__AthasOsc([string] $payload) {
    return "$Global:__AthasEsc]$payload$Global:__AthasBel"
}

function Global:__AthasCurrentDirectoryReport {
    $path = $PWD.ProviderPath
    if (-not $path) {
        return ""
    }
    $path = $path -replace '\\', '/'
    if ($path -notmatch '^/') {
        $path = "/$path"
    }
    $host_name = if ($env:COMPUTERNAME) { $env:COMPUTERNAME } else { "localhost" }
    return __AthasOsc "7;file://$host_name$path"
}

function Global:Prompt {
    $lastSucceeded = $?
    $nativeExit = $Global:LASTEXITCODE
    $exitCode = if ($lastSucceeded) { 0 } elseif ($nativeExit -is [int] -and $nativeExit -ne 0) { $nativeExit } else { 1 }

    $output = ""
    if ($Global:__AthasCommandRunning) {
        $output += __AthasOsc "133;D;$exitCode"
        $Global:__AthasCommandRunning = $false
    }
    $output += __AthasCurrentDirectoryReport
    $output += __AthasOsc "133;A"

    $promptText = if ($Global:__AthasUserPrompt) { & $Global:__AthasUserPrompt } else { "PS $($PWD.Path)> " }
    if ($promptText -is [array]) {
        $promptText = -join $promptText
    }

    return "$output$promptText$(__AthasOsc '133;B')"
}

if (Get-Module -Name PSReadLine) {
    Set-PSReadLineKeyHandler -Chord Enter -ScriptBlock {
        $Global:__AthasCommandRunning = $true
        [Console]::Write((__AthasOsc "133;C"))
        [Microsoft.PowerShell.PSConsoleReadLine]::AcceptLine()
    }
}
