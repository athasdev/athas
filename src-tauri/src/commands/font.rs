use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[cfg(target_os = "linux")]
use std::fs;
#[cfg(target_os = "linux")]
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FontInfo {
    pub name: String,
    pub family: String,
    pub style: String,
    pub is_monospace: bool,
}

#[cfg(target_os = "linux")]
fn get_system_fonts_sync() -> Vec<FontInfo> {
    let mut fonts = Vec::new();
    let mut font_families = HashSet::new();

    // Method 1: Try fc-list to get all font families (simplest approach)
    if let Ok(output) = Command::new("fc-list").args(&[": family"]).output() {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                let family = line.trim().to_string();
                if !family.is_empty() && !font_families.contains(&family) {
                    let is_monospace = is_monospace_font(&family);
                    font_families.insert(family.clone());
                    fonts.push(FontInfo {
                        name: family.clone(),
                        family: family.clone(),
                        style: "Regular".to_string(),
                        is_monospace,
                    });
                }
            }
        }
    }

    // Method 2: Try fc-list with more comprehensive options if the simple method didn't work
    if fonts.is_empty() {
        if let Ok(output) = Command::new("fc-list")
            .args(&["--format=%{family[0]}:%{style[0]}:%{spacing}\n"])
            .output()
        {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                for line in stdout.lines() {
                    if let Some(font_info) = parse_fc_list_line_detailed(line) {
                        // Only add unique font families
                        if !font_families.contains(&font_info.family) {
                            font_families.insert(font_info.family.clone());
                            fonts.push(font_info);
                        }
                    }
                }
            }
        }
    }

    // Method 3: Fallback - try simpler fc-list format
    if fonts.is_empty() {
        if let Ok(output) = Command::new("fc-list")
            .args(&[":", "family", "style", "spacing"])
            .output()
        {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                for line in stdout.lines() {
                    if let Some(font_info) = parse_fc_list_line(line) {
                        if !font_families.contains(&font_info.family) {
                            font_families.insert(font_info.family.clone());
                            fonts.push(font_info);
                        }
                    }
                }
            }
        }
    }

    // Method 4: Manual font directory scanning if fc-list is not available
    if fonts.is_empty() {
        scan_font_directories(&mut fonts, &mut font_families);
    }

    // If still no fonts found, add common Linux fonts
    if fonts.is_empty() {
        let linux_fonts = vec![
            ("JetBrains Mono", "JetBrains Mono", "Regular", true),
            ("DejaVu Sans Mono", "DejaVu Sans Mono", "Regular", true),
            ("Liberation Mono", "Liberation Mono", "Regular", true),
            ("Ubuntu Mono", "Ubuntu Mono", "Regular", true),
            ("Noto Sans Mono", "Noto Sans Mono", "Regular", true),
            ("Droid Sans Mono", "Droid Sans Mono", "Regular", true),
            ("Source Code Pro", "Source Code Pro", "Regular", true),
            ("Fira Code", "Fira Code", "Regular", true),
            ("Hack", "Hack", "Regular", true),
            ("Inconsolata", "Inconsolata", "Regular", true),
            ("Roboto Mono", "Roboto Mono", "Regular", true),
            ("Courier New", "Courier New", "Regular", true),
            ("Consolas", "Consolas", "Regular", true),
            ("Space Mono", "Space Mono", "Regular", true),
            ("IBM Plex Mono", "IBM Plex Mono", "Regular", true),
            ("Anonymous Pro", "Anonymous Pro", "Regular", true),
            (
                "Fantasque Sans Mono",
                "Fantasque Sans Mono",
                "Regular",
                true,
            ),
            ("Victor Mono", "Victor Mono", "Regular", true),
            ("Iosevka", "Iosevka", "Regular", true),
            ("Input Mono", "Input Mono", "Regular", true),
            ("Courier", "Courier", "Regular", true),
            ("DejaVu Sans", "DejaVu Sans", "Regular", false),
            ("Liberation Sans", "Liberation Sans", "Regular", false),
            ("Ubuntu", "Ubuntu", "Regular", false),
            ("Noto Sans", "Noto Sans", "Regular", false),
            ("Arial", "Arial", "Regular", false),
            ("Times New Roman", "Times New Roman", "Regular", false),
        ];

        for (name, family, style, is_monospace) in linux_fonts {
            if !font_families.contains(family) {
                font_families.insert(family.to_string());
                fonts.push(FontInfo {
                    name: name.to_string(),
                    family: family.to_string(),
                    style: style.to_string(),
                    is_monospace,
                });
            }
        }
    }

    // Add common fallback fonts if not found
    add_common_fonts(&mut fonts, &font_families);

    fonts.sort_by(|a, b| a.family.cmp(&b.family));
    filter_validated_fonts(fonts)
}

