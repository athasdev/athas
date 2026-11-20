//! The skills marketplace: skills the extension catalog offers, installed into the `aiSkills`
//! setting with their upstream text kept, so catalog updates are noticed and a local edit is
//! kept apart from them.
//!
//! Ported from Athas's `services/skill-library.ts` and `extensions/marketplace/marketplace-skills.ts`.

use serde_json::{Map, Value};

use super::SettingSkill;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct MarketplaceSkill {
    pub id: String,
    pub title: String,
    pub description: String,
    /// The instructions, when the catalog carries them; otherwise read from `detail_url`.
    pub content: Option<String>,
    pub author: Option<String>,
    pub license: Option<String>,
    pub version: Option<String>,
    pub tags: Vec<String>,
    pub detail_url: Option<String>,
    pub source_url: Option<String>,
    pub updated_at: Option<String>,
}

fn text(entry: &Map<String, Value>, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| entry.get(*key).and_then(Value::as_str).map(str::trim).filter(|value| !value.is_empty()).map(str::to_string))
}

fn slug(value: &str) -> String {
    let mut slug = String::new();
    for char in value.to_lowercase().chars() {
        if char.is_ascii_alphanumeric() {
            slug.push(char);
        } else if !slug.ends_with('-') {
            slug.push('-');
        }
    }
    slug.trim_matches('-').chars().take(80).collect()
}

/// A registry entry read leniently: `title`, `name` or `displayName`; `content`,
/// `instructions`, `prompt` or `body`. Entries without a title, or without instructions and a
/// place to read them from, are left out.
pub fn normalize(entry: &Map<String, Value>) -> Option<MarketplaceSkill> {
    let title = text(entry, &["title", "name", "displayName"])?;
    let content = text(entry, &["content", "instructions", "prompt", "body"]);
    let detail_url = text(entry, &["detailUrl", "manifestUrl", "contentUrl"]);
    if content.is_none() && detail_url.is_none() {
        return None;
    }
    let id = text(entry, &["id", "slug"]).unwrap_or_else(|| format!("skill.{}", slug(&title)));
    let description = text(entry, &["description"])
        .or_else(|| content.as_ref().map(|content| content.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(160).collect()))
        .unwrap_or_else(|| "Reusable Agent instructions.".into());
    let tags = entry.get("tags").and_then(Value::as_array).map(|tags| tags.iter().filter_map(Value::as_str).filter(|tag| !tag.trim().is_empty()).map(str::to_string).collect()).unwrap_or_default();
    Some(MarketplaceSkill {
        id,
        title,
        description,
        content,
        author: text(entry, &["author", "publisher"]),
        license: text(entry, &["license"]),
        version: text(entry, &["version"]),
        tags,
        detail_url,
        source_url: text(entry, &["sourceUrl", "url"]),
        updated_at: text(entry, &["updatedAt", "updated_at"]),
    })
}

/// The skills the extension catalog offers: licensed extensions' skill contributions, read from
/// the CDN at `base_url`.
pub fn from_catalog(entries: &[extensions::CatalogEntry], base_url: &str) -> Vec<MarketplaceSkill> {
    let mut seen = std::collections::HashSet::new();
    entries
        .iter()
        .filter(|entry| entry.manifest.license.as_deref().is_some_and(|license| !license.trim().is_empty()))
        .flat_map(|entry| {
            let manifest = &entry.manifest;
            manifest.skills().map(move |skill| {
                let detail_url = if skill.path.contains("://") {
                    skill.path.clone()
                } else {
                    format!("{}/{}/{}", base_url.trim_end_matches('/'), entry.path, skill.path.trim_start_matches("./").trim_start_matches('/'))
                };
                MarketplaceSkill {
                    id: skill.id.clone(),
                    title: skill.name.clone(),
                    description: skill.description.clone().filter(|description| !description.trim().is_empty()).unwrap_or_else(|| manifest.description.clone()),
                    content: None,
                    author: Some(manifest.publisher.clone()).filter(|publisher| !publisher.is_empty()),
                    license: manifest.license.clone(),
                    version: Some(manifest.version.clone()).filter(|version| !version.is_empty()),
                    tags: skill.tags.clone(),
                    detail_url: Some(detail_url),
                    source_url: manifest.repository.as_ref().map(|repository| repository.url.clone()),
                    updated_at: None,
                }
            })
        })
        .filter(|skill| seen.insert(skill.id.clone()))
        .collect()
}

