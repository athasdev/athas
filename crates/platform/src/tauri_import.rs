//! The first run of a shipping build after the Tauri app updated itself into it: copies what the
//! Tauri app kept (`<data dir>/com.code.athas`, its webview's localStorage, its keychain entries)
//! into this app's stores, once. Nothing of the Tauri app's is changed or removed, so going back
//! to it still works. A destination that already exists is never overwritten.
//!
//! Imported here: keybindings (`keymaps-storage`), recent folders (`athas-code-recent-folders`),
//! saved run actions (`terminal-custom-actions`), update choices (`athas-update-preferences`),
//! custom themes, installed extensions, local history, agent chats (`chat_history.db`) and
//! secrets (account token, AI keys, the GitHub token, SSH and MCP secrets). Settings and remote
//! connections are read
//! by their own stores (`settings::legacy_path`, `remote::connections`), language tools and
//! agents in place (`lsp_client::registry`, `agent_ui::acp::agents`).
//!
//! localStorage comes from `localstorage-export.json` in the Tauri data folder when a last Tauri
//! release wrote one, else from WebKit's own databases (macOS, Linux). WebView2 (Windows) keeps it
//! in LevelDB, which is only read through the export file.

use std::{
    collections::{BTreeMap, HashMap},
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde_json::{Map, Value, json};

/// Written once the import ran; its presence stops it running again.
pub const MARKER_FILE: &str = "tauri-import.json";
/// The localStorage a last Tauri release can export for this import: `{ key: value }`.
pub const LOCAL_STORAGE_EXPORT: &str = "localstorage-export.json";

/// AI providers the Tauri app kept keys for (`ai_token_<id>`).
const AI_PROVIDERS: &[&str] = &[
    "openai", "anthropic", "gemini", "google", "grok", "xai", "mistral", "deepseek", "openrouter", "qwen", "vercel", "groq", "together",
    "fireworks", "cerebras", "perplexity", "ollama", "lmstudio", "custom",
];

/// Secret accounts that keep their name in this app (service `APP_ID`).
const FIXED_SECRETS: &[&str] = &["athas_auth_token", "github_token"];

/// The Tauri app's keychain, and this app's.
pub trait Secrets {
    /// The Tauri app's value for `account` (service `com.code.athas`, else its `secure.json`).
    fn tauri(&self, account: &str) -> Option<String>;
    fn exists(&self, service: &str, account: &str) -> bool;
    fn put(&self, service: &str, account: &str, value: &str) -> Result<(), String>;
}

/// The OS keychain through `secure_storage`, with the Tauri app's `secure.json` fallbacks.
pub struct KeychainSecrets {
    tauri_fallback: Map<String, Value>,
}

impl KeychainSecrets {
    pub fn new(fallback_files: &[PathBuf]) -> Self {
        let mut tauri_fallback = Map::new();
        for file in fallback_files {
            if let Some(Value::Object(values)) = read_json(file) {
                for (key, value) in values {
                    tauri_fallback.entry(key).or_insert(value);
                }
            }
        }
        Self { tauri_fallback }
    }
}

impl Secrets for KeychainSecrets {
    fn tauri(&self, account: &str) -> Option<String> {
        secure_storage::get_secret(paths::TAURI_APP_ID, account)
            .ok()
            .flatten()
            .or_else(|| self.tauri_fallback.get(account).and_then(Value::as_str).map(str::to_string))
            .filter(|value| !value.is_empty())
    }

    fn exists(&self, service: &str, account: &str) -> bool {
        secure_storage::get_secret(service, account).ok().flatten().is_some()
    }

    fn put(&self, service: &str, account: &str, value: &str) -> Result<(), String> {
        secure_storage::store_secret(service, account, value)
    }
}

/// Where the import reads from and writes to.
pub struct Import<'a> {
    /// `<data dir>/com.code.athas`.
    pub tauri_dir: PathBuf,
    /// This app's data folder.
    pub data_dir: PathBuf,
    /// localStorage of the Tauri app's webview, newest value of each key.
    pub local_storage: HashMap<String, String>,
    pub secrets: &'a dyn Secrets,
    /// The keychain service of this app's secrets (`paths::APP_ID`).
    pub service: &'a str,
    pub github_service: &'a str,
}

/// What the import did, kept in the marker file.
#[derive(Debug, Default, PartialEq)]
pub struct Report {
    pub imported: Vec<String>,
    pub skipped: Vec<String>,
    pub failed: Vec<String>,
}

impl Report {
    fn note(&mut self, item: &str, outcome: anyhow::Result<bool>) {
        match outcome {
            Ok(true) => self.imported.push(item.to_string()),
            Ok(false) => self.skipped.push(item.to_string()),
            Err(error) => self.failed.push(format!("{item}: {error:#}")),
        }
    }
}

