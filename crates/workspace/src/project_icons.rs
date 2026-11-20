//! Project icons (`project-icons/`): an image file found in the project, an emoji, or one of
//! Athas's icons, stored on the project as `emoji:🚀`, `icon:rocket` or the file's path.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProjectIconCategory {
    Files,
    Emojis,
    Icons,
}

/// An emoji or an Athas icon a project can wear.
#[derive(Clone, Debug, PartialEq)]
pub struct ProjectSymbol {
    pub value: String,
    pub name: &'static str,
    pub keywords: &'static [&'static str],
    pub emoji: Option<&'static str>,
    /// The Athas icon's name, as `ui::IconName::from_name` reads it (`Rocket`).
    pub icon: Option<&'static str>,
}

const PROJECT_ICONS: [(&str, &str, &str, &[&str]); 18] = [
    ("folder", "Folder", "Folder", &["files", "project"]),
    ("code", "Code", "Code", &["development", "app"]),
    ("terminal", "Terminal", "Terminal", &["shell", "cli", "console"]),
    ("globe", "Globe", "Globe", &["web", "website", "internet"]),
    ("database", "Database", "Database", &["data", "sql", "storage"]),
    ("cloud", "Cloud", "Cloud", &["server", "hosting", "deploy"]),
    ("cube", "Cube", "Cube", &["package", "module", "box"]),
    ("stack", "Stack", "Stack", &["layers", "library"]),
    ("rocket", "Rocket", "Rocket", &["launch", "release", "ship"]),
    ("lightning", "Lightning", "Bolt", &["fast", "performance"]),
    ("bug", "Bug", "Bug", &["debug", "issue", "test"]),
    ("shield", "Shield", "Shield", &["security", "privacy"]),
    ("palette", "Palette", "Palette", &["design", "color", "art"]),
    ("sparkle", "Sparkle", "Sparkle", &["ai", "magic"]),
    ("gear", "Gear", "Gear", &["settings", "config"]),
    ("wrench", "Wrench", "Wrench", &["tools", "build", "fix"]),
    ("sun", "Sun", "Sun", &["light", "day"]),
    ("moon", "Moon", "Moon", &["dark", "night"]),
];

/// `utils/emoji-catalog.ts`: the emoji picker's choices with their labels and keywords.
const EMOJIS: [(&str, &str, &[&str]); 32] = [
    ("💬", "Message", &["chat", "comment", "thread"]),
    ("🛠️", "Tools", &["fix", "build", "work"]),
    ("🚀", "Launch", &["rocket", "ship", "release", "deploy"]),
    ("🧪", "Test", &["lab", "qa", "experiment"]),
    ("📣", "Announcement", &["news", "broadcast"]),
    ("🔒", "Private", &["lock", "secure"]),
    ("📌", "Pinned", &["pin", "important"]),
    ("⚡", "Fast", &["bolt", "performance"]),
    ("✅", "Done", &["check", "complete"]),
    ("🔥", "Hot", &["fire", "urgent"]),
    ("🎯", "Goal", &["target", "focus"]),
    ("🧠", "Ideas", &["brain", "think"]),
    ("👀", "Review", &["eyes", "look"]),
    ("🙌", "Celebrate", &["hands", "thanks"]),
    ("🙏", "Request", &["please", "pray"]),
    ("❤️", "Love", &["heart", "like"]),
    ("✨", "Polish", &["sparkles", "clean"]),
    ("⭐", "Star", &["favorite", "important"]),
    ("💡", "Idea", &["light", "bulb"]),
    ("📎", "Attachment", &["clip", "file"]),
    ("📁", "Files", &["folder", "project"]),
    ("📝", "Notes", &["memo", "write"]),
    ("🐛", "Bug", &["issue", "debug"]),
    ("🚨", "Alert", &["warning", "incident"]),
    ("⏳", "Waiting", &["hourglass", "pending"]),
    ("🔍", "Search", &["find", "inspect"]),
    ("🎨", "Design", &["paint", "style"]),
    ("⚙️", "Settings", &["gear", "config"]),
    ("🧩", "Integration", &["plugin", "piece"]),
    ("🧵", "Thread", &["conversation", "topic"]),
    ("📦", "Package", &["box", "bundle"]),
    ("🧹", "Cleanup", &["sweep", "refactor"]),
];

pub fn symbols(category: ProjectIconCategory) -> Vec<ProjectSymbol> {
    match category {
        ProjectIconCategory::Files => Vec::new(),
        ProjectIconCategory::Emojis => EMOJIS
            .iter()
            .map(|(emoji, name, keywords)| ProjectSymbol {
                value: format!("emoji:{emoji}"),
                name,
                keywords,
                emoji: Some(emoji),
                icon: None,
            })
            .collect(),
        ProjectIconCategory::Icons => PROJECT_ICONS
            .iter()
            .map(|(id, name, icon, keywords)| ProjectSymbol {
                value: format!("icon:{id}"),
                name,
                keywords,
                emoji: None,
                icon: Some(icon),
            })
            .collect(),
    }
}