#[cfg(target_os = "windows")]
use std::process::Command;

#[cfg(target_os = "windows")]
fn get_system_fonts_sync() -> Vec<FontInfo> {
    let mut fonts = Vec::new();
    let mut font_families = HashSet::new();

    // Try to get fonts using PowerShell to query installed fonts
    if let Ok(output) = Command::new("powershell")
        .args(&[
            "-Command",
            "[System.Reflection.Assembly]::LoadWithPartialName('System.Drawing'); (New-Object System.Drawing.Text.InstalledFontCollection).Families | Select-Object Name | ForEach-Object { $_.Name }"
        ])
        .output()
    {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                let family = line.trim().to_string();
                if !family.is_empty() && !font_families.contains(&family) {
                    let is_monospace = is_monospace_font(&family);
                    font_families.insert(family.clone());
                    fonts.push(FontInfo {
                        name: family.clone(),
                        family: family.clone(),
                        style: "Regular".to_string(),
                        is_monospace,
                    });
                }
            }
        }
    }

    // If PowerShell approach didn't work, try scanning Windows font directories
    if fonts.is_empty() {
        let font_dirs = vec![
            "C:\\Windows\\Fonts",
            "C:\\Users\\%USERNAME%\\AppData\\Local\\Microsoft\\Windows\\Fonts",
        ];

        for &dir in &font_dirs {
            if let Ok(output) = Command::new("dir").args(&["/b", dir]).output() {
                if output.status.success() {
                    let stdout = String::from_utf8_lossy(&output.stdout);
                    for line in stdout.lines() {
                        if line.ends_with(".ttf") || line.ends_with(".otf") {
                            if let Some(name) = line
                                .strip_suffix(".ttf")
                                .or_else(|| line.strip_suffix(".otf"))
                            {
                                let family = name.to_string();
                                if !font_families.contains(&family) {
                                    let is_monospace = is_monospace_font(&family);
                                    font_families.insert(family.clone());
                                    fonts.push(FontInfo {
                                        name: family.clone(),
                                        family: family.clone(),
                                        style: "Regular".to_string(),
                                        is_monospace,
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // If still no fonts found, fall back to known Windows fonts
    if fonts.is_empty() {
        let windows_fonts = vec![
            ("JetBrains Mono", "JetBrains Mono", "Regular", true),
            ("Consolas", "Consolas", "Regular", true),
            ("Courier New", "Courier New", "Regular", true),
            ("Cascadia Code", "Cascadia Code", "Regular", true),
            ("Cascadia Mono", "Cascadia Mono", "Regular", true),
            ("Fira Code", "Fira Code", "Regular", true),
            ("Source Code Pro", "Source Code Pro", "Regular", true),
            ("Hack", "Hack", "Regular", true),
            ("Inconsolata", "Inconsolata", "Regular", true),
            ("Ubuntu Mono", "Ubuntu Mono", "Regular", true),
            ("Roboto Mono", "Roboto Mono", "Regular", true),
            ("DejaVu Sans Mono", "DejaVu Sans Mono", "Regular", true),
            ("Liberation Mono", "Liberation Mono", "Regular", true),
            ("Space Mono", "Space Mono", "Regular", true),
            ("IBM Plex Mono", "IBM Plex Mono", "Regular", true),
            ("Anonymous Pro", "Anonymous Pro", "Regular", true),
            ("Droid Sans Mono", "Droid Sans Mono", "Regular", true),
            ("Courier", "Courier", "Regular", true),
            ("Arial", "Arial", "Regular", false),
            ("Times New Roman", "Times New Roman", "Regular", false),
            ("Calibri", "Calibri", "Regular", false),
            ("Segoe UI", "Segoe UI", "Regular", false),
            ("Verdana", "Verdana", "Regular", false),
            ("Tahoma", "Tahoma", "Regular", false),
        ];

        for (name, family, style, is_monospace) in windows_fonts {
            if !font_families.contains(family) {
                font_families.insert(family.to_string());
                fonts.push(FontInfo {
                    name: name.to_string(),
                    family: family.to_string(),
                    style: style.to_string(),
                    is_monospace,
                });
            }
        }
    }

    // Add common fallback fonts if not found
    add_common_fonts(&mut fonts, &font_families);

    fonts.sort_by(|a, b| a.family.cmp(&b.family));
    filter_validated_fonts(fonts)
}

#[cfg(target_os = "macos")]
use std::process::Command;

#[cfg(target_os = "macos")]
fn get_system_fonts_sync() -> Vec<FontInfo> {
    let mut fonts = Vec::new();
    let mut font_families = HashSet::new();

    // Try to get actual system fonts using system_profiler
    if let Ok(output) = Command::new("system_profiler")
        .args(&["SPFontsDataType", "-detailLevel", "mini"])
        .output()
    {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                if line.trim().starts_with("Font Name:") || line.trim().starts_with("_name:") {
                    if let Some(font_name) = line.split(':').nth(1) {
                        let family = font_name.trim().to_string();
                        if !family.is_empty() && !font_families.contains(&family) {
                            let is_monospace = is_monospace_font(&family);
                            font_families.insert(family.clone());
                            fonts.push(FontInfo {
                                name: family.clone(),
                                family: family.clone(),
                                style: "Regular".to_string(),
                                is_monospace,
                            });
                        }
                    }
                }
            }
        }
    }

    // If system_profiler didn't work, try using font book database
    if fonts.is_empty() {
        if let Ok(output) = Command::new("find")
            .args(&[
                "/System/Library/Fonts",
                "/Library/Fonts",
                "/Users/*/Library/Fonts",
                "-name",
                "*.ttf",
                "-o",
                "-name",
                "*.otf",
            ])
            .output()
        {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                for line in stdout.lines() {
                    if let Some(filename) = std::path::Path::new(line).file_stem() {
                        let family = filename.to_string_lossy().to_string();
                        if !font_families.contains(&family) {
                            let is_monospace = is_monospace_font(&family);
                            font_families.insert(family.clone());
                            fonts.push(FontInfo {
                                name: family.clone(),
                                family: family.clone(),
                                style: "Regular".to_string(),
                                is_monospace,
                            });
                        }
                    }
                }
            }
        }
    }

    // If still no fonts found, fall back to known macOS fonts
    if fonts.is_empty() {
        let macos_fonts = vec![
            ("JetBrains Mono", "JetBrains Mono", "Regular", true),
            ("Monaco", "Monaco", "Regular", true),
            ("Menlo", "Menlo", "Regular", true),
            ("SF Mono", "SF Mono", "Regular", true),
            ("Consolas", "Consolas", "Regular", true),
            ("Courier New", "Courier New", "Regular", true),
            ("Fira Code", "Fira Code", "Regular", true),
            ("Source Code Pro", "Source Code Pro", "Regular", true),
            ("Cascadia Code", "Cascadia Code", "Regular", true),
            ("Cascadia Mono", "Cascadia Mono", "Regular", true),
            ("Hack", "Hack", "Regular", true),
            ("Inconsolata", "Inconsolata", "Regular", true),
            ("Ubuntu Mono", "Ubuntu Mono", "Regular", true),
            ("Roboto Mono", "Roboto Mono", "Regular", true),
            ("DejaVu Sans Mono", "DejaVu Sans Mono", "Regular", true),
            ("Liberation Mono", "Liberation Mono", "Regular", true),
            ("Iosevka", "Iosevka", "Regular", true),
            ("Input Mono", "Input Mono", "Regular", true),
            ("Anonymous Pro", "Anonymous Pro", "Regular", true),
            (
                "Fantasque Sans Mono",
                "Fantasque Sans Mono",
                "Regular",
                true,
            ),
            ("Victor Mono", "Victor Mono", "Regular", true),
            ("Operator Mono", "Operator Mono", "Regular", true),
            ("Dank Mono", "Dank Mono", "Regular", true),
            ("Comic Code", "Comic Code", "Regular", true),
            ("Space Mono", "Space Mono", "Regular", true),
            ("IBM Plex Mono", "IBM Plex Mono", "Regular", true),
            ("Courier", "Courier", "Regular", true),
            ("Arial", "Arial", "Regular", false),
            ("Helvetica", "Helvetica", "Regular", false),
            ("Times New Roman", "Times New Roman", "Regular", false),
            ("Helvetica Neue", "Helvetica Neue", "Regular", false),
            ("San Francisco", "San Francisco", "Regular", false),
            ("Avenir", "Avenir", "Regular", false),
        ];

        for (name, family, style, is_monospace) in macos_fonts {
            if !font_families.contains(family) {
                font_families.insert(family.to_string());
                fonts.push(FontInfo {
                    name: name.to_string(),
                    family: family.to_string(),
                    style: style.to_string(),
                    is_monospace,
                });
            }
        }
    }

    // Add common fallback fonts if not found
    add_common_fonts(&mut fonts, &font_families);

    fonts.sort_by(|a, b| a.family.cmp(&b.family));
    filter_validated_fonts(fonts)
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
fn get_system_fonts_sync() -> Vec<FontInfo> {
    let mut fonts = Vec::new();
    let font_families = HashSet::new();
    add_common_fonts(&mut fonts, &font_families);
    fonts.sort_by(|a, b| a.family.cmp(&b.family));
    filter_validated_fonts(fonts)
}

#[cfg(target_os = "linux")]
fn parse_fc_list_line_detailed(line: &str) -> Option<FontInfo> {
    let parts: Vec<&str> = line.split(':').collect();
    if parts.len() >= 1 {
        let family = parts[0].trim();
        let style = if parts.len() > 1 {
            parts[1].trim()
        } else {
            "Regular"
        };
        let spacing = if parts.len() > 2 { parts[2].trim() } else { "" };

        if family.is_empty() {
            return None;
        }

        // Determine if font is monospace
        let is_monospace = spacing == "100" || // 100 = mono spacing in fontconfig
            spacing.to_lowercase().contains("mono") ||
            is_monospace_font(family);

        Some(FontInfo {
            name: family.to_string(),
            family: family.to_string(),
            style: style.to_string(),
            is_monospace,
        })
    } else {
        None
    }
}

#[cfg(target_os = "linux")]
fn parse_fc_list_line(line: &str) -> Option<FontInfo> {
    let parts: Vec<&str> = line.split(':').collect();
    if parts.len() >= 2 {
        let family = parts[0].trim();
        let style_part = if parts.len() > 1 {
            parts[1].trim()
        } else {
            "Regular"
        };
        let spacing_part = if parts.len() > 2 { parts[2].trim() } else { "" };

        if family.is_empty() {
            return None;
        }

        // Determine if font is monospace
        let is_monospace = spacing_part.contains("100") || // 100 = mono spacing
            spacing_part.to_lowercase().contains("mono") ||
            is_monospace_font(family);

        Some(FontInfo {
            name: family.to_string(),
            family: family.to_string(),
            style: style_part.to_string(),
            is_monospace,
        })
    } else {
        None
    }
}

fn is_monospace_font(family: &str) -> bool {
    let family_lower = family.to_lowercase();
    family_lower.contains("mono")
        || family_lower.contains("courier")
        || family_lower.contains("consola")
        || family_lower.contains("terminal")
        || family_lower.contains("typewriter")
        || family_lower.contains("code")
        || family_lower.contains("source code pro")
        || family_lower.contains("fira code")
        || family_lower.contains("jetbrains mono")
        || family_lower.contains("cascadia")
        || family_lower.contains("hack")
        || family_lower.contains("inconsolata")
        || family_lower.contains("ubuntu mono")
        || family_lower.contains("dejavu sans mono")
        || family_lower.contains("liberation mono")
        || family_lower.contains("roboto mono")
        || family_lower.contains("noto mono")
        || family_lower.contains("droid sans mono")
        || family_lower.contains("iosevka")
        || family_lower.contains("input mono")
        || family_lower.contains("anonymous pro")
        || family_lower.contains("fantasque sans mono")
        || family_lower.contains("victor mono")
}

#[cfg(target_os = "linux")]
fn scan_font_directories(fonts: &mut Vec<FontInfo>, font_families: &mut HashSet<String>) {
    let font_dirs = vec![
        "/usr/share/fonts",
        "/usr/local/share/fonts",
        "/var/lib/defoma/fontconfig.d/generic",
        "/etc/fonts",
    ];

    // Get actual user home directory
    if let Ok(home) = std::env::var("HOME") {
        let user_font_dirs = vec![
            format!("{}/.fonts", home),
            format!("{}/.local/share/fonts", home),
        ];

        for dir in user_font_dirs {
            if let Ok(entries) = fs::read_dir(&dir) {
                scan_directory_for_fonts(&dir, fonts, font_families, entries);
            }
        }
    }

    // System font directories
    for &dir in &font_dirs {
        if let Ok(entries) = fs::read_dir(dir) {
            scan_directory_for_fonts(dir, fonts, font_families, entries);
        }
    }
}

#[cfg(target_os = "linux")]
fn scan_directory_for_fonts(
    _dir: &str,
    fonts: &mut Vec<FontInfo>,
    font_families: &mut HashSet<String>,
    entries: std::fs::ReadDir,
) {
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if let Ok(sub_entries) = std::fs::read_dir(&path) {
                scan_directory_for_fonts(
                    path.to_str().unwrap_or(""),
                    fonts,
                    font_families,
                    sub_entries,
                );
            }
        } else if let Some(extension) = path.extension() {
            let ext = extension.to_string_lossy().to_lowercase();
            if ext == "ttf" || ext == "otf" || ext == "woff" || ext == "woff2" {
                if let Some(font_name) = path.file_stem() {
                    let family = font_name.to_string_lossy().to_string();

                    // Skip if we already have this font family
                    if font_families.contains(&family) {
                        continue;
                    }

                    let is_monospace = is_monospace_font(&family);

                    font_families.insert(family.clone());
                    fonts.push(FontInfo {
                        name: family.clone(),
                        family: family.clone(),
                        style: "Regular".to_string(),
                        is_monospace,
                    });
                }
            }
        }
    }
}

#[cfg(target_os = "linux")]
fn validate_font_sync(font_family: &str) -> bool {
    // Use fc-match to check if font is actually installed and available
    if let Ok(output) = Command::new("fc-match")
        .arg(font_family)
        .arg("--format=%{family[0]}")
        .output()
    {
        if output.status.success() {
            let matched_family = String::from_utf8_lossy(&output.stdout).trim().to_string();
            // Font is valid if fc-match returns the same family name (case insensitive)
            return matched_family.to_lowercase() == font_family.to_lowercase();
        }
    }
    false
}

#[cfg(not(target_os = "linux"))]
fn validate_font_sync(font_family: &str) -> bool {
    // For non-Linux systems, assume fonts in common list are available
    let common_fonts = vec![
        "Arial",
        "Helvetica",
        "Times New Roman",
        "Courier New",
        "monospace",
        "sans-serif",
        "serif",
        "Consolas",
        "Monaco",
        "Menlo",
        "SF Mono",
        "Cascadia Code",
        "Cascadia Mono",
        "JetBrains Mono",
        "Fira Code",
        "Source Code Pro",
        "Hack",
        "Inconsolata",
        "Ubuntu Mono",
        "Roboto Mono",
        "DejaVu Sans Mono",
        "Liberation Mono",
    ];

    common_fonts
        .iter()
        .any(|&font| font.to_lowercase() == font_family.to_lowercase())
}

fn filter_validated_fonts(fonts: Vec<FontInfo>) -> Vec<FontInfo> {
    fonts
        .into_iter()
        .filter(|font| {
            // Always include generic fallback fonts
            if font.family == "monospace" || font.family == "sans-serif" || font.family == "serif" {
                return true;
            }
            // Validate other fonts
            validate_font_sync(&font.family)
        })
        .collect()
}

fn add_common_fonts(fonts: &mut Vec<FontInfo>, font_families: &HashSet<String>) {
    let common_fonts = vec![
        // Popular monospace fonts
        ("JetBrains Mono", "JetBrains Mono", "Regular", true),
        ("Fira Code", "Fira Code", "Regular", true),
        ("Source Code Pro", "Source Code Pro", "Regular", true),
        ("Hack", "Hack", "Regular", true),
        ("Inconsolata", "Inconsolata", "Regular", true),
        ("Ubuntu Mono", "Ubuntu Mono", "Regular", true),
        ("Roboto Mono", "Roboto Mono", "Regular", true),
        ("Noto Sans Mono", "Noto Sans Mono", "Regular", true),
        ("DejaVu Sans Mono", "DejaVu Sans Mono", "Regular", true),
        ("Liberation Mono", "Liberation Mono", "Regular", true),
        ("Droid Sans Mono", "Droid Sans Mono", "Regular", true),
        ("Iosevka", "Iosevka", "Regular", true),
        ("Input Mono", "Input Mono", "Regular", true),
        ("Anonymous Pro", "Anonymous Pro", "Regular", true),
        (
            "Fantasque Sans Mono",
            "Fantasque Sans Mono",
            "Regular",
            true,
        ),
        ("Victor Mono", "Victor Mono", "Regular", true),
        // System defaults
        ("Monaco", "Monaco", "Regular", true),
        ("Consolas", "Consolas", "Regular", true),
        ("Courier New", "Courier New", "Regular", true),
        ("Menlo", "Menlo", "Regular", true),
        ("SF Mono", "SF Mono", "Regular", true),
        ("Cascadia Code", "Cascadia Code", "Regular", true),
        ("monospace", "monospace", "Regular", true),
        // Sans-serif fallbacks
        ("Arial", "Arial", "Regular", false),
        ("Helvetica", "Helvetica", "Regular", false),
        ("Times New Roman", "Times New Roman", "Regular", false),
        ("serif", "serif", "Regular", false),
        ("sans-serif", "sans-serif", "Regular", false),
    ];

    for (name, family, style, is_monospace) in common_fonts {
        if !font_families.contains(family) {
            fonts.push(FontInfo {
                name: name.to_string(),
                family: family.to_string(),
                style: style.to_string(),
                is_monospace,
            });
        }
    }
}

#[tauri::command]
pub async fn get_system_fonts() -> Result<Vec<FontInfo>, String> {
    Ok(get_system_fonts_sync())
}

#[tauri::command]
pub async fn get_monospace_fonts() -> Result<Vec<FontInfo>, String> {
    let all_fonts = get_system_fonts_sync();
    let monospace_fonts: Vec<FontInfo> = all_fonts
        .into_iter()
        .filter(|font| font.is_monospace)
        .collect();
    Ok(monospace_fonts)
}

#[tauri::command]
pub async fn validate_font(font_family: String) -> Result<bool, String> {
    #[cfg(target_os = "linux")]
    {
        // Use fc-match to check if font is actually installed and available
        if let Ok(output) = Command::new("fc-match")
            .arg(&font_family)
            .arg("--format=%{family[0]}")
            .output()
        {
            if output.status.success() {
                let matched_family = String::from_utf8_lossy(&output.stdout).trim().to_string();
                // Font is valid if fc-match returns the same family name
                return Ok(matched_family.to_lowercase() == font_family.to_lowercase());
            }
        }
        // If fc-match failed or command failed, return false
        return Ok(false);
    }

    #[cfg(not(target_os = "linux"))]
    {
        // Fallback: check if font exists in our detected fonts list
        let fonts = get_system_fonts_sync();
        let is_valid = fonts.iter().any(|font| font.family == font_family);
        Ok(is_valid)
    }
}
