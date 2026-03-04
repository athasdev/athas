use std::fs;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use tauri::command;

// Platform-specific CLI paths
#[cfg(unix)]
fn get_cli_script_path() -> Result<std::path::PathBuf, String> {
   let home = std::env::var("HOME").map_err(|_| "Failed to get home directory".to_string())?;
   Ok(std::path::PathBuf::from(home)
      .join(".local")
      .join("bin")
      .join("athas"))
}

#[cfg(windows)]
fn get_cli_script_path() -> Result<std::path::PathBuf, String> {
   let home = std::env::var("USERPROFILE")
      .map_err(|_| "Failed to get user profile directory".to_string())?;
   Ok(std::path::PathBuf::from(home)
      .join(".athas")
      .join("bin")
      .join("athas.cmd"))
}

#[command]
pub fn check_cli_installed() -> Result<bool, String> {
   let cli_path = get_cli_script_path()?;
   Ok(cli_path.exists())
}

/// Shell script body shared by macOS install_cli_command and get_cli_install_command.
/// Resolves file/folder arguments to absolute paths and opens them via deep-link URLs.
#[cfg(target_os = "macos")]
const MACOS_CLI_SCRIPT: &str = r#"#!/bin/bash
# Athas CLI launcher

if [ $# -eq 0 ]; then
    if [ -d "/Applications/Athas.app" ]; then
        open -a "/Applications/Athas.app"
    elif [ -d "$HOME/Applications/Athas.app" ]; then
        open -a "$HOME/Applications/Athas.app"
    else
        open -a "Athas"
    fi
    exit 0
fi

for arg in "$@"; do
    # Skip flags
    case "$arg" in -*)  continue ;; esac

    # Split file:line (but not bare drive letters like C:\)
    line=""
    file="$arg"
    if [[ "$arg" =~ ^(.+):([0-9]+)$ ]]; then
        file="${BASH_REMATCH[1]}"
        line="${BASH_REMATCH[2]}"
    fi

    # Resolve to absolute path
    if [ -d "$file" ]; then
        abs="$(cd "$file" && pwd)"
        type_param="&type=directory"
    elif [ -f "$file" ]; then
        dir="$(cd "$(dirname "$file")" && pwd)"
        abs="$dir/$(basename "$file")"
        type_param=""
    else
        echo "athas: $file: No such file or directory" >&2
        continue
    fi

    # URL-encode the path (percent-encode everything except safe chars)
    encoded=""
    for (( i=0; i<${#abs}; i++ )); do
        c="${abs:$i:1}"
        case "$c" in
            [a-zA-Z0-9._/~-]) encoded+="$c" ;;
            *) encoded+=$(printf '%%%02X' "'$c") ;;
        esac
    done

    url="athas://open?path=${encoded}"
    [ -n "$line" ] && [ "$line" -gt 0 ] 2>/dev/null && url+="&line=${line}"
    [ -n "$type_param" ] && url+="$type_param"

    open "$url"
done
"#;

#[cfg(target_os = "macos")]
#[command]
pub fn install_cli_command() -> Result<String, String> {
   let cli_path = get_cli_script_path()?;
   let bin_dir = cli_path
      .parent()
      .ok_or_else(|| "Failed to get parent directory".to_string())?;

   if !bin_dir.exists() {
      fs::create_dir_all(bin_dir).map_err(|e| format!("Failed to create directory: {}", e))?;
   }

   fs::write(&cli_path, MACOS_CLI_SCRIPT)
      .map_err(|e| format!("Failed to write CLI script: {}", e))?;

   let mut perms = fs::metadata(&cli_path)
      .map_err(|e| format!("Failed to get file permissions: {}", e))?
      .permissions();
   perms.set_mode(0o755);
   fs::set_permissions(&cli_path, perms)
      .map_err(|e| format!("Failed to set executable permissions: {}", e))?;

   Ok(format!(
      "CLI command installed successfully at {}.\n\nNote: Make sure {} is in your PATH. Add this \
       to your ~/.zshrc or ~/.bashrc:\nexport PATH=\"$HOME/.local/bin:$PATH\"",
      cli_path.display(),
      bin_dir.display()
   ))
}

#[cfg(all(unix, not(target_os = "macos")))]
#[command]
pub fn install_cli_command() -> Result<String, String> {
   let cli_path = get_cli_script_path()?;
   let bin_dir = cli_path
      .parent()
      .ok_or_else(|| "Failed to get parent directory".to_string())?;

   let script_content = r#"#!/bin/bash
# Athas CLI launcher

if [ $# -eq 0 ]; then
    ATHAS_BIN=$(command -v athas-code 2>/dev/null || find /opt /usr/local -name "athas-code" -type f 2>/dev/null | head -1)
    if [ -n "$ATHAS_BIN" ] && [ -x "$ATHAS_BIN" ]; then
        "$ATHAS_BIN" &
    else
        echo "Athas not found. Please ensure it is installed."
        exit 1
    fi
    exit 0
fi

for arg in "$@"; do
    case "$arg" in -*)  continue ;; esac

    line=""
    file="$arg"
    if [[ "$arg" =~ ^(.+):([0-9]+)$ ]]; then
        file="${BASH_REMATCH[1]}"
        line="${BASH_REMATCH[2]}"
    fi

    if [ -d "$file" ]; then
        abs="$(cd "$file" && pwd)"
        type_param="&type=directory"
    elif [ -f "$file" ]; then
        dir="$(cd "$(dirname "$file")" && pwd)"
        abs="$dir/$(basename "$file")"
        type_param=""
    else
        echo "athas: $file: No such file or directory" >&2
        continue
    fi

    encoded=""
    for (( i=0; i<${#abs}; i++ )); do
        c="${abs:$i:1}"
        case "$c" in
            [a-zA-Z0-9._/~-]) encoded+="$c" ;;
            *) encoded+=$(printf '%%%02X' "'$c") ;;
        esac
    done

    url="athas://open?path=${encoded}"
    [ -n "$line" ] && [ "$line" -gt 0 ] 2>/dev/null && url+="&line=${line}"
    [ -n "$type_param" ] && url+="$type_param"

    xdg-open "$url"
done
"#;

   if !bin_dir.exists() {
      fs::create_dir_all(bin_dir).map_err(|e| format!("Failed to create directory: {}", e))?;
   }

   fs::write(&cli_path, script_content)
      .map_err(|e| format!("Failed to write CLI script: {}", e))?;

   let mut perms = fs::metadata(&cli_path)
      .map_err(|e| format!("Failed to get file permissions: {}", e))?
      .permissions();
   perms.set_mode(0o755);
   fs::set_permissions(&cli_path, perms)
      .map_err(|e| format!("Failed to set executable permissions: {}", e))?;

   Ok(format!(
      "CLI command installed successfully at {}.\n\nNote: Make sure {} is in your PATH. Add this \
       to your ~/.zshrc or ~/.bashrc:\nexport PATH=\"$HOME/.local/bin:$PATH\"",
      cli_path.display(),
      bin_dir.display()
   ))
}

#[cfg(windows)]
#[command]
pub fn install_cli_command() -> Result<String, String> {
   let cli_path = get_cli_script_path()?;
   let bin_dir = cli_path
      .parent()
      .ok_or_else(|| "Failed to get parent directory".to_string())?;

   if !bin_dir.exists() {
      fs::create_dir_all(bin_dir).map_err(|e| format!("Failed to create bin directory: {}", e))?;
   }

   let script_content = r#"@echo off
REM Athas CLI launcher for Windows

if "%~1"=="" (
    if exist "%LOCALAPPDATA%\Programs\Athas\Athas.exe" (
        start "" "%LOCALAPPDATA%\Programs\Athas\Athas.exe"
    ) else if exist "%PROGRAMFILES%\Athas\Athas.exe" (
        start "" "%PROGRAMFILES%\Athas\Athas.exe"
    ) else (
        echo Error: Athas installation not found
        exit /b 1
    )
    exit /b 0
)

setlocal enabledelayedexpansion
for %%A in (%*) do (
    set "arg=%%~A"
    REM Skip flags
    if "!arg:~0,1!"=="-" ( goto :continue )

    set "file=!arg!"
    set "line="

    REM Check for file:line syntax
    for /f "tokens=1,2 delims=:" %%B in ("!arg!") do (
        set "maybe_file=%%B"
        set "maybe_line=%%C"
    )
    if defined maybe_line (
        echo !maybe_line!| findstr /r "^[0-9][0-9]*$" >nul 2>&1
        if !errorlevel! equ 0 (
            set "file=!maybe_file!"
            set "line=!maybe_line!"
        )
    )

    REM Resolve absolute path
    set "type_param="
    if exist "!file!\*" (
        pushd "!file!"
        set "abs=!cd!"
        popd
        set "type_param=^&type=directory"
    ) else if exist "!file!" (
        for %%F in ("!file!") do set "abs=%%~fF"
    ) else (
        echo athas: !file!: No such file or directory >&2
        goto :continue
    )

    set "url=athas://open?path=!abs!"
    if defined line ( set "url=!url!^&line=!line!" )
    if defined type_param ( set "url=!url!!type_param!" )

    start "" "!url!"

    :continue
)
endlocal
"#;

   fs::write(&cli_path, script_content)
      .map_err(|e| format!("Failed to write CLI script: {}", e))?;

   let path_instruction = format!(
      "CLI command installed successfully at {}.\n\nTo use 'athas' from anywhere, add the \
       following directory to your PATH:\n{}\n\nYou can do this by:\n1. Search for 'Environment \
       Variables' in Windows Settings\n2. Edit the 'Path' variable under User variables\n3. Add \
       the directory above\n4. Restart your terminal",
      cli_path.display(),
      bin_dir.display()
   );

   Ok(path_instruction)
}

#[cfg(target_os = "macos")]
#[command]
pub fn get_cli_install_command() -> Result<String, String> {
   Ok(format!(
      "mkdir -p ~/.local/bin && cat > ~/.local/bin/athas << 'SCRIPT'\n{}\nSCRIPT\nchmod +x \
       ~/.local/bin/athas",
      MACOS_CLI_SCRIPT.trim()
   ))
}

#[cfg(all(unix, not(target_os = "macos")))]
#[command]
pub fn get_cli_install_command() -> Result<String, String> {
   Ok(r#"mkdir -p ~/.local/bin && cat > ~/.local/bin/athas << 'EOF'
#!/bin/bash
if [ $# -eq 0 ]; then
    ATHAS_BIN=$(command -v athas-code 2>/dev/null || find /opt /usr/local -name "athas-code" -type f 2>/dev/null | head -1)
    if [ -n "$ATHAS_BIN" ] && [ -x "$ATHAS_BIN" ]; then
        "$ATHAS_BIN" &
    else
        echo "Athas not found. Please ensure it is installed."
        exit 1
    fi
    exit 0
fi

for arg in "$@"; do
    case "$arg" in -*)  continue ;; esac
    line=""
    file="$arg"
    if [[ "$arg" =~ ^(.+):([0-9]+)$ ]]; then
        file="${BASH_REMATCH[1]}"
        line="${BASH_REMATCH[2]}"
    fi
    if [ -d "$file" ]; then
        abs="$(cd "$file" && pwd)"
        type_param="&type=directory"
    elif [ -f "$file" ]; then
        dir="$(cd "$(dirname "$file")" && pwd)"
        abs="$dir/$(basename "$file")"
        type_param=""
    else
        echo "athas: $file: No such file or directory" >&2
        continue
    fi
    encoded=""
    for (( i=0; i<${#abs}; i++ )); do
        c="${abs:$i:1}"
        case "$c" in
            [a-zA-Z0-9._/~-]) encoded+="$c" ;;
            *) encoded+=$(printf '%%%02X' "'$c") ;;
        esac
    done
    url="athas://open?path=${encoded}"
    [ -n "$line" ] && [ "$line" -gt 0 ] 2>/dev/null && url+="&line=${line}"
    [ -n "$type_param" ] && url+="$type_param"
    xdg-open "$url"
done
EOF
chmod +x ~/.local/bin/athas"#
      .to_string())
}

#[cfg(windows)]
#[command]
pub fn get_cli_install_command() -> Result<String, String> {
   Ok(r#"mkdir "%USERPROFILE%\.athas\bin" 2>nul & (
echo @echo off
echo REM Athas CLI launcher for Windows
echo if "%%~1"=="" ^(
echo     if exist "%%LOCALAPPDATA%%\Programs\Athas\Athas.exe" ^(
echo         start "" "%%LOCALAPPDATA%%\Programs\Athas\Athas.exe"
echo     ^) else if exist "%%PROGRAMFILES%%\Athas\Athas.exe" ^(
echo         start "" "%%PROGRAMFILES%%\Athas\Athas.exe"
echo     ^) else ^(
echo         echo Error: Athas installation not found
echo         exit /b 1
echo     ^)
echo     exit /b 0
echo ^)
echo for %%%%A in ^(%%*^) do ^(
echo     start "" "athas://open?path=%%%%~fA"
echo ^)
) > "%USERPROFILE%\.athas\bin\athas.cmd""#
      .to_string())
}

#[cfg(unix)]
#[command]
pub fn uninstall_cli_command() -> Result<String, String> {
   let cli_path = get_cli_script_path()?;

   if !cli_path.exists() {
      return Err("CLI command is not installed".to_string());
   }

   fs::remove_file(&cli_path).map_err(|e| format!("Failed to remove CLI script: {}", e))?;

   Ok("CLI command uninstalled successfully".to_string())
}

#[cfg(windows)]
#[command]
pub fn uninstall_cli_command() -> Result<String, String> {
   let cli_path = get_cli_script_path()?;

   if !cli_path.exists() {
      return Err("CLI command is not installed".to_string());
   }

   fs::remove_file(&cli_path).map_err(|e| format!("Failed to remove CLI script: {}", e))?;

   Ok("CLI command uninstalled successfully".to_string())
}