pub fn category(value: Option<&str>) -> ProjectIconCategory {
    match value {
        Some(value) if value.starts_with("emoji:") => ProjectIconCategory::Emojis,
        Some(value) if value.starts_with("icon:") => ProjectIconCategory::Icons,
        _ => ProjectIconCategory::Files,
    }
}

pub fn find_symbol(value: &str) -> Option<ProjectSymbol> {
    symbols(category(Some(value))).into_iter().find(|symbol| symbol.value == value)
}

/// Symbols whose name, emoji or keywords hold every word of the query.
pub fn search_symbols(category: ProjectIconCategory, query: &str) -> Vec<ProjectSymbol> {
    let query = query.trim().to_lowercase();
    let words: Vec<&str> = query.split_whitespace().collect();
    symbols(category)
        .into_iter()
        .filter(|symbol| {
            let mut text = vec![symbol.name, symbol.emoji.unwrap_or("")];
            text.extend(symbol.keywords.iter().copied());
            let text = text.join(" ").to_lowercase();
            words.iter().all(|word| text.contains(word))
        })
        .collect()
}

/// `utils/search-match.ts`: lowercase letters and digits, everything else one space.
pub fn normalize_search_text(value: &str) -> String {
    let mut out = String::new();
    let mut space = false;
    for character in value.to_lowercase().chars() {
        if character.is_ascii_alphanumeric() {
            if space && !out.is_empty() {
                out.push(' ');
            }
            space = false;
            out.push(character);
        } else {
            space = true;
        }
    }
    out
}

/// Whether any candidate holds the query, with or without its spaces.
pub fn matches_search_query(query: &str, candidates: &[&str]) -> bool {
    let normalized = normalize_search_text(query);
    if normalized.is_empty() {
        return true;
    }
    let compact = normalized.replace(' ', "");
    candidates.iter().any(|candidate| {
        let text = normalize_search_text(candidate);
        text.contains(&normalized) || text.replace(' ', "").contains(&compact)
    })
}

/// An image in the project that looks like its icon.
#[derive(Clone, Debug, PartialEq)]
pub struct ProjectIconFile {
    pub name: String,
    pub path: String,
    pub score: i32,
}

impl ProjectIconFile {
    /// The path inside the project, with forward slashes.
    pub fn relative_path(&self, project: &str) -> String {
        let prefix = format!("{}/", project.trim_end_matches(['/', '\\'])).replace('\\', "/");
        let path = self.path.replace('\\', "/");
        path.strip_prefix(&prefix).map(str::to_string).unwrap_or(path)
    }
}

/// Icon files matching the query by name or place in the project.
pub fn icon_options<'a>(icons: &'a [ProjectIconFile], project: &str, query: &str) -> Vec<(&'a ProjectIconFile, String)> {
    icons
        .iter()
        .map(|icon| (icon, icon.relative_path(project)))
        .filter(|(icon, relative)| matches_search_query(query, &[&icon.name, relative]))
        .collect()
}

#[cfg(not(target_family = "wasm"))]
const IGNORED_DIRECTORIES: [&str; 11] =
    [".git", ".output", ".next", ".nuxt", "build", "coverage", "dist", "node_modules", "out", "target", "vendor"];

#[cfg(not(target_family = "wasm"))]
fn is_likely_icon_file(name: &str) -> bool {
    let lower = name.to_lowercase();
    if !(lower.ends_with(".ico") || lower.ends_with(".png") || lower.ends_with(".svg")) {
        return false;
    }
    lower.contains("icon") || lower.contains("logo")
}

fn stem_is(name: &str, stems: &[&str]) -> bool {
    let Some((stem, extension)) = name.rsplit_once('.') else { return false };
    matches!(extension, "png" | "svg" | "ico") && stems.contains(&stem)
}

fn matches_separated(name: &str, first: &str, second: &str, extensions: &[&str]) -> bool {
    let Some((stem, extension)) = name.rsplit_once('.') else { return false };
    if !extensions.contains(&extension) {
        return false;
    }
    [String::new(), "-".into(), "_".into(), " ".into()]
        .iter()
        .any(|separator| stem == format!("{first}{separator}{second}"))
}

/// `scoreIconPath`: app icon folders and well-known names first, docs and tests last.
pub fn score_icon_path(path: &str, project: &str) -> i32 {
    let relative = path.strip_prefix(project).map(|rest| rest.trim_start_matches(['/', '\\'])).unwrap_or(path);
    let normalized = relative.to_lowercase().replace('\\', "/");
    let name = normalized.rsplit('/').next().unwrap_or(&normalized).to_string();
    let segments: Vec<&str> = normalized.split('/').filter(|segment| !segment.is_empty()).collect();
    let any = ["png", "svg", "ico"];
    let mut score = 0;
    if normalized.contains("src-tauri/icons/") {
        score += 120;
    }
    if normalized.contains("packages/desktop/resources/") {
        score += 110;
    }
    if normalized.contains("desktop/resources/") {
        score += 100;
    }
    if segments.contains(&"public") {
        score += 90;
    }
    if segments.len() <= 2 {
        score += 60;
    }
    if matches_separated(&name, "app", "icon", &any) {
        score += 80;
    }
    if stem_is(&name, &["icon"]) {
        score += 70;
    }
    if name == "favicon.ico" {
        score += 65;
    }
    if stem_is(&name, &["logo"]) {
        score += 55;
    }
    if matches_separated(&name, "icon", "512", &any) {
        score += 45;
    }
    if matches_separated(&name, "icon", "192", &any) {
        score += 40;
    }
    if ["", "-", "_", " "].iter().any(|a| ["", "-", "_", " "].iter().any(|b| stem_is(&name, &[format!("apple{a}touch{b}icon").as_str()]))) {
        score += 35;
    }
    if name.contains("mask") {
        score -= 25;
    }
    if segments.contains(&"docs") || segments.contains(&"test") || segments.contains(&"tests") {
        score -= 60;
    }
    score - segments.len() as i32
}

