//! New Project (`project-picker/utils/new-project-model.ts`): what a new project starts from, its
//! name rules, where it goes and the command that sets a starter up.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NewProjectSource {
    Empty,
    NextJs,
    ViteReact,
    Clone,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum PackageManager {
    #[default]
    Npm,
    Pnpm,
    Bun,
}

impl PackageManager {
    pub const ALL: [PackageManager; 3] = [PackageManager::Npm, PackageManager::Pnpm, PackageManager::Bun];

    pub fn id(self) -> &'static str {
        match self {
            PackageManager::Npm => "npm",
            PackageManager::Pnpm => "pnpm",
            PackageManager::Bun => "bun",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            PackageManager::Npm => "npm",
            PackageManager::Pnpm => "pnpm",
            PackageManager::Bun => "Bun",
        }
    }

    pub fn from_id(id: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|manager| manager.id() == id)
    }
}

const WINDOWS_RESERVED_NAMES: [&str; 22] = [
    "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9", "lpt1", "lpt2",
    "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
];

/// Why a project name cannot be used on every platform, if it cannot.
pub fn project_name_error(name: &str) -> Option<&'static str> {
    let name = name.trim();
    if name.is_empty() {
        return Some("Enter a project name.");
    }
    if name == "." || name == ".." {
        return Some("Project names cannot be path traversal segments.");
    }
    if name.chars().any(|character| (character as u32) < 32 || "<>:\"/\\|?*".contains(character)) {
        return Some("Project names cannot contain path separators or reserved characters.");
    }
    if name.ends_with('.') || name.ends_with(' ') {
        return Some("Project names cannot end with a period or space.");
    }
    let base = name.split('.').next().unwrap_or("").to_lowercase();
    if !base.is_empty() && WINDOWS_RESERVED_NAMES.contains(&base.as_str()) {
        return Some("Choose a project name that is supported on every platform.");
    }
    None
}

fn percent_decode(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hex = value.get(index + 1..index + 3)?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            index += 3;
        } else {
            out.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// The repository's name, from the last part of its URL without `.git`.
pub fn infer_project_name_from_repository_url(url: &str) -> String {
    let trimmed = url.trim().trim_end_matches(['/', '\\']);
    if trimmed.is_empty() {
        return String::new();
    }
    let last = trimmed.split(['/', ':']).rfind(|segment| !segment.is_empty()).unwrap_or("");
    let without_git = if last.to_lowercase().ends_with(".git") { &last[..last.len() - 4] } else { last };
    percent_decode(without_git).unwrap_or_else(|| without_git.to_string())
}

/// `joinPath`: the name after the location, with the location's separator between them.
pub fn new_project_path(location: &str, name: &str) -> String {
    let location = location.trim();
    let name = name.trim().trim_matches(['/', '\\']);
    let windows_drive = location.len() >= 2 && location.as_bytes()[1] == b':' && location.as_bytes()[0].is_ascii_alphabetic();
    let separator = if location.starts_with("remote://") || location.starts_with("wsl://") {
        '/'
    } else if location.contains('\\') || windows_drive {
        '\\'
    } else {
        '/'
    };
    if name.is_empty() {
        return location.to_string();
    }
    if location.ends_with(['/', '\\']) {
        format!("{location}{name}")
    } else {
        format!("{location}{separator}{name}")
    }
}

/// The command that sets a web starter up in the new folder, run in a terminal.
pub fn starter_command(source: NewProjectSource, manager: PackageManager) -> Option<String> {
    match source {
        NewProjectSource::NextJs => {
            let runner = match manager {
                PackageManager::Npm => "npx --yes",
                PackageManager::Pnpm => "pnpm dlx",
                PackageManager::Bun => "bunx",
            };
            let flag = match manager {
                PackageManager::Npm => "--use-npm",
                PackageManager::Pnpm => "--use-pnpm",
                PackageManager::Bun => "--use-bun",
            };
            Some(format!(
                "{runner} create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias \"@/*\" {flag}"
            ))
        }
        NewProjectSource::ViteReact => {
            let create = match manager {
                PackageManager::Npm => "npm create vite@latest . -- --template react-ts",
                PackageManager::Pnpm => "pnpm create vite@latest . --template react-ts",
                PackageManager::Bun => "bun create vite@latest . --template react-ts",
            };
            Some(format!("{create} && {} install", manager.id()))
        }
        NewProjectSource::Empty | NewProjectSource::Clone => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names() {
        assert_eq!(project_name_error(""), Some("Enter a project name."));
        assert_eq!(project_name_error(".."), Some("Project names cannot be path traversal segments."));
        assert!(project_name_error("a/b").is_some());
        assert!(project_name_error("app.").is_some());
        assert!(project_name_error("con.txt").is_some());
        assert_eq!(project_name_error("my-project"), None);
    }

    #[test]
    fn repository_names() {
        assert_eq!(infer_project_name_from_repository_url("https://github.com/athasdev/athas.git"), "athas");
        assert_eq!(infer_project_name_from_repository_url("git@github.com:owner/my%20repo.git/"), "my repo");
        assert_eq!(infer_project_name_from_repository_url("  "), "");
    }

    #[test]
    fn paths_and_commands() {
        assert_eq!(new_project_path("/Users/me/", " app "), "/Users/me/app");
        assert_eq!(new_project_path("/Users/me", "app"), "/Users/me/app");
        assert_eq!(new_project_path("/", "app"), "/app");
        assert_eq!(new_project_path("C:\\code", "app"), "C:\\code\\app");
        assert_eq!(
            starter_command(NewProjectSource::ViteReact, PackageManager::Bun).unwrap(),
            "bun create vite@latest . --template react-ts && bun install"
        );
        assert!(starter_command(NewProjectSource::NextJs, PackageManager::Pnpm).unwrap().starts_with("pnpm dlx create-next-app@latest"));
        assert_eq!(starter_command(NewProjectSource::Empty, PackageManager::Npm), None);
    }
}