/// Runs the import once for a shipping build (or with `ATHAS_IMPORT_TAURI=1`): development builds
/// never read the live app's keychain.
pub fn run_once() {
    let enabled = paths::IS_RELEASE_IDENTITY || std::env::var_os("ATHAS_IMPORT_TAURI").is_some_and(|value| value == "1");
    if !enabled {
        return;
    }
    let (Some(tauri_dir), Some(data_dir)) = (paths::tauri_data_dir(), paths::data_dir()) else { return };
    if data_dir.join(MARKER_FILE).exists() || !tauri_dir.is_dir() {
        return;
    }
    let secrets = KeychainSecrets::new(&tauri_secure_files(&tauri_dir));
    let import = Import {
        local_storage: read_local_storage(&tauri_dir, &webkit_dirs()),
        tauri_dir,
        data_dir,
        secrets: &secrets,
        service: paths::APP_ID,
        github_service: paths::GITHUB_KEYCHAIN_SERVICE,
    };
    let report = import.run();
    log::info!("tauri import: imported {:?}, failed {:?}", report.imported, report.failed);
}

/// Where the Tauri app's `secure.json` can be (`secure_storage.rs`).
fn tauri_secure_files(tauri_dir: &Path) -> Vec<PathBuf> {
    let mut files = vec![tauri_dir.join("secure.json")];
    files.extend(dirs::data_dir().map(|dir| dir.join("athas").join("secure.json")));
    files.extend(dirs::home_dir().map(|dir| dir.join(".athas").join("secure.json")));
    files
}

/// Folders WebKit keeps the Tauri webview's data in.
fn webkit_dirs() -> Vec<PathBuf> {
    let mut found = Vec::new();
    if cfg!(target_os = "macos") {
        found.extend(dirs::home_dir().map(|home| home.join("Library/WebKit").join(paths::TAURI_APP_ID)));
    }
    if cfg!(target_os = "linux") {
        found.extend(dirs::data_dir().map(|dir| dir.join(paths::TAURI_APP_ID)));
        found.extend(dirs::data_local_dir().map(|dir| dir.join(paths::TAURI_APP_ID)));
    }
    found
}

