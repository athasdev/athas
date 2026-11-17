//! Skills: reusable instructions the user attaches to a prompt with `/skill-name`. They come from
//! the `aiSkills` setting (made in Athas or here), `SKILL.md` files in the project's
//! `.athas/skills/` and the user's `~/.claude/skills/` (and `~/.athas/skills/`), and enabled skill
//! extensions.
//!
//! Ported from Athas's `services/skill-library.ts`, `lib/composer-slash-commands.ts` and
//! `components/skills/skills-command.tsx`.

pub mod marketplace;
mod view;

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub use view::{SkillsEvent, SkillsView};

/// The centre view kind of the skills library; its id is empty.
pub const RESOURCE_KIND: &str = "skills";
/// The largest skill file read.
const MAX_SKILL_BYTES: u64 = 256 * 1024;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SkillSource {
    /// The `aiSkills` setting: editable here.
    Settings,
    /// A `SKILL.md` in the project.
    Project(PathBuf),
    /// A `SKILL.md` in the user's home folder.
    User(PathBuf),
    /// An enabled extension, by id.
    Extension(String),
}

impl SkillSource {
    pub fn label(&self) -> &'static str {
        match self {
            SkillSource::Settings => "Saved",
            SkillSource::Project(_) => "Project",
            SkillSource::User(_) => "User",
            SkillSource::Extension(_) => "Extension",
        }
    }

    pub fn file(&self) -> Option<&Path> {
        match self {
            SkillSource::Project(path) | SkillSource::User(path) => Some(path),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Skill {
    pub id: String,
    pub title: String,
    pub description: String,
    pub content: String,
    pub source: SkillSource,
}

impl Skill {
    /// The slash command that attaches it.
    pub fn command(&self) -> String {
        command_name(&self.title)
    }
}

/// A skill as the `aiSkills` setting stores it (Athas's `AIChatSkill`). Fields this app does not
/// use are kept as they were.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingSkill {
    pub id: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub content: String,
    #[serde(flatten)]
    pub other: serde_json::Map<String, Value>,
}

/// A skill's title as a command: "Write release notes" becomes `write-release-notes`.
pub fn command_name(title: &str) -> String {
    let mut name = String::new();
    for ch in title.trim().chars() {
        if ch.is_alphanumeric() {
            name.extend(ch.to_lowercase());
        } else if !name.ends_with('-') && !name.is_empty() {
            name.push('-');
        }
    }
    name.trim_end_matches('-').to_string()
}

/// A `SKILL.md`: its front matter's `name` and `description`, and the instructions after it.
pub fn parse_skill_file(text: &str) -> (Option<String>, Option<String>, String) {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let Some(rest) = text.strip_prefix("---") else { return (None, None, text.trim().to_string()) };
    let Some(end) = rest.find("\n---") else { return (None, None, text.trim().to_string()) };
    let (front, body) = (&rest[..end], &rest[end + 4..]);
    let field = |key: &str| {
        front.lines().find_map(|line| {
            let (name, value) = line.split_once(':')?;
            (name.trim() == key).then(|| value.trim().trim_matches(['"', '\'']).to_string()).filter(|value| !value.is_empty())
        })
    };
    (field("name"), field("description"), body.trim().to_string())
}

/// The skills saved in the `aiSkills` setting.
pub fn setting_skills(values: &[Value]) -> Vec<SettingSkill> {
    values.iter().filter_map(|value| serde_json::from_value::<SettingSkill>(value.clone()).ok()).filter(|skill| !skill.title.trim().is_empty()).collect()
}

/// `SKILL.md` files in `<dir>/<name>/SKILL.md` (and loose `<dir>/<name>.md`).
fn skill_files(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else { return Vec::new() };
    let mut files: Vec<PathBuf> = entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            if path.is_dir() {
                let file = path.join("SKILL.md");
                file.is_file().then_some(file)
            } else {
                path.extension().is_some_and(|extension| extension == "md").then_some(path)
            }
        })
        .filter(|path| std::fs::metadata(path).is_ok_and(|meta| meta.len() <= MAX_SKILL_BYTES))
        .collect();
    files.sort();
    files
}

fn file_skill(path: &Path, source: SkillSource) -> Option<Skill> {
    let text = std::fs::read_to_string(path).ok()?;
    let (name, description, content) = parse_skill_file(&text);
    let fallback = if path.file_name().is_some_and(|name| name == "SKILL.md") { path.parent()?.file_name()? } else { path.file_stem()? };
    let title = name.unwrap_or_else(|| fallback.to_string_lossy().into_owned());
    Some(Skill { id: format!("file:{}", path.display()), title, description: description.unwrap_or_default(), content, source })
}

/// Where skills are looked for on disk.
#[derive(Clone, Debug, Default)]
pub struct SkillRoots {
    pub project: Option<PathBuf>,
    pub home: Option<PathBuf>,
}

impl SkillRoots {
    pub fn new(project: Option<PathBuf>) -> Self {
        #[cfg(not(target_family = "wasm"))]
        let home = dirs::home_dir();
        #[cfg(target_family = "wasm")]
        let home = None;
        Self { project, home }
    }

    /// The folder new project skills go in.
    pub fn project_dir(&self) -> Option<PathBuf> {
        self.project.as_ref().map(|project| project.join(".athas").join("skills"))
    }
}