/// `skill` with its instructions, read from its `detail_url` with `fetch` when the catalog did
/// not carry them: a JSON entry, or Markdown whose front matter is dropped.
pub fn resolve(skill: &MarketplaceSkill, fetch: impl FnOnce(&str) -> Result<String, String>) -> Result<MarketplaceSkill, String> {
    if skill.content.as_deref().is_some_and(|content| !content.trim().is_empty()) {
        return Ok(skill.clone());
    }
    let missing = || format!("{} does not provide installable instructions", skill.title);
    let url = skill.detail_url.as_deref().ok_or_else(missing)?;
    let body = fetch(url).map_err(|error| format!("Could not load {} ({error})", skill.title))?;
    let detail = match serde_json::from_str::<Value>(&body) {
        Ok(Value::Object(detail)) => detail,
        _ => {
            let (_, _, content) = super::parse_skill_file(&body);
            Map::from_iter([("content".to_string(), Value::String(content.trim().to_string()))])
        }
    };
    let mut merged = to_entry(skill);
    merged.extend(detail);
    let resolved = normalize(&merged).filter(|resolved| resolved.content.is_some()).ok_or_else(missing)?;
    Ok(resolved)
}

fn to_entry(skill: &MarketplaceSkill) -> Map<String, Value> {
    let mut entry = Map::new();
    let mut put = |key: &str, value: &Option<String>| {
        if let Some(value) = value {
            entry.insert(key.to_string(), Value::String(value.clone()));
        }
    };
    put("id", &Some(skill.id.clone()));
    put("title", &Some(skill.title.clone()));
    put("description", &Some(skill.description.clone()));
    put("content", &skill.content);
    put("author", &skill.author);
    put("license", &skill.license);
    put("version", &skill.version);
    put("detailUrl", &skill.detail_url);
    put("sourceUrl", &skill.source_url);
    put("updatedAt", &skill.updated_at);
    entry.insert("tags".into(), Value::Array(skill.tags.iter().cloned().map(Value::String).collect()));
    entry
}

fn other_text<'a>(skill: &'a SettingSkill, key: &str) -> Option<&'a str> {
    skill.other.get(key).and_then(Value::as_str)
}

fn is_marketplace(skill: &SettingSkill) -> bool {
    other_text(skill, "source") == Some("marketplace")
}

/// The saved skill installed from `marketplace_id`, if any.
pub fn installed<'a>(skills: &'a [SettingSkill], marketplace_id: &str) -> Option<&'a SettingSkill> {
    skills.iter().find(|skill| other_text(skill, "sourceId") == Some(marketplace_id) || skill.id == marketplace_id)
}

fn upstream_title(skill: &SettingSkill) -> &str {
    other_text(skill, "upstreamTitle").unwrap_or(&skill.title)
}

fn upstream_content(skill: &SettingSkill) -> &str {
    other_text(skill, "upstreamContent").unwrap_or(&skill.content)
}

fn upstream_description(skill: &SettingSkill) -> &str {
    other_text(skill, "upstreamDescription").or(skill.description.as_deref()).unwrap_or_default()
}

/// Whether a catalog skill was edited here since it was installed.
pub fn has_local_override(skill: &SettingSkill) -> bool {
    is_marketplace(skill)
        && (skill.other.get("localOverride").and_then(Value::as_bool) == Some(true) || skill.title != upstream_title(skill) || skill.content != upstream_content(skill))
}