impl Import<'_> {
    pub fn run(&self) -> Report {
        let mut report = Report::default();
        report.note("keymap", self.keymap());
        report.note("recent folders", self.recent_folders());
        report.note("run actions", self.run_actions());
        report.note("update preferences", self.update_preferences());
        report.note("custom themes", self.custom_themes());
        report.note("extensions", self.extensions());
        report.note("local history", self.local_history());
        report.note("chats", self.chats());
        report.note("secrets", self.secrets());
        let marker = json!({
            "version": 1,
            "importedAt": SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |elapsed| elapsed.as_millis() as u64),
            "from": self.tauri_dir,
            "imported": report.imported,
            "skipped": report.skipped,
            "failed": report.failed,
        });
        if let Err(error) = write_new(&self.data_dir.join(MARKER_FILE), &serde_json::to_string_pretty(&marker).unwrap_or_default(), true) {
            log::warn!("tauri import: could not write the marker: {error:#}");
        }
        report
    }

    /// A zustand `persist` store's state (`{ state, version }`).
    fn persisted(&self, key: &str) -> Option<Value> {
        let value: Value = serde_json::from_str(self.local_storage.get(key)?).ok()?;
        value.get("state").cloned()
    }

    fn keymap(&self) -> anyhow::Result<bool> {
        let Some(bindings) = self.persisted("keymaps-storage").and_then(|state| state.get("keybindings").cloned()) else { return Ok(false) };
        let bindings: Vec<Value> = bindings
            .as_array()
            .into_iter()
            .flatten()
            .filter(|binding| binding.get("key").and_then(Value::as_str).is_some() && binding.get("command").and_then(Value::as_str).is_some())
            .cloned()
            .collect();
        if bindings.is_empty() {
            return Ok(false);
        }
        write_new(&self.data_dir.join("keymap.json"), &serde_json::to_string_pretty(&bindings)?, false)
    }

    fn recent_folders(&self) -> anyhow::Result<bool> {
        let Some(folders) = self.persisted("athas-code-recent-folders").and_then(|state| state.get("recentFolders").cloned()) else { return Ok(false) };
        let folders = folders.as_array().cloned().unwrap_or_default();
        let now = workspace::now_ms();
        let mut recents: Vec<workspace::RecentProject> = folders
            .iter()
            .enumerate()
            .filter_map(|(index, folder)| {
                let path = folder.get("path")?.as_str()?.to_string();
                let text = |key: &str| folder.get(key).and_then(Value::as_str).map(str::to_string);
                let last_opened = folder
                    .get("lastOpenedAt")
                    .and_then(Value::as_u64)
                    .or_else(|| folder.get("lastOpened").and_then(Value::as_u64))
                    .unwrap_or(now.saturating_sub(index as u64 + 1));
                Some(workspace::RecentProject {
                    name: text("name").unwrap_or_else(|| workspace::project_name(&path)),
                    path,
                    last_opened,
                    pinned: folder.get("pinned").and_then(Value::as_bool).unwrap_or(false),
                    missing: folder.get("missing").and_then(Value::as_bool).unwrap_or(false),
                    custom_icon: text("customIcon"),
                    import_source_id: text("importSourceId"),
                    import_source_name: None,
                })
            })
            .collect();
        if recents.is_empty() {
            return Ok(false);
        }
        recents.sort_by(|left, right| right.pinned.cmp(&left.pinned).then(right.last_opened.cmp(&left.last_opened)));
        let mut unpinned = 0;
        recents.retain(|recent| {
            unpinned += usize::from(!recent.pinned);
            recent.pinned || unpinned <= workspace::MAX_RECENT_PROJECTS
        });
        let mut state = workspace::WorkspaceState::default();
        state.recent_projects = recents;
        write_new(&self.data_dir.join(workspace::window_file_name(workspace::MAIN_WINDOW)), &state.to_json()?, false)
    }

    fn run_actions(&self) -> anyhow::Result<bool> {
        let Some(actions) = self.persisted("terminal-custom-actions").and_then(|state| state.get("runActions").cloned()) else { return Ok(false) };
        let actions: Vec<Value> = actions
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|action| {
                let text = |key: &str| action.get(key).and_then(Value::as_str).filter(|text| !text.trim().is_empty());
                let mut out = Map::new();
                out.insert("id".into(), text("id")?.into());
                out.insert("name".into(), text("name")?.into());
                out.insert("command".into(), text("command")?.into());
                if let Some(directory) = text("workingDirectory") {
                    out.insert("workingDirectory".into(), directory.into());
                }
                Some(Value::Object(out))
            })
            .collect();
        if actions.is_empty() {
            return Ok(false);
        }
        write_new(&self.data_dir.join("run-actions.json"), &serde_json::to_string_pretty(&actions)?, false)
    }

    /// The same shape in both apps.
    fn update_preferences(&self) -> anyhow::Result<bool> {
        let Some(text) = self.local_storage.get("athas-update-preferences") else { return Ok(false) };
        let preferences: crate::updater::UpdatePreferences = serde_json::from_str(text)?;
        if preferences == crate::updater::UpdatePreferences::default() {
            return Ok(false);
        }
        write_new(&self.data_dir.join("update-preferences.json"), &serde_json::to_string(&preferences)?, false)
    }

    /// `{ "themes": [...] }` in both apps.
    fn custom_themes(&self) -> anyhow::Result<bool> {
        let source = self.tauri_dir.join("custom-themes.json");
        if !matches!(read_json(&source), Some(Value::Object(store)) if store.get("themes").is_some_and(Value::is_array)) {
            return Ok(false);
        }
        write_new(&self.data_dir.join("custom-themes.json"), &std::fs::read_to_string(source)?, false)
    }

    /// `extensions/<id>/` folders in both; the Tauri app's `extensions/<id>.json` records become
    /// this app's `installed.json`, disabled ones (`athas.disabledExtensions`) staying disabled.
    fn extensions(&self) -> anyhow::Result<bool> {
        let source = self.tauri_dir.join("extensions");
        let target = self.data_dir.join("extensions");
        if !source.is_dir() || target.join("installed.json").exists() {
            return Ok(false);
        }
        let disabled: Vec<String> =
            self.local_storage.get("athas.disabledExtensions").and_then(|text| serde_json::from_str(text).ok()).unwrap_or_default();
        let mut installed = BTreeMap::new();
        for entry in std::fs::read_dir(&source)?.flatten() {
            let path = entry.path();
            let Some(id) = path.file_name().and_then(|name| name.to_str()).map(str::to_string) else { continue };
            if !path.is_dir() || id.starts_with('.') || !path.join("extension.json").is_file() {
                continue;
            }
            let record = read_json(&source.join(format!("{id}.json"))).unwrap_or(Value::Null);
            let manifest = read_json(&path.join("extension.json")).unwrap_or(Value::Null);
            let version = record.get("version").or_else(|| manifest.get("version")).and_then(Value::as_str).unwrap_or("0.0.0");
            let enabled = record.get("enabled").and_then(Value::as_bool).unwrap_or(true) && !disabled.contains(&id);
            let installed_at = match record.get("installed_at") {
                Some(Value::Number(number)) => number.as_u64().map(|value| if value > 100_000_000_000 { value / 1000 } else { value }),
                _ => None,
            }
            .unwrap_or(0);
            if !target.join(&id).exists() {
                copy_dir(&path, &target.join(&id))?;
            }
            installed.insert(id, json!({ "version": version, "enabled": enabled, "installedAt": installed_at }));
        }
        if installed.is_empty() {
            return Ok(false);
        }
        write_new(&target.join("installed.json"), &serde_json::to_string_pretty(&installed)?, false)
    }

    /// The same layout in both apps (folders named by the hash of the file's path).
    fn local_history(&self) -> anyhow::Result<bool> {
        let source = self.tauri_dir.join("local_history");
        let target = self.data_dir.join("local_history");
        if !source.is_dir() || target.exists() {
            return Ok(false);
        }
        copy_dir(&source, &target)?;
        Ok(true)
    }

    /// Each chat of `chat_history.db` as a session transcript in `sessions/`, dated by its last
    /// message, so the history lists it.
    fn chats(&self) -> anyhow::Result<bool> {
        let database = self.tauri_dir.join("chat_history.db");
        if !database.is_file() {
            return Ok(false);
        }
        let sessions = self.data_dir.join("sessions");
        let chats = read_chats(&database)?;
        let mut imported = false;
        for chat in chats {
            if chat.transcript.entries.is_empty() {
                continue;
            }
            let id = format!("tauri-{}", chat.id);
            let path = sessions.join(session_file_name(&id));
            if path.exists() {
                continue;
            }
            agent_ui::persistence::save(&sessions, &id, &chat.transcript)?;
            if let Some(modified) = chat.last_message_at.map(|ms| UNIX_EPOCH + Duration::from_millis(ms))
                && let Ok(file) = std::fs::File::options().write(true).open(&path)
            {
                file.set_modified(modified).ok();
            }
            imported = true;
        }
        Ok(imported)
    }

    fn secrets(&self) -> anyhow::Result<bool> {
        let mut moves: Vec<(String, String, String)> = Vec::new();
        let same = |account: &str| (account.to_string(), self.service.to_string(), account.to_string());
        moves.extend(FIXED_SECRETS.iter().map(|account| same(account)));
        moves.extend(AI_PROVIDERS.iter().map(|provider| same(&format!("ai_token_{provider}"))));
        moves.push(("github_pat".into(), self.github_service.to_string(), "personal-access-token".into()));
        if let Some(Value::Object(connections)) = read_json(&self.tauri_dir.join("remote-connections.json")) {
            moves.extend(connections.keys().map(|id| same(&format!("remote_cred_{id}"))));
        }
        let settings = read_json(&self.tauri_dir.join("settings.json")).unwrap_or(Value::Null);
        for server in settings.get("mcpServers").and_then(Value::as_array).into_iter().flatten() {
            if let Some(id) = server.get("id").and_then(Value::as_str)
                && !id.is_empty()
                && id.len() <= 128
                && id.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
            {
                moves.push(same(&format!("mcp_server_{id}")));
            }
        }
        let mut imported = false;
        let mut failures = Vec::new();
        for (from, service, account) in moves {
            if self.secrets.exists(&service, &account) {
                continue;
            }
            let Some(value) = self.secrets.tauri(&from) else { continue };
            match self.secrets.put(&service, &account, &value) {
                Ok(()) => imported = true,
                Err(error) => failures.push(format!("{from}: {error}")),
            }
        }
        if failures.is_empty() { Ok(imported) } else { Err(anyhow::anyhow!(failures.join("; "))) }
    }
}