/// Looks four folders deep for icon, logo and favicon images, best first.
/// The web build's projects live on a server; it shows the generated icons.
#[cfg(target_family = "wasm")]
pub fn scan_icon_files(_: &str) -> std::io::Result<Vec<ProjectIconFile>> {
    Ok(Vec::new())
}

#[cfg(not(target_family = "wasm"))]
pub fn scan_icon_files(project: &str) -> std::io::Result<Vec<ProjectIconFile>> {
    std::fs::read_dir(project)?;
    let separator = if project.contains('\\') { '\\' } else { '/' };
    let mut results = Vec::new();
    let mut pending = vec![(project.to_string(), 0usize)];
    while let Some((dir, depth)) = pending.pop() {
        if depth > 4 {
            continue;
        }
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.is_empty() {
                continue;
            }
            let path = format!("{dir}{separator}{name}");
            let is_dir = entry.file_type().is_ok_and(|kind| kind.is_dir());
            if !is_dir && is_likely_icon_file(&name) {
                let score = score_icon_path(&path, project);
                results.push(ProjectIconFile { name, path, score });
            } else if is_dir && !name.starts_with('.') && !IGNORED_DIRECTORIES.contains(&name.as_str()) {
                pending.push((path, depth + 1));
            }
        }
    }
    let segments = |path: &str| path.split(['/', '\\']).filter(|segment| !segment.is_empty()).count();
    results.sort_by(|left, right| right.score.cmp(&left.score).then(segments(&left.path).cmp(&segments(&right.path))));
    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn categories_and_symbols() {
        assert_eq!(category(Some("emoji:🚀")), ProjectIconCategory::Emojis);
        assert_eq!(category(Some("icon:rocket")), ProjectIconCategory::Icons);
        assert_eq!(category(Some("/a/icon.png")), ProjectIconCategory::Files);
        assert_eq!(category(None), ProjectIconCategory::Files);
        assert_eq!(find_symbol("icon:lightning").unwrap().icon, Some("Bolt"));
        assert_eq!(find_symbol("emoji:🚀").unwrap().name, "Launch");
        assert!(find_symbol("icon:nope").is_none());
    }

    #[test]
    fn searching_symbols() {
        let names: Vec<_> = search_symbols(ProjectIconCategory::Icons, "deploy").iter().map(|s| s.name).collect();
        assert_eq!(names, vec!["Cloud"]);
        assert_eq!(search_symbols(ProjectIconCategory::Emojis, "ship release").len(), 1);
        assert_eq!(search_symbols(ProjectIconCategory::Emojis, "").len(), 32);
    }

    #[test]
    fn scores_favour_app_icons() {
        let project = "/p";
        assert!(score_icon_path("/p/src-tauri/icons/icon.png", project) > score_icon_path("/p/docs/logo.png", project));
        assert!(score_icon_path("/p/public/favicon.ico", project) > score_icon_path("/p/a/b/c/mask-icon.svg", project));
        assert_eq!(score_icon_path("/p/icon.png", project), 60 + 70 - 1);
    }

    #[test]
    fn scanning_finds_icons_and_skips_ignored_folders() {
        let dir = std::env::temp_dir().join(format!("athas-icons-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("public")).unwrap();
        std::fs::create_dir_all(dir.join("node_modules/x")).unwrap();
        std::fs::write(dir.join("public/favicon.ico"), b"").unwrap();
        std::fs::write(dir.join("logo.svg"), b"").unwrap();
        std::fs::write(dir.join("readme.png"), b"").unwrap();
        std::fs::write(dir.join("node_modules/x/icon.png"), b"").unwrap();
        let project = dir.to_string_lossy().into_owned();
        let found: Vec<String> = scan_icon_files(&project).unwrap().iter().map(|icon| icon.relative_path(&project)).collect();
        std::fs::remove_dir_all(&dir).ok();
        assert_eq!(found, vec!["public/favicon.ico", "logo.svg"]);
    }

    #[test]
    fn search_matching() {
        assert!(matches_search_query("app icon", &["src-tauri/icons/app-icon.png"]));
        assert!(matches_search_query("appicon", &["app-icon.png"]));
        assert!(!matches_search_query("logo", &["favicon.ico"]));
    }
}