/// A catalog skill back at the catalog's text, its local edit dropped (`resetSkillLocalOverride`).
pub fn reset_local_override(skill: &SettingSkill) -> SettingSkill {
    let mut reset = skill.clone();
    if !is_marketplace(skill) {
        return reset;
    }
    reset.title = upstream_title(skill).to_string();
    reset.description = Some(upstream_description(skill).to_string()).filter(|text| !text.is_empty()).or_else(|| skill.description.clone());
    reset.content = upstream_content(skill).to_string();
    reset.other.insert("localOverride".into(), Value::Bool(false));
    reset
}

/// Whether the skill came from the catalog, so the library removes rather than deletes it.
pub fn from_marketplace(skill: &SettingSkill) -> bool {
    is_marketplace(skill)
}

/// Whether the catalog has a newer version of an installed skill.
pub fn has_update(installed: &SettingSkill, marketplace: &MarketplaceSkill) -> bool {
    if !is_marketplace(installed) {
        return false;
    }
    if let Some(version) = &marketplace.version
        && other_text(installed, "version") != Some(version.as_str())
    {
        return true;
    }
    if let Some(updated) = &marketplace.updated_at
        && other_text(installed, "upstreamUpdatedAt") != Some(updated.as_str())
    {
        return true;
    }
    upstream_title(installed) != marketplace.title
        || upstream_description(installed) != marketplace.description
        || marketplace.content.as_deref().is_some_and(|content| upstream_content(installed) != content)
}

fn set_upstream(skill: &mut SettingSkill, marketplace: &MarketplaceSkill) {
    let content = marketplace.content.clone().unwrap_or_default();
    let mut put = |key: &str, value: Option<String>| match value {
        Some(value) => {
            skill.other.insert(key.into(), Value::String(value));
        }
        None => {
            skill.other.remove(key);
        }
    };
    put("source", Some("marketplace".into()));
    put("sourceId", Some(marketplace.id.clone()));
    put("author", marketplace.author.clone());
    put("license", marketplace.license.clone());
    put("sourceUrl", marketplace.source_url.clone());
    put("version", marketplace.version.clone());
    put("upstreamTitle", Some(marketplace.title.clone()));
    put("upstreamDescription", Some(marketplace.description.clone()));
    put("upstreamContent", Some(content));
    put("upstreamUpdatedAt", marketplace.updated_at.clone());
    skill.other.insert("tags".into(), Value::Array(marketplace.tags.iter().cloned().map(Value::String).collect()));
}

/// A saved skill made from a resolved catalog skill.
/// Installs a catalog skill into the library, or brings an installed one up to date, and
/// answers its id there.
pub fn install(skill: MarketplaceSkill, cx: &mut gpui::App) -> gpui::Task<Result<String, String>> {
    use gpui::AppContext as _;
    cx.spawn(async move |cx| {
        let resolved = cx.background_spawn(async move { resolve(&skill, fetch_text) }).await?;
        cx.update(|cx| {
            if cx.try_global::<settings::SettingsStore>().is_none() {
                return Err("Settings are not available".to_string());
            }
            let values = settings::get(cx).ai_skills.clone();
            let saved = super::setting_skills(&values);
            let skill = match installed(&saved, &resolved.id) {
                Some(installed) => update(installed, &resolved),
                None => create(&resolved),
            };
            let id = skill.id.clone();
            let updated = super::upsert_setting(&values, skill);
            settings::update(cx, |settings| settings.ai_skills = updated);
            Ok(id)
        })
    })
}

pub fn create(marketplace: &MarketplaceSkill) -> SettingSkill {
    let mut skill = SettingSkill {
        id: super::new_id(),
        title: marketplace.title.clone(),
        description: Some(marketplace.description.clone()),
        content: marketplace.content.clone().unwrap_or_default(),
        other: Map::new(),
    };
    set_upstream(&mut skill, marketplace);
    skill
}

