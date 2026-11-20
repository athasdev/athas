//! Who serves a gateway model and which models to suggest first (`lib/model-vendor.ts`), and the
//! search a long model menu gets (`components/input/composer-model-submenus.tsx`).

use ui::{IconName, MenuEntry, MenuItem};

/// Longer model lists get a search field and, when the catalog has them, recommended picks.
pub const SHORT_MODEL_LIST_LENGTH: usize = 8;

const VENDOR_NAMES: &[(&str, &str)] = &[
    ("openai", "OpenAI"),
    ("anthropic", "Anthropic"),
    ("google", "Google"),
    ("qwen", "Qwen"),
    ("alibaba", "Alibaba"),
    ("x-ai", "xAI"),
    ("xai", "xAI"),
    ("deepseek", "DeepSeek"),
    ("mistral", "Mistral"),
    ("mistralai", "Mistral"),
    ("moonshotai", "Moonshot"),
    ("minimax", "MiniMax"),
    ("meta-llama", "Meta"),
    ("zai", "Z.ai"),
];

fn vendor(model_id: &str) -> Option<String> {
    let slash = model_id.find('/')?;
    (slash > 0).then(|| model_id[..slash].to_lowercase())
}

/// The vendor behind a gateway `vendor/model` id, for labelling rows.
pub fn vendor_name(model_id: &str) -> Option<String> {
    let vendor = vendor(model_id)?;
    Some(VENDOR_NAMES.iter().find(|(id, _)| *id == vendor).map_or(vendor.clone(), |(_, name)| name.to_string()))
}

/// A provider's mark (`ProviderIcon`): the icon its extension gave it, else its flat mark.
pub fn provider_mark(id: &str, size: gpui::Pixels, color: gpui::Hsla) -> gpui::AnyElement {
    use gpui::{IntoElement as _, Styled as _};
    match ai_providers::external::external_provider_icon(id) {
        Some(icon) if icon.starts_with("http://") || icon.starts_with("https://") => gpui::img(gpui::SharedString::from(icon)).flex_none().size(size).into_any_element(),
        Some(icon) if std::path::Path::new(&icon).is_absolute() => gpui::img(std::sync::Arc::<std::path::Path>::from(std::path::Path::new(&icon))).flex_none().size(size).into_any_element(),
        _ => ui::Icon::new(provider_icon(id)).size(ui::IconSize::Custom(size)).color(color).into_any_element(),
    }
}

/// An agent's mark as Athas draws it (`ProviderIcon`): its artwork when it has one, else its
/// flat mark in `color`.
pub fn agent_mark(id: &str, size: gpui::Pixels, color: gpui::Hsla) -> gpui::AnyElement {
    use gpui::IntoElement as _;
    match ui::BrandMark::agent(crate::acp::agents::catalog_id(id)) {
        Some(mark) => mark.size(size).into_any_element(),
        None => ui::Icon::new(provider_icon(id)).size(ui::IconSize::Custom(size)).color(color).into_any_element(),
    }
}

/// The flat mark of a provider, vendor or agent (`components/icons/provider-icons.tsx`); a
/// sparkle for one without.
pub fn provider_icon(id: &str) -> IconName {
    match crate::acp::agents::catalog_id(id) {
        "openai" | "codex" | "codex-cli" | "codex-acp" => IconName::BrandOpenai,
        "anthropic" | "claude" | "claude-acp" | "claude-code" => IconName::BrandClaude,
        "gemini" | "google" | "gemini-cli" => IconName::BrandGemini,
        "grok" | "xai" | "x-ai" => IconName::BrandXai,
        "deepseek" => IconName::BrandDeepseek,
        "mistral" | "mistralai" => IconName::BrandMistral,
        "ollama" => IconName::BrandOllama,
        "openrouter" => IconName::BrandOpenrouter,
        "moonshot" | "moonshotai" | "kimi-cli" => IconName::BrandMoonshot,
        "qwen" | "alibaba" | "qwen-code" => IconName::BrandQwen,
        "opencode" => IconName::BrandOpencode,
        "github-copilot" | "copilot" | "github-copilot-cli" => IconName::BrandGithub,
        _ => IconName::Sparkle,
    }
}

/// A model row's mark: a gateway `vendor/model` id shows its vendor's, others the provider's.
pub fn model_icon(provider_id: &str, model_id: &str) -> IconName {
    match vendor(model_id) {
        Some(vendor) => provider_icon(&vendor),
        None => provider_icon(provider_id),
    }
}