/// Every skill: saved ones, then the project's, the user's and extensions'. A later skill with
/// the same command as an earlier one is left out.
pub fn load(settings: &[Value], roots: &SkillRoots, extension_skills: &[(String, String, Option<String>, PathBuf)]) -> Vec<Skill> {
    let mut skills: Vec<Skill> = setting_skills(settings)
        .into_iter()
        .map(|skill| Skill { id: skill.id, title: skill.title, description: skill.description.unwrap_or_default(), content: skill.content, source: SkillSource::Settings })
        .collect();
    if let Some(dir) = roots.project_dir() {
        skills.extend(skill_files(&dir).iter().filter_map(|path| file_skill(path, SkillSource::Project(path.clone()))));
    }
    if let Some(home) = &roots.home {
        for dir in [home.join(".athas").join("skills"), home.join(".claude").join("skills")] {
            skills.extend(skill_files(&dir).iter().filter_map(|path| file_skill(path, SkillSource::User(path.clone()))));
        }
    }
    for (extension, title, description, file) in extension_skills {
        if let Some(mut skill) = file_skill(file, SkillSource::Extension(extension.clone())) {
            skill.title = title.clone();
            if let Some(description) = description {
                skill.description = description.clone();
            }
            skills.push(skill);
        }
    }
    let mut seen = std::collections::HashSet::new();
    skills.retain(|skill| !skill.content.trim().is_empty() && seen.insert(skill.command()));
    skills
}

/// Enabled skill extensions as `load` takes them, from `extensions::get(cx).skills()`.
pub fn extension_skills(cx: &gpui::App) -> Vec<(String, String, Option<String>, PathBuf)> {
    let Some(extensions) = cx.try_global::<extensions::Extensions>() else { return Vec::new() };
    extensions
        .skills()
        .into_iter()
        .filter_map(|(id, skill, folder)| Some((id, skill.name, skill.description, folder?.join(skill.path))))
        .collect()
}

/// The `aiSkills` setting with `skill` added, or replacing the one with its id.
pub fn upsert_setting(values: &[Value], skill: SettingSkill) -> Vec<Value> {
    let mut values = values.to_vec();
    let value = serde_json::to_value(&skill).unwrap_or_default();
    match values.iter().position(|existing| existing.get("id").and_then(Value::as_str) == Some(skill.id.as_str())) {
        Some(index) => values[index] = value,
        None => values.push(value),
    }
    values
}

pub fn remove_setting(values: &[Value], id: &str) -> Vec<Value> {
    values.iter().filter(|value| value.get("id").and_then(Value::as_str) != Some(id)).cloned().collect()
}

/// A new skill id, like Athas's.
pub fn new_id() -> String {
    let nanos = web_time::SystemTime::now().duration_since(web_time::UNIX_EPOCH).map_or(0, |duration| duration.as_nanos());
    format!("skill-{nanos:x}")
}

/// The text a skill adds to a prompt.
pub fn prompt_text(title: &str, content: &str) -> String {
    format!("Use the skill \u{201c}{title}\u{201d}:\n\n{content}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn titles_become_commands() {
        assert_eq!(command_name("Write release notes"), "write-release-notes");
        assert_eq!(command_name("  Fix: CI / lint! "), "fix-ci-lint");
    }

    #[test]
    fn skill_files_have_front_matter() {
        let (name, description, body) = parse_skill_file("---\nname: review\ndescription: \"Review a diff\"\n---\n\nLook for bugs.\n");
        assert_eq!((name.as_deref(), description.as_deref(), body.as_str()), (Some("review"), Some("Review a diff"), "Look for bugs."));
        assert_eq!(parse_skill_file("Just text"), (None, None, "Just text".into()));
    }

    #[test]
    fn skills_load_from_settings_project_and_home() {
        let project = tempfile::tempdir().unwrap();
        let home = tempfile::tempdir().unwrap();
        let skill_dir = project.path().join(".athas/skills/release");
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(skill_dir.join("SKILL.md"), "---\nname: Release notes\n---\nSummarize the changes.").unwrap();
        let claude = home.path().join(".claude/skills/tests");
        std::fs::create_dir_all(&claude).unwrap();
        std::fs::write(claude.join("SKILL.md"), "Write tests first.").unwrap();
        // Same command as the saved skill: left out.
        std::fs::write(home.path().join(".claude/skills/review.md"), "Other review").unwrap();
        let settings = vec![serde_json::json!({ "id": "s1", "title": "Review", "content": "Review the diff.", "source": "local" })];
        let roots = SkillRoots { project: Some(project.path().into()), home: Some(home.path().into()) };
        let skills = load(&settings, &roots, &[]);
        let titles: Vec<&str> = skills.iter().map(|skill| skill.title.as_str()).collect();
        assert_eq!(titles, ["Review", "Release notes", "tests"]);
        assert!(matches!(skills[1].source, SkillSource::Project(_)));
        assert_eq!(skills[2].command(), "tests");
    }

    #[test]
    fn saved_skills_keep_fields_this_app_does_not_know() {
        let values = vec![serde_json::json!({ "id": "s1", "title": "A", "content": "x", "sourceUrl": "https://x" })];
        let mut skill = setting_skills(&values).remove(0);
        skill.content = "y".into();
        let updated = upsert_setting(&values, skill);
        assert_eq!(updated[0]["sourceUrl"], "https://x");
        assert_eq!(updated[0]["content"], "y");
        assert!(remove_setting(&updated, "s1").is_empty());
    }
}