/// An installed skill brought up to the catalog's version; a local edit of its title and
/// instructions is kept.
pub fn update(installed: &SettingSkill, marketplace: &MarketplaceSkill) -> SettingSkill {
    let local = has_local_override(installed);
    let mut skill = installed.clone();
    if !local {
        skill.title = marketplace.title.clone();
        skill.content = marketplace.content.clone().unwrap_or_default();
    }
    skill.description = Some(marketplace.description.clone());
    set_upstream(&mut skill, marketplace);
    skill
}

/// Downloads a skill's text. Blocking; run it off the main thread.
#[cfg(not(target_family = "wasm"))]
pub fn fetch_text(url: &str) -> Result<String, String> {
    extensions::installer::get_text(url).map_err(|error| error.to_string())
}

#[cfg(target_family = "wasm")]
pub fn fetch_text(_url: &str) -> Result<String, String> {
    Err("the skills marketplace needs the desktop app".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn entry(value: Value) -> Map<String, Value> {
        value.as_object().cloned().unwrap()
    }

    #[test]
    fn registry_entries_read_leniently() {
        let skill = normalize(&entry(json!({ "name": "Write Release Notes!", "instructions": "Summarise   the\nchanges." }))).unwrap();
        assert_eq!(skill.id, "skill.write-release-notes");
        assert_eq!(skill.description, "Summarise the changes.");
        assert!(normalize(&entry(json!({ "title": "No body" }))).is_none());
    }

    #[test]
    fn installs_from_a_remote_catalog_and_notices_updates() {
        let server = ai_providers::test_support::MockServer::start();
        server.push(ai_providers::test_support::MockResponse { status: 200, content_type: "text/markdown".into(), body: "---\nname: Review\n---\nReview the diff.\n".into() });
        let listed = MarketplaceSkill {
            id: "athas.review".into(),
            title: "Review".into(),
            description: "Reviews changes".into(),
            version: Some("1.0.0".into()),
            detail_url: Some(format!("{}/skills/review/SKILL.md", server.url)),
            ..Default::default()
        };
        let resolved = resolve(&listed, fetch_text).unwrap();
        assert_eq!(resolved.content.as_deref(), Some("Review the diff."));
        assert_eq!(server.requests()[0].path, "/skills/review/SKILL.md");

        let installed = create(&resolved);
        assert_eq!(super::super::setting_skills(&[serde_json::to_value(&installed).unwrap()])[0].other["sourceId"], "athas.review");
        assert!(!has_update(&installed, &listed));
        assert!(!has_local_override(&installed));

        let mut edited = installed.clone();
        edited.content = "Review the diff carefully.".into();
        assert!(has_local_override(&edited));
        let newer = MarketplaceSkill { version: Some("1.1.0".into()), content: Some("Review the whole diff.".into()), ..resolved };
        assert!(has_update(&edited, &newer));
        let updated = update(&edited, &newer);
        assert_eq!(updated.content, "Review the diff carefully.");
        assert_eq!(updated.other["upstreamContent"], "Review the whole diff.");
        assert!(!has_update(&updated, &newer));
        let reset = reset_local_override(&updated);
        assert_eq!(reset.content, "Review the whole diff.");
        assert!(!has_local_override(&reset));
        assert!(from_marketplace(&reset));
        assert_eq!(installed_ids(&[updated]), ["athas.review"]);
    }

    fn installed_ids(skills: &[SettingSkill]) -> Vec<String> {
        skills.iter().filter_map(|skill| skill.other.get("sourceId").and_then(Value::as_str).map(str::to_string)).collect()
    }

    #[test]
    fn failed_downloads_name_the_skill() {
        let listed = MarketplaceSkill { title: "Docs".into(), detail_url: Some("http://x".into()), ..Default::default() };
        assert_eq!(resolve(&listed, |_| Err("404".into())).unwrap_err(), "Could not load Docs (404)");
    }
}