/// `agent_ui::persistence`'s file name for a session id.
fn session_file_name(session_id: &str) -> String {
    let safe: String = session_id.chars().map(|ch| if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' { ch } else { '_' }).collect();
    format!("{safe}.json")
}

struct Chat {
    id: String,
    last_message_at: Option<u64>,
    transcript: agent_ui::thread::Transcript,
}

/// The chats of the Tauri app's `chat_history.db`, read only.
fn read_chats(database: &Path) -> anyhow::Result<Vec<Chat>> {
    use agent_ui::thread::{AgentMessage, Entry, ToolCall, ToolStatus, Transcript, UserMessage};
    let connection = rusqlite::Connection::open_with_flags(database, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX)?;
    let mut chats_query = connection.prepare("SELECT id, title, last_message_at, acp_session_id FROM chats ORDER BY last_message_at")?;
    let chats: Vec<(String, Option<String>, Option<i64>, Option<String>)> =
        chats_query.query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)))?.collect::<Result<_, _>>()?;
    let mut messages_query = connection.prepare("SELECT id, role, content FROM messages WHERE chat_id = ?1 ORDER BY timestamp, rowid")?;
    let mut tools_query = connection.prepare("SELECT name, error FROM tool_calls WHERE message_id = ?1 ORDER BY id")?;
    let mut found = Vec::new();
    for (id, title, last_message_at, acp_session_id) in chats {
        let messages: Vec<(String, String, Option<String>)> =
            messages_query.query_map([&id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?.collect::<Result<_, _>>()?;
        let mut transcript = Transcript {
            agent_title: title.filter(|title| !title.trim().is_empty()),
            agent_session_id: acp_session_id.filter(|session| !session.is_empty()),
            ..Default::default()
        };
        for (message_id, role, content) in messages {
            let text = content.unwrap_or_default();
            match role.as_str() {
                "user" if !text.trim().is_empty() => transcript.entries.push(Entry::User(UserMessage { text, ..Default::default() })),
                "assistant" if !text.trim().is_empty() => {
                    transcript.entries.push(Entry::Agent(AgentMessage { message_id: Some(message_id.clone()), text, ..Default::default() }));
                }
                _ => {}
            }
            let tools: Vec<(String, Option<String>)> = tools_query.query_map([&message_id], |row| Ok((row.get(0)?, row.get(1)?)))?.collect::<Result<_, _>>()?;
            for (index, (name, error)) in tools.into_iter().enumerate() {
                transcript.entries.push(Entry::ToolCall(ToolCall {
                    id: format!("{message_id}-{index}"),
                    title: name,
                    status: if error.is_some_and(|error| !error.is_empty()) { ToolStatus::Failed } else { ToolStatus::Completed },
                    ..Default::default()
                }));
            }
        }
        found.push(Chat { id, last_message_at: last_message_at.and_then(|ms| u64::try_from(ms).ok()), transcript });
    }
    Ok(found)
}

/// localStorage of the Tauri webview: the export file wins, then WebKit's databases, newest last.
pub fn read_local_storage(tauri_dir: &Path, webkit_dirs: &[PathBuf]) -> HashMap<String, String> {
    let mut values = HashMap::new();
    let mut databases = Vec::new();
    for dir in webkit_dirs {
        find_local_storage_databases(dir, 0, &mut databases);
    }
    databases.sort_by_key(|path| path.metadata().and_then(|metadata| metadata.modified()).unwrap_or(UNIX_EPOCH));
    for database in databases {
        match read_webkit_local_storage(&database) {
            Ok(found) => values.extend(found),
            Err(error) => log::warn!("tauri import: could not read {}: {error:#}", database.display()),
        }
    }
    if let Some(Value::Object(exported)) = read_json(&tauri_dir.join(LOCAL_STORAGE_EXPORT)) {
        for (key, value) in exported {
            let text = match value {
                Value::String(text) => text,
                other => other.to_string(),
            };
            values.insert(key, text);
        }
    }
    values
}

/// Folders that never hold the webview's storage and can be large.
const SKIPPED_FOLDERS: &[&str] = &["tools", "runtimes", "agents", "extensions", "local_history", "node_modules", "acp-registry", "browser"];

fn find_local_storage_databases(dir: &Path, depth: usize, found: &mut Vec<PathBuf>) {
    if depth > 7 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else { continue };
        let Ok(kind) = entry.file_type() else { continue };
        if kind.is_dir() {
            if !SKIPPED_FOLDERS.contains(&name) {
                find_local_storage_databases(&path, depth + 1, found);
            }
        } else if kind.is_file() && (name == "localstorage.sqlite3" || name.ends_with(".localstorage")) {
            found.push(path);
        }
    }
}