/// The patterns of `RECOMMENDED_FAMILIES`, strongest fallback last within each family.
fn family_matches(family: usize, pattern: usize, id: &str) -> bool {
    let gpt_version = |rest: &str, suffix: &str| {
        rest.strip_suffix(suffix).is_some_and(|version| !version.is_empty() && version.chars().all(|c| c.is_ascii_digit() || c == '.'))
    };
    match (family, pattern) {
        (0, 0) => id.starts_with("anthropic/claude-sonnet-"),
        (1, 0) => id.strip_prefix("openai/gpt-").is_some_and(|rest| gpt_version(rest, "-terra")),
        (1, 1) => id.strip_prefix("openai/gpt-").is_some_and(|rest| gpt_version(rest, "-sol")),
        (1, 2) => id.strip_prefix("openai/gpt-").is_some_and(|rest| !rest.contains("codex")),
        (2, 0) => id.strip_prefix("google/gemini-").is_some_and(|rest| {
            let version: String = rest.chars().take_while(|c| c.is_ascii_digit() || *c == '.').collect();
            !version.is_empty() && rest[version.len()..].starts_with("-pro")
        }),
        _ => false,
    }
}

const FAMILY_PATTERNS: [usize; 3] = [1, 3, 1];

/// Athas Automatic plus the catalog's first match for each recommended family; empty when the
/// catalog has none of them.
pub fn recommended<'a>(ids: impl IntoIterator<Item = &'a str> + Clone) -> Vec<&'a str> {
    let mut picks = Vec::new();
    for (family, patterns) in FAMILY_PATTERNS.iter().enumerate() {
        if let Some(id) = (0..*patterns).find_map(|pattern| ids.clone().into_iter().find(|id| family_matches(family, pattern, id))) {
            picks.push(id);
        }
    }
    if picks.is_empty() {
        return picks;
    }
    if let Some(auto) = ids.into_iter().find(|id| *id == "auto") {
        picks.insert(0, auto);
    }
    picks
}

/// A model menu's rows: for a long list, the recommended picks (hidden while searching) above
/// "All models". `item` makes the row of a choice by its index.
pub fn model_entries(ids: &[String], mut item: impl FnMut(usize) -> MenuItem) -> Vec<MenuEntry> {
    let mut entries = Vec::new();
    let picks = if ids.len() > SHORT_MODEL_LIST_LENGTH { recommended(ids.iter().map(String::as_str)) } else { Vec::new() };
    if !picks.is_empty() {
        entries.push(MenuEntry::Label("Recommended".into()));
        for pick in &picks {
            if let Some(index) = ids.iter().position(|id| id == pick) {
                entries.push(item(index).hidden_while_searching().into());
            }
        }
        entries.push(MenuEntry::Label("All models".into()));
    }
    entries.extend((0..ids.len()).map(|index| item(index).keywords(ids[index].clone()).into()));
    entries
}

pub fn is_long(count: usize) -> bool {
    count > SHORT_MODEL_LIST_LENGTH
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_gateway_vendors() {
        assert_eq!(vendor_name("x-ai/grok-4").as_deref(), Some("xAI"));
        assert_eq!(vendor_name("acme/model").as_deref(), Some("acme"));
        assert_eq!(vendor_name("gpt-5"), None);
        assert_eq!(model_icon("athas", "x-ai/grok-4"), IconName::BrandXai);
        assert_eq!(model_icon("openai", "gpt-5"), IconName::BrandOpenai);
        assert_eq!(provider_icon("claude-acp"), IconName::BrandClaude);
        assert_eq!(provider_icon("athas"), IconName::Sparkle);
    }

    #[test]
    fn recommends_one_model_per_family_after_automatic() {
        let ids = ["auto", "openai/gpt-5.1-codex", "openai/gpt-5.1", "openai/gpt-5.2-sol", "anthropic/claude-opus-4", "anthropic/claude-sonnet-5", "google/gemini-3-pro-preview", "meta-llama/llama-4"];
        assert_eq!(recommended(ids.iter().copied()), ["auto", "anthropic/claude-sonnet-5", "openai/gpt-5.2-sol", "google/gemini-3-pro-preview"]);
        assert!(recommended(["auto", "llama3"].iter().copied()).is_empty());
    }
}
