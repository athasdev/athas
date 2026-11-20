//! Session titles. Ported from Athas's `features/ai/utils/chat-session-title.ts`: a session is
//! titled from its first prompt until the agent names it.

/// The title a first prompt gives a session: the prompt on one line, cut at 50 characters.
pub fn title_from_prompt(prompt: &str) -> Option<String> {
    let prompt = crate::follow_ups::strip_context_preamble(prompt);
    if crate::follow_ups::is_context_preamble(prompt) {
        return None;
    }
    let line = prompt.split_whitespace().collect::<Vec<_>>().join(" ");
    if line.is_empty() {
        return None;
    }
    if line.chars().count() > 50 {
        let cut: String = line.chars().take(50).collect();
        return Some(format!("{}...", cut.trim_end()));
    }
    Some(line)
}

/// Whether a stored session title is Athas's context preamble instead of a real title.
pub fn needs_repair(title: &str) -> bool {
    crate::follow_ups::is_context_preamble(title) || title.contains('\n')
}

/// A title the agent proposed, cleaned up: no quotes or punctuation, at most two words. Athas
/// asks a model for a one or two word label and normalizes the answer this way.
pub fn normalize_agent_title(value: &str) -> Option<String> {
    let cleaned: String = value
        .chars()
        .filter(|ch| !matches!(ch, '`' | '"' | '\'' | '“' | '”' | '‘' | '’'))
        .map(|ch| if ch.is_alphanumeric() || ch.is_whitespace() || ch == '-' { ch } else { ' ' })
        .collect();
    let words: Vec<&str> = cleaned.split_whitespace().take(2).collect();
    (!words.is_empty()).then(|| words.join(" "))
}

/// A chat title the agent set: one line, at most 80 characters. An agent that titles a session
/// by its first prompt sends Athas's context preamble; the user's words after it are the title,
/// and a title that is only the preamble is none.
pub fn clean_chat_title(value: &str) -> Option<String> {
    let value = crate::follow_ups::strip_context_preamble(value);
    if crate::follow_ups::is_context_preamble(value) {
        return None;
    }
    let line = value.split_whitespace().collect::<Vec<_>>().join(" ");
    (!line.is_empty()).then(|| line.chars().take(80).collect())
}

/// A terminal title from a model's answer: one line, no quotes, at most 48 characters.
pub fn normalize_terminal_title(value: &str) -> Option<String> {
    let line = value.lines().find(|line| !line.trim().is_empty())?.trim();
    let line = line.trim_matches(|ch| matches!(ch, '"' | '\'' | '`' | '“' | '”'));
    let line = line.split_whitespace().collect::<Vec<_>>().join(" ");
    (!line.is_empty() && line.chars().count() <= 48).then_some(line)
}

/// `terminal.generateName` (`terminal/services/intelligence-terminal-title.ts`): asks the AI
/// settings' model to name a terminal from its title and folder.
pub fn generate_terminal_name(title: String, directory: Option<std::path::PathBuf>, cx: &mut gpui::App) -> gpui::Task<Result<String, String>> {
    use gpui::AppContext as _;
    let settings = cx.try_global::<settings::SettingsStore>().map(|_| settings::get(cx).clone()).unwrap_or_default();
    let provider = crate::intelligence::task_provider(&settings, "terminal-title");
    let folder = directory.as_ref().and_then(|path| path.file_name()).map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
    let selection = serde_json::json!({ "title": title.chars().take(512).collect::<String>(), "directory": folder }).to_string();
    let request = ai_providers::inline_edit::InlineEditRequest {
        path: String::new(),
        language_id: "json".into(),
        selection_text: selection,
        instruction: "Name this terminal task in two to four words, at most 48 characters. Return only the title without quotes.".into(),
        feature: ai_providers::TextFeature::TerminalTitle,
        ..Default::default()
    };
    let secrets: std::sync::Arc<dyn ai_providers::SecretStore> = if std::env::var_os("ATHAS_AGENT_FIXTURE").is_some() {
        std::sync::Arc::new(ai_providers::MemorySecrets::default())
    } else {
        std::sync::Arc::new(crate::ai_settings::KeychainRef)
    };
    let timer = cx.background_executor().timer(ai_providers::TextFeature::TerminalTitle.timeout());
    cx.background_spawn(async move {
        let editor = ai_providers::inline_edit::InlineEditor::resolve(&provider, secrets.as_ref()).map_err(|error| error.to_string())?;
        let text = editor.edit_within(&request, timer, |_| {}).await.map_err(|error| error.to_string())?;
        normalize_terminal_title(&text).ok_or_else(|| "The model did not return a short terminal title.".to_string())
    })
}