/// WebKit's `ItemTable(key, value)`, values in UTF-16.
pub fn read_webkit_local_storage(database: &Path) -> anyhow::Result<HashMap<String, String>> {
    let connection = rusqlite::Connection::open_with_flags(database, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX)?;
    let mut query = connection.prepare("SELECT key, value FROM ItemTable")?;
    let rows = query.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get_ref(1)?.as_bytes().map(<[u8]>::to_vec).unwrap_or_default())))?;
    let mut values = HashMap::new();
    for row in rows {
        let (key, bytes) = row?;
        values.insert(key, decode_webkit_value(&bytes));
    }
    Ok(values)
}

fn decode_webkit_value(bytes: &[u8]) -> String {
    if bytes.len() % 2 == 0 {
        let units: Vec<u16> = bytes.chunks_exact(2).map(|pair| u16::from_le_bytes([pair[0], pair[1]])).collect();
        if let Ok(text) = String::from_utf16(&units) {
            return text;
        }
    }
    String::from_utf8_lossy(bytes).into_owned()
}

fn read_json(path: &Path) -> Option<Value> {
    serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()
}

/// Writes `text` to `path` unless something is there already (or `replace`); true when written.
fn write_new(path: &Path, text: &str, replace: bool) -> anyhow::Result<bool> {
    if path.exists() && !replace {
        return Ok(false);
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let temp = path.with_extension("import-tmp");
    std::fs::write(&temp, text)?;
    // Imported files can hold secrets (tokens, connection strings with passwords).
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        std::fs::set_permissions(&temp, std::fs::Permissions::from_mode(0o600))?;
    }
    std::fs::rename(&temp, path)?;
    Ok(true)
}