/// A one or two word title for a new session from its first prompt (`ai-chat.tsx
/// updateInitialAgentSessionTitle`), asked of the chat-title model. A chat on a local model
/// (`chat_provider`, the built-in agent's connection) titles itself with that model, so its text
/// stays on the machine (`getLocalChatConnection`). None in tests and fixtures, which must not
/// reach a provider.
pub fn generate_chat_title(prompt: String, chat_provider: Option<ai_providers::ProviderSettings>, cx: &mut gpui::App) -> Option<gpui::Task<Option<String>>> {
    use gpui::AppContext as _;
    if cfg!(test) || std::env::var_os("ATHAS_AGENT_FIXTURE").is_some() {
        return None;
    }
    let settings = cx.try_global::<settings::SettingsStore>().map(|_| settings::get(cx).clone()).unwrap_or_default();
    let provider = local_chat_connection(chat_provider).unwrap_or_else(|| crate::intelligence::task_provider(&settings, ai_providers::TextFeature::ChatTitle.id()));
    let request = ai_providers::inline_edit::InlineEditRequest {
        path: "agent-session-title".into(),
        language_id: "text".into(),
        selection_text: prompt.chars().take(ai_providers::inline_edit::CONTEXT_CHARS).collect(),
        instruction: "Name the software feature or task being worked on. Return exactly one or two words, no punctuation, no quotes, no explanation. Prefer a concrete product feature label over a generic verb.".into(),
        feature: ai_providers::TextFeature::ChatTitle,
        ..Default::default()
    };
    let timer = cx.background_executor().timer(ai_providers::TextFeature::ChatTitle.timeout());
    Some(cx.background_spawn(async move {
        let editor = ai_providers::inline_edit::InlineEditor::resolve(&provider, &crate::ai_settings::KeychainRef).ok()?;
        let text = editor.edit_within(&request, timer, |_| {}).await.ok()?;
        normalize_agent_title(&text)
    }))
}

/// The chat's own connection when it runs on a local provider, else `None`.
fn local_chat_connection(chat_provider: Option<ai_providers::ProviderSettings>) -> Option<ai_providers::ProviderSettings> {
    chat_provider.filter(ai_providers::local::is_local_provider)
}

#[cfg(test)]
mod tests {
    #[test]
    fn local_chats_title_themselves_locally() {
        let local = ai_providers::ProviderSettings { provider_id: "ollama".into(), model_id: "qwen3:8b".into(), ..Default::default() };
        assert_eq!(super::local_chat_connection(Some(local.clone())), Some(local));
        let hosted = ai_providers::ProviderSettings { provider_id: "openai".into(), model_id: "gpt-5".into(), ..Default::default() };
        assert_eq!(super::local_chat_connection(Some(hosted)), None);
        assert_eq!(super::local_chat_connection(None), None);
    }

    #[test]
    fn the_context_preamble_is_never_a_title() {
        let preamble = "Athas ACP client integrations:\n- If your adapter exposes client integration requests, use `_athas/open_terminal`.\n\nProject: athas-gpui\nWorking directory: /p";
        assert_eq!(super::clean_chat_title(preamble), None);
        assert_eq!(super::title_from_prompt(preamble), None);
        assert!(super::needs_repair(preamble));
        let sent = format!("{preamble}\n\n{}\n\nFix the sidebar", crate::follow_ups::instruction());
        assert_eq!(super::clean_chat_title(&sent).as_deref(), Some("Fix the sidebar"));
        let older = format!("{preamble}\n\nRules\n- Do not mention the follow-up block in the visible response.\n\nFix the sidebar");
        assert_eq!(super::clean_chat_title(&older).as_deref(), Some("Fix the sidebar"));
        assert_eq!(super::clean_chat_title("Fix login").as_deref(), Some("Fix login"));
        assert!(!super::needs_repair("Fix login"));
    }

    #[test]
    fn terminal_titles_are_one_short_line() {
        assert_eq!(super::normalize_terminal_title("\n\"Dev server\"\nextra").as_deref(), Some("Dev server"));
        assert_eq!(super::normalize_terminal_title(&"x".repeat(49)), None);
    }

    use super::*;

    #[test]
    fn titles_come_from_the_first_prompt() {
        assert_eq!(title_from_prompt("  Fix the\nlogin   bug "), Some("Fix the login bug".into()));
        assert_eq!(title_from_prompt("   "), None);
        let long = "Refactor the session panel so every box can be dragged and dropped anywhere";
        let title = title_from_prompt(long).unwrap();
        assert_eq!(title, "Refactor the session panel so every box can be dra...");
        assert_eq!(title_from_prompt(&"é".repeat(60)).unwrap().chars().count(), 53);
    }

    #[test]
    fn agent_titles_are_cut_to_two_clean_words() {
        assert_eq!(normalize_agent_title("\"Login flow!\" fixes"), Some("Login flow".into()));
        assert_eq!(normalize_agent_title("auth-refresh"), Some("auth-refresh".into()));
        assert_eq!(normalize_agent_title("!!!"), None);
    }
}