/// Copies a folder; symbolic links are copied as links.
fn copy_dir(from: &Path, to: &Path) -> anyhow::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)?.flatten() {
        let path = entry.path();
        let target = to.join(entry.file_name());
        let kind = entry.file_type()?;
        if kind.is_dir() {
            copy_dir(&path, &target)?;
        } else if kind.is_symlink() {
            #[cfg(unix)]
            std::os::unix::fs::symlink(std::fs::read_link(&path)?, &target)?;
        } else {
            std::fs::copy(&path, &target)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    #[derive(Default)]
    struct MemorySecrets {
        tauri: HashMap<String, String>,
        app: RefCell<HashMap<(String, String), String>>,
    }

    impl Secrets for MemorySecrets {
        fn tauri(&self, account: &str) -> Option<String> {
            self.tauri.get(account).cloned()
        }
        fn exists(&self, service: &str, account: &str) -> bool {
            self.app.borrow().contains_key(&(service.to_string(), account.to_string()))
        }
        fn put(&self, service: &str, account: &str, value: &str) -> Result<(), String> {
            self.app.borrow_mut().insert((service.to_string(), account.to_string()), value.to_string());
            Ok(())
        }
    }

    fn persisted(state: Value) -> String {
        json!({ "state": state, "version": 1 }).to_string()
    }

    fn write(path: &Path, text: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    /// A Tauri data folder as 0.18 leaves it, with localStorage and keychain entries.
    fn fixture(root: &Path) -> (PathBuf, PathBuf, HashMap<String, String>, MemorySecrets) {
        let tauri = root.join("com.code.athas");
        let data = root.join("dev.athas.app");
        write(&tauri.join("settings.json"), r#"{"theme":"athas-dark","mcpServers":[{"id":"github_1","name":"GitHub"},{"id":"bad id"}]}"#);
        write(&tauri.join("remote-connections.json"), r#"{"conn-1":{"id":"conn-1","name":"Box","host":"h","port":22,"username":"u","type":"ssh"}}"#);
        write(&tauri.join("custom-themes.json"), r#"{"themes":[{"id":"mine","name":"Mine"}]}"#);
        write(&tauri.join("extensions/athas.lang.zig/extension.json"), r#"{"id":"athas.lang.zig","version":"1.2.0"}"#);
        write(&tauri.join("extensions/athas.lang.zig.json"), r#"{"id":"athas.lang.zig","version":"1.2.0","installed_at":1700000000000,"enabled":true}"#);
        write(&tauri.join("extensions/athas.theme.x/extension.json"), r#"{"id":"athas.theme.x","version":"0.1.0"}"#);
        write(&tauri.join("extensions/.installing-foo/extension.json"), "{}");
        write(&tauri.join("local_history/abc/entries.json"), "[]");
        write(&tauri.join("local_history/abc/snapshots/1"), "old text");

        let mut storage = HashMap::new();
        storage.insert(
            "keymaps-storage".into(),
            persisted(json!({ "keybindings": [{"key":"cmd+k","command":"workbench.toggleSidebar","source":"user"},{"command":"no.key"}] })),
        );
        storage.insert(
            "athas-code-recent-folders".into(),
            persisted(json!({ "recentFolders": [
                {"name":"api","path":"/src/api","lastOpened":"2 hours ago","lastOpenedAt":2000,"pinned":false},
                {"name":"web","path":"/src/web","lastOpenedAt":3000,"customIcon":"rocket"},
                {"name":"old","path":"/src/old","lastOpenedAt":1000,"pinned":true}
            ]})),
        );
        storage.insert(
            "terminal-custom-actions".into(),
            persisted(json!({ "runActions": [
                {"id":"a1","name":"Test","command":"cargo test","source":"custom","sourceLabel":"Custom","workingDirectory":"/src/api"},
                {"id":"a2","name":"Empty","source":"custom","sourceLabel":"Custom"}
            ]})),
        );
        storage.insert("athas-update-preferences".into(), r#"{"skippedVersion":"0.18.1"}"#.into());
        storage.insert("athas.disabledExtensions".into(), r#"["athas.theme.x"]"#.into());

        let mut secrets = MemorySecrets::default();
        for (account, value) in [
            ("athas_auth_token", "session"),
            ("ai_token_anthropic", "sk-ant"),
            ("github_pat", "ghp_x"),
            ("remote_cred_conn-1", "ssh-pass"),
            ("mcp_server_github_1", r#"{"env":[],"headers":[]}"#),
        ] {
            secrets.tauri.insert(account.into(), value.into());
        }
        (tauri, data, storage, secrets)
    }

    fn import<'a>(tauri: &Path, data: &Path, storage: HashMap<String, String>, secrets: &'a MemorySecrets) -> Import<'a> {
        Import {
            tauri_dir: tauri.to_path_buf(),
            data_dir: data.to_path_buf(),
            local_storage: storage,
            secrets,
            service: "dev.athas.app",
            github_service: "dev.athas.app.github",
        }
    }

    #[test]
    fn imports_a_tauri_install() {
        let root = tempfile::tempdir().unwrap();
        let (tauri, data, storage, secrets) = fixture(root.path());
        let report = import(&tauri, &data, storage, &secrets).run();
        assert!(report.failed.is_empty(), "{:?}", report.failed);
        assert_eq!(report.skipped, vec!["chats".to_string()]);

        let keymap = keymap::parse_user_bindings(&std::fs::read_to_string(data.join("keymap.json")).unwrap()).unwrap().0;
        assert_eq!(keymap.len(), 1);
        assert_eq!(keymap[0].key, "cmd+k");

        let state = workspace::WorkspaceState::from_json(&std::fs::read_to_string(data.join("workspace.json")).unwrap()).unwrap();
        let paths: Vec<&str> = state.recent_projects.iter().map(|recent| recent.path.as_str()).collect();
        assert_eq!(paths, ["/src/old", "/src/web", "/src/api"]);
        assert_eq!(state.recent_projects[1].custom_icon.as_deref(), Some("rocket"));
        assert!(state.recent_projects[0].pinned);

        let actions: Vec<Value> = serde_json::from_str(&std::fs::read_to_string(data.join("run-actions.json")).unwrap()).unwrap();
        assert_eq!(actions, vec![json!({"id":"a1","name":"Test","command":"cargo test","workingDirectory":"/src/api"})]);

        assert_eq!(crate::updater::read_preferences(&data).skipped_version.as_deref(), Some("0.18.1"));
        assert_eq!(std::fs::read_to_string(data.join("custom-themes.json")).unwrap(), r#"{"themes":[{"id":"mine","name":"Mine"}]}"#);

        let installed: Value = serde_json::from_str(&std::fs::read_to_string(data.join("extensions/installed.json")).unwrap()).unwrap();
        assert_eq!(installed["athas.lang.zig"], json!({"version":"1.2.0","enabled":true,"installedAt":1700000000}));
        assert_eq!(installed["athas.theme.x"]["enabled"], json!(false));
        assert!(installed.get(".installing-foo").is_none());
        assert!(data.join("extensions/athas.lang.zig/extension.json").is_file());

        assert_eq!(std::fs::read_to_string(data.join("local_history/abc/snapshots/1")).unwrap(), "old text");

        let app = secrets.app.borrow();
        let get = |service: &str, account: &str| app.get(&(service.to_string(), account.to_string())).cloned();
        assert_eq!(get("dev.athas.app", "athas_auth_token").as_deref(), Some("session"));
        assert_eq!(get("dev.athas.app", "ai_token_anthropic").as_deref(), Some("sk-ant"));
        assert_eq!(get("dev.athas.app.github", "personal-access-token").as_deref(), Some("ghp_x"));
        assert_eq!(get("dev.athas.app", "remote_cred_conn-1").as_deref(), Some("ssh-pass"));
        assert!(get("dev.athas.app", "mcp_server_github_1").is_some());
        assert_eq!(app.len(), 5);

        let marker: Value = serde_json::from_str(&std::fs::read_to_string(data.join(MARKER_FILE)).unwrap()).unwrap();
        assert_eq!(marker["version"], 1);
        // The Tauri app's files are left as they were.
        assert!(tauri.join("settings.json").is_file() && tauri.join("local_history/abc/entries.json").is_file());
    }

    #[test]
    fn never_overwrites_what_this_app_has() {
        let root = tempfile::tempdir().unwrap();
        let (tauri, data, storage, secrets) = fixture(root.path());
        write(&data.join("keymap.json"), "[]");
        write(&data.join("workspace.json"), "{}");
        secrets.app.borrow_mut().insert(("dev.athas.app".into(), "ai_token_anthropic".into()), "sk-new".into());
        let report = import(&tauri, &data, storage, &secrets).run();
        assert!(report.skipped.contains(&"keymap".to_string()) && report.skipped.contains(&"recent folders".to_string()));
        assert_eq!(std::fs::read_to_string(data.join("keymap.json")).unwrap(), "[]");
        assert_eq!(std::fs::read_to_string(data.join("workspace.json")).unwrap(), "{}");
        assert_eq!(secrets.app.borrow()[&("dev.athas.app".to_string(), "ai_token_anthropic".to_string())], "sk-new");
    }

    #[test]
    fn imports_chats_as_sessions() {
        let root = tempfile::tempdir().unwrap();
        let tauri = root.path().join("com.code.athas");
        let data = root.path().join("dev.athas.app");
        std::fs::create_dir_all(&tauri).unwrap();
        let db = rusqlite::Connection::open(tauri.join("chat_history.db")).unwrap();
        db.execute_batch(
            "CREATE TABLE chats (id TEXT PRIMARY KEY, title TEXT, created_at INTEGER, last_message_at INTEGER, agent_id TEXT, acp_session_id TEXT);
             CREATE TABLE messages (id TEXT PRIMARY KEY, chat_id TEXT, role TEXT, content TEXT, timestamp INTEGER, is_streaming INTEGER, is_tool_use INTEGER, tool_name TEXT);
             CREATE TABLE tool_calls (id INTEGER PRIMARY KEY AUTOINCREMENT, message_id TEXT, name TEXT, input TEXT, output TEXT, error TEXT, timestamp INTEGER, is_complete INTEGER);
             INSERT INTO chats VALUES ('c1', 'Fix the build', 1, 1700000000000, 'claude-code', 'acp-9');
             INSERT INTO chats VALUES ('c2', '', 1, 5, 'custom', NULL);
             INSERT INTO messages VALUES ('m1', 'c1', 'user', 'Why does it fail?', 1, 0, 0, NULL);
             INSERT INTO messages VALUES ('m2', 'c1', 'assistant', 'A missing import.', 2, 0, 0, NULL);
             INSERT INTO tool_calls (message_id, name, error) VALUES ('m2', 'Read lib.rs', NULL);
             INSERT INTO tool_calls (message_id, name, error) VALUES ('m2', 'Run tests', 'exit 1');",
        )
        .unwrap();
        drop(db);
        let secrets = MemorySecrets::default();
        let report = import(&tauri, &data, HashMap::new(), &secrets).run();
        assert!(report.imported.contains(&"chats".to_string()), "{report:?}");
        let sessions = data.join("sessions");
        let listed = agent_ui::history::list(&sessions);
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, "tauri-c1");
        assert_eq!(listed[0].title, "Fix the build");
        assert_eq!(listed[0].modified, UNIX_EPOCH + Duration::from_millis(1700000000000));
        let transcript = agent_ui::persistence::load(&sessions, "tauri-c1").unwrap();
        assert_eq!(transcript.agent_session_id.as_deref(), Some("acp-9"));
        assert_eq!(transcript.entries.len(), 4);
        assert!(matches!(&transcript.entries[3], agent_ui::thread::Entry::ToolCall(call) if call.status == agent_ui::thread::ToolStatus::Failed));
        // Running again changes nothing.
        let again = import(&tauri, &data, HashMap::new(), &secrets).run();
        assert!(again.skipped.contains(&"chats".to_string()));
    }

    #[test]
    fn reads_webkit_local_storage() {
        let root = tempfile::tempdir().unwrap();
        let webkit = root.path().join("WebKit/com.code.athas/WebsiteData/Default/salt/salt/LocalStorage");
        std::fs::create_dir_all(&webkit).unwrap();
        let db = rusqlite::Connection::open(webkit.join("localstorage.sqlite3")).unwrap();
        db.execute_batch("CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB NOT NULL ON CONFLICT FAIL);").unwrap();
        let utf16 = |text: &str| text.encode_utf16().flat_map(u16::to_le_bytes).collect::<Vec<u8>>();
        db.execute("INSERT INTO ItemTable VALUES (?1, ?2)", rusqlite::params!["keymaps-storage", utf16(r#"{"state":{"keybindings":[]}}"#)]).unwrap();
        db.execute("INSERT INTO ItemTable VALUES (?1, ?2)", rusqlite::params!["athas.disabledExtensions", utf16("[\"ü\"]")]).unwrap();
        drop(db);
        let tauri = root.path().join("com.code.athas");
        write(&tauri.join(LOCAL_STORAGE_EXPORT), r#"{"athas.disabledExtensions":"[\"exported\"]","athas-recent-files":{"state":{}}}"#);
        let values = read_local_storage(&tauri, &[root.path().join("WebKit/com.code.athas")]);
        assert_eq!(values["keymaps-storage"], r#"{"state":{"keybindings":[]}}"#);
        assert_eq!(values["athas.disabledExtensions"], "[\"exported\"]");
        assert_eq!(values["athas-recent-files"], r#"{"state":{}}"#);
    }
}
