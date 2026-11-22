//! Renders the AI views to a PNG with the GPU but without a window, for checking them headless.
//!
//! `cargo run -p ai_snapshot -- out.png [dark|light] [scene] [width] [height]`, where the scene is
//! `session`, `dock` (the session with connectors in its side column), `history`, `review` (agent edit review),
//! `session-review` (a session with changes waiting), `inline-edit`, `ai-settings`, `skills`,
//! `cloud`, `cloud-run`, `api-keys` (the API key dialog; `ai-settings` with `ATHAS_SNAPSHOT_MCP_EDITOR` set to a server id or `new` opens the MCP server dialog) or `model-menu` (a long model menu; `ATHAS_SNAPSHOT_TYPE` types into it); `ATHAS_SNAPSHOT_INTEGRATION` (`skills`, `skills:catalog`) shows an Integrations view in `ai-settings`, `ATHAS_SNAPSHOT_REVEAL` (`mcp:github`) reveals an installed row there. The model, cloud service and files the scenes show are local stand-ins:
//! a mock HTTP server and a temporary folder; nothing reaches a real API or the keychain.
//!
//! `ATHAS_AGENT_FIXTURE` sets the session's transcript (see `agent_ui::SessionView`),
//! `ATHAS_SNAPSHOT_COMPOSER_MENU` (`effort` or `preferences`) opens a composer menu,
//! `ATHAS_SNAPSHOT_PROJECT` its project folder, and `ATHAS_HISTORY_DIR` the folder of saved
//! sessions the history lists; `ATHAS_SNAPSHOT_AGENT_SESSIONS` fills its Agent sessions with a
//! page of stand-ins (`ATHAS_SNAPSHOT_AGENT_SESSIONS_ERROR` adds the line of an agent that could not list).

use std::{path::PathBuf, sync::Arc};

use agent_ui::{
    AiSettingsView, HistoryView, ReviewView, SessionInfo, SessionView,
    agent_registry::AgentRegistry,
    cloud::{self, CloudClient, ContinuousAgents, continuous::TaskList},
    inline_edit::{InlineEditPrompt, InlineEditRequest},
    review::{FileChange, Store},
    skills::{SkillRoots, SkillsView},
};
use ai_providers::{
    MemorySecrets,
    test_support::{MockResponse, MockServer},
};
use anyhow::{Context as _, Result};
use gpui::{AnyView, AppContext, Context, HeadlessAppContext, IntoElement, ParentElement, Render, Styled, Window, div, px, size};
use serde_json::json;
use theme::{ActiveTheme, Appearance};

struct Root {
    centre: AnyView,
    dock: Option<AnyView>,
    /// Draws the centre view as a page's content: padded and scrolled, as Settings shows it.
    page: bool,
}

impl Render for Root {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let gap = ui::metrics::WORKBENCH_GAP;
        let centre = if self.page {
            div()
                .size_full()
                .bg(cx.theme().colors.background)
                .flex()
                .justify_center()
                .p(px(24.))
                .child(div().w_full().max_w(px(760.)).child(self.centre.clone()))
                .into_any_element()
        } else {
            self.centre.clone().into_any_element()
        };
        div()
            .size_full()
            .flex()
            .p(gap)
            .gap(gap)
            .bg(cx.theme().colors.surface)
            .child(ui::island(cx).flex_1().h_full().child(centre))
            .children(self.dock.clone().map(|dock| ui::island(cx).flex_none().h_full().w(ui::metrics::SESSION_BOXES_WIDTH).child(dock)))
    }
}

/// Files an agent edited in `project`, logged for session `snapshot`.
fn record_agent_edits(project: &std::path::Path) -> Result<()> {
    let src = project.join("src");
    std::fs::create_dir_all(&src)?;
    let before = "use std::time::Duration;\n\npub struct Client {\n    base: String,\n}\n\nimpl Client {\n    pub fn get(&self, path: &str) -> Result<String> {\n        let url = format!(\"{}/{path}\", self.base);\n        request(&url)\n    }\n}\n";
    let after = "use std::time::Duration;\n\nconst RETRIES: u32 = 3;\n\npub struct Client {\n    base: String,\n    timeout: Duration,\n}\n\nimpl Client {\n    pub fn get(&self, path: &str) -> Result<String> {\n        let url = format!(\"{}/{path}\", self.base);\n        retry(RETRIES, || request(&url, self.timeout))\n    }\n}\n";
    let client = src.join("client.rs");
    std::fs::write(&client, after)?;
    let store = Store::global();
    store.record("snapshot", Some(0), FileChange { path: client, previous: Some(before.into()), content: Some(after.into()) });
    let retry = src.join("retry.rs");
    let retry_text = "/// Runs `attempt` until it succeeds, at most `times` times.\npub fn retry<T, E>(times: u32, mut attempt: impl FnMut() -> Result<T, E>) -> Result<T, E> {\n    let mut last = attempt();\n    for _ in 1..times {\n        if last.is_ok() {\n            break;\n        }\n        last = attempt();\n    }\n    last\n}\n";
    std::fs::write(&retry, retry_text)?;
    store.record("snapshot", Some(0), FileChange { path: retry, previous: None, content: Some(retry_text.into()) });
    Ok(())
}

fn skill_folders(root: &std::path::Path) -> Result<SkillRoots> {
    let project = root.join("project");
    let release = project.join(".athas/skills/release-notes");
    std::fs::create_dir_all(&release)?;
    std::fs::write(release.join("SKILL.md"), "---\nname: Release notes\ndescription: Summarize merged pull requests for a release\n---\nRead the merged pull requests since the last tag and write release notes grouped by Features, Fixes and Internal.\n")?;
    let home = root.join("home");
    let tests = home.join(".claude/skills/tdd");
    std::fs::create_dir_all(&tests)?;
    std::fs::write(tests.join("SKILL.md"), "---\nname: Test first\ndescription: Write a failing test before the fix\n---\nWrite a failing test that shows the bug, then fix it, then run the whole suite.\n")?;
    Ok(SkillRoots { project: Some(project), home: Some(home) })
}

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let out = args.first().cloned().unwrap_or_else(|| "ai-snapshot.png".into());
    let appearance = if args.get(1).map(String::as_str) == Some("light") { Appearance::Light } else { Appearance::Dark };
    let scene = args.get(2).cloned().unwrap_or_else(|| "dock".into());
    let width: f32 = args.get(3).and_then(|w| w.parse().ok()).unwrap_or(1280.);
    let height: f32 = args.get(4).and_then(|h| h.parse().ok()).unwrap_or(820.);

    // Nothing the scenes do is saved: the review keeps its log in memory.
    Store::init_global(None);
    let temp = std::env::temp_dir().join(format!("ai-snapshot-{}", std::process::id()));
    std::fs::create_dir_all(&temp)?;
    let server = MockServer::start();

    let mut settings = settings::Settings::default();
    if scene == "inline-edit" {
        settings.ai_provider_id = "custom".into();
        settings.ai_custombase_url = format!("{}/v1", server.url);
        settings.ai_custom_model_id = "mock-model".into();
        server.push(MockResponse::openai(&[
            json!({ "choices": [{ "index": 0, "delta": { "content": "pub fn get(&self, path: &str) -> Result<String> {\n" } }] }),
            json!({ "choices": [{ "index": 0, "delta": { "content": "    let url = self.url(path);\n    retry(RETRIES, || request(&url, self.timeout))\n}" } }] }),
            json!({ "choices": [{ "index": 0, "delta": {}, "finish_reason": "stop" }] }),
        ]));
    }
    if scene == "ai-settings" {
        settings.ai_provider_id = "anthropic".into();
        settings.ai_model_id = "claude-sonnet-5".into();
        settings.ai_user_rules = "Prefer small, reviewable changes.\nRun the tests before saying a change is done.".into();
        settings.mcp_servers = vec![
            json!({ "id": "github", "name": "github", "enabled": true, "transport": "stdio", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"] }),
            json!({ "id": "linear", "name": "linear", "enabled": false, "transport": "http", "url": "https://mcp.linear.app/mcp" }),
        ];
    }
    if scene == "dock" {
        settings.mcp_servers = vec![
            json!({ "id": "github", "name": "GitHub", "enabled": true, "transport": "stdio", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"] }),
            json!({ "id": "linear", "name": "Linear", "enabled": true, "transport": "http", "url": "https://mcp.linear.app/mcp" }),
            json!({ "id": "sentry", "name": "Sentry", "enabled": false, "transport": "http", "url": "https://mcp.sentry.dev/mcp" }),
        ];
    }
    if scene == "completion" {
        settings.ai_completion = std::env::var_os("ATHAS_SNAPSHOT_COMPLETION_OFF").is_none();
    }
    if scene == "skills" || scene == "ai-settings" {
        settings.ai_skills = vec![json!({ "id": "s1", "title": "Review", "description": "Review the diff for bugs", "content": "Review the staged diff. Point out bugs, missing tests and risky changes, most important first.", "source": "local" })];
        if scene == "ai-settings" {
            settings.ai_skills.push(json!({ "id": "s2", "title": "Release notes", "content": "Write release notes from the merged pull requests, grouped by area.", "source": "marketplace",
                "sourceId": "athas.release-notes", "upstreamTitle": "Release notes", "upstreamContent": "Write release notes from the merged pull requests." }));
        }
    }
    if scene == "cloud" {
        let run = |id: &str, title: &str, status: &str, branch: &str, pr: Option<&str>| {
            json!({ "id": id, "repo": "athasdev/athas", "baseBranch": "main", "branch": branch, "title": title, "agent": "claude-code", "status": status,
                "maxMinutes": 30, "billedSeconds": 340, "chargedCents": 0, "prUrl": pr, "error": null, "createdAt": "2026-11-11T09:42:10Z" })
        };
        server.push(MockResponse::json(
            200,
            json!({ "runs": [
                run("r3", "Add retries to the HTTP client", "running", "athas/http-retries", None),
                run("r2", "Fix flaky terminal resize test", "succeeded", "athas/terminal-resize", Some("https://github.com/athasdev/athas/pull/912")),
                run("r1", "Upgrade tree-sitter grammars", "failed", "athas/tree-sitter", None),
            ] }),
        ));
    }
    if scene == "cloud-run" {
        server.push(MockResponse::json(
            200,
            json!({ "run": { "id": "r3", "repo": "athasdev/athas", "baseBranch": "main", "branch": "athas/http-retries", "title": "Add retries to the HTTP client",
                "agent": "claude-code", "status": "succeeded", "maxMinutes": 30, "billedSeconds": 412, "chargedCents": 0, "prUrl": "https://github.com/athasdev/athas/pull/913",
                "prompt": "Retry failed GET requests three times with a timeout, and add tests.", "createdAt": "2026-11-11T09:42:10Z", "spentMicros": 410000 } }),
        ));
        server.push(MockResponse::json(
            200,
            json!({ "lines": [
                { "at": 1000, "stream": "system", "text": "Cloning athasdev/athas at main" },
                { "at": 2000, "stream": "stdout", "text": json!({ "type": "assistant", "message": { "content": [
                    { "type": "text", "text": "I'll add a retry loop around GET requests and a request timeout." },
                    { "type": "tool_use", "id": "t0", "name": "TodoWrite", "input": { "todos": [
                        { "content": "Add a timeout to Client", "status": "completed" },
                        { "content": "Retry failed GETs three times", "status": "completed" },
                        { "content": "Cover retries with tests", "status": "in_progress" } ] } },
                    { "type": "tool_use", "id": "t1", "name": "Read", "input": { "file_path": "src/http/client.rs" } } ] } }).to_string() },
                { "at": 2300, "stream": "stdout", "text": json!({ "type": "user", "message": { "content": [{ "type": "tool_result", "tool_use_id": "t1", "content": "pub struct Client" }] } }).to_string() },
                { "at": 3000, "stream": "stdout", "text": json!({ "type": "assistant", "message": { "content": [
                    { "type": "tool_use", "id": "t2", "name": "Edit", "input": { "file_path": "src/http/client.rs" } } ] } }).to_string() },
                { "at": 3400, "stream": "stdout", "text": json!({ "type": "user", "message": { "content": [{ "type": "tool_result", "tool_use_id": "t2", "content": "ok" }] } }).to_string() },
                { "at": 4000, "stream": "stdout", "text": json!({ "type": "assistant", "message": { "content": [
                    { "type": "tool_use", "id": "t3", "name": "Bash", "input": { "command": "cargo test -p http" } } ] } }).to_string() },
                { "at": 12600, "stream": "stdout", "text": json!({ "type": "user", "message": { "content": [{ "type": "tool_result", "tool_use_id": "t3", "content": "test result: ok. 42 passed" }] } }).to_string() },
                { "at": 13000, "stream": "stdout", "text": json!({ "type": "result", "result": "GET requests now retry three times with a 10 second timeout; 4 new tests cover it." }).to_string() },
                { "at": 14000, "stream": "system", "text": "Opened pull request #913" },
            ], "cursor": 7 }),
        ));
    }

    let text_system = gpui_platform::current_platform(true).text_system();
    let mut cx = HeadlessAppContext::with_platform(text_system, Arc::new(ui::Assets), || gpui_platform::current_headless_renderer());
    cx.update(|cx| -> Result<()> {
        ui::load_fonts(cx)?;
        ui::init(cx);
        settings::init(cx, settings, None);
        theme::init(cx, None, appearance, false);
        agent_ui::init(cx);
        let registry = cx.new(|cx| AgentRegistry::new(Some(temp.join("agents")), false, cx));
        AgentRegistry::set_global(registry, cx);
        let mut tasks = TaskList::load(None);
        let project = std::path::Path::new("/code/athas");
        let _ = tasks.create("Keep CI green", "Fix failing checks on main and push the fixes.", "athas", project, cloud::Cadence::Hourly, 0);
        let _ = tasks.create("Triage new issues", "Label and reproduce new GitHub issues.", "claude-acp", project, cloud::Cadence::Daily, 0);
        let continuous = cx.new(|cx| ContinuousAgents::new(tasks, cx));
        ContinuousAgents::set_global(continuous, cx);
        Ok(())
    })?;

    let project = std::env::var("ATHAS_SNAPSHOT_PROJECT")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(env!("CARGO_MANIFEST_DIR").trim_end_matches("/crates/ai_snapshot")));
    if scene == "review" || scene == "session-review" {
        record_agent_edits(&temp.join("app"))?;
    }
    let skill_roots = if scene == "skills" { Some(skill_folders(&temp)?) } else { None };
    let cloud_client = CloudClient::new(account::Client::new(account::ServiceUrls::local(&server.url)), Some("snapshot".into()));

    let window = cx.open_window(size(px(width), px(height)), |window, cx| {
        cx.new(|cx| match scene.as_str() {
            "history" => {
                let dir = std::env::var("ATHAS_HISTORY_DIR").map(PathBuf::from).ok();
                let history = cx.new(|cx| HistoryView::with_dir(dir, window, cx));
                if std::env::var_os("ATHAS_SNAPSHOT_AGENT_SESSIONS").is_some() {
                    let session = |agent: &str, id: &str, title: &str, at: &str| agent_ui::outside_sessions::OutsideSession {
                        agent: agent.into(),
                        session_id: id.into(),
                        title: title.into(),
                        updated_at: at.into(),
                        deletable: agent == "claude-code",
                    };
                    let page = agent_ui::outside_sessions::SessionPage {
                        sessions: vec![
                            session("claude-code", "cli-1", "Fix the flaky login test", "2026-11-13T09:00:00Z"),
                            session("claude-code", "cli-2", "Add retries to the HTTP client", "2026-11-12T16:30:00Z"),
                            session("codex", "th-1", "Explain the build cache", "2026-11-10T11:00:00Z"),
                        ],
                        next: vec![("claude-code".into(), "page-2".into())],
                        errors: std::env::var("ATHAS_SNAPSHOT_AGENT_SESSIONS_ERROR").ok().into_iter().collect(),
                    };
                    let holders = [("cli-2".to_string(), "athas-session".to_string())].into_iter().collect();
                    history.update(cx, |history, cx| {
                        history.set_project(Some(project.clone()), cx);
                        history.show_agent_sessions(page, holders, cx);
                    });
                }
                Root { centre: history.into(), dock: None, page: false }
            }
            "review" => {
                let review = cx.new(|cx| ReviewView::new("snapshot".into(), "Add retries to the HTTP client".into(), cx));
                Root { centre: review.into(), dock: None, page: false }
            }
            "inline-edit" => {
                let request = InlineEditRequest {
                    path: "src/client.rs".into(),
                    language_id: "rust".into(),
                    selection_text: "pub fn get(&self, path: &str) -> Result<String> {\n    let url = format!(\"{}/{path}\", self.base);\n    request(&url)\n}".into(),
                    instruction: "Retry with the timeout".into(),
                    ..Default::default()
                };
                let prompt = cx.new(|cx| InlineEditPrompt::new(request, window, cx).with_secrets(Arc::new(MemorySecrets::default())));
                prompt.update(cx, |prompt, cx| prompt.run(cx));
                let page = cx.new(|_| Centered(prompt.into()));
                Root { centre: page.into(), dock: None, page: false }
            }
            "ai-settings" => {
                let github = ai_mcp::secrets_key("github").unwrap_or_default();
                let secrets = Arc::new(MemorySecrets::with(&[
                    ("ai_token_anthropic", "sk-ant-api03-snapshot-1234"),
                    (github.as_str(), r#"{"env":[{"name":"GITHUB_PERSONAL_ACCESS_TOKEN","value":"ghp_snapshot"}],"headers":[]}"#),
                ]));
                let view = cx.new(|cx| AiSettingsView::with_secrets(secrets, window, cx));
                if let Ok(provider) = std::env::var("ATHAS_SNAPSHOT_KEY_ENTRY") {
                    let provider: &'static str = Box::leak(provider.into_boxed_str());
                    view.update(cx, |view, cx| view.show_key_entry(provider, "sk-proj-snapshot-secret", window, cx));
                }
                if let Ok(server) = std::env::var("ATHAS_SNAPSHOT_MCP_EDITOR") {
                    view.update(cx, |view, cx| view.open_mcp_server_editor((server != "new").then_some(server.as_str()), window, cx));
                }
                if let Ok(kind) = std::env::var("ATHAS_SNAPSHOT_INTEGRATION") {
                    let (kind, installed) = kind.split_once(':').map_or((kind.as_str(), true), |(kind, view)| (kind, view != "catalog"));
                    view.update(cx, |view, cx| view.show_integration(kind, installed, cx));
                }
                // `mcp:github` or `agents:<id>`: Integrations revealing that row, on a page that
                // scrolls as Settings does, so the reveal can bring it into view.
                if let Ok(reveal) = std::env::var("ATHAS_SNAPSHOT_REVEAL")
                    && let Some((kind, id)) = reveal.split_once(':')
                {
                    let scroll = gpui::ScrollHandle::new();
                    view.update(cx, |view, cx| {
                        view.set_page_scroll(scroll.clone());
                        view.reveal(kind, id, cx);
                    });
                    let page = cx.new(|_| ScrolledPage { view: view.into(), scroll });
                    return Root { centre: page.into(), dock: None, page: false };
                }
                Root { centre: view.into(), dock: None, page: true }
            }
            "claude-diff" => {
                let request = claude_ide::tools::DiffRequest {
                    request_id: "claude-ide-1".into(),
                    old_file_path: "/code/athas/src/http/client.rs".into(),
                    new_file_path: "/code/athas/src/http/client.rs".into(),
                    new_contents: "use std::time::Duration;\n\nconst RETRIES: u32 = 3;\n\npub struct Client {\n    base: String,\n    timeout: Duration,\n}\n\nimpl Client {\n    pub fn get(&self, path: &str) -> Result<String> {\n        let url = format!(\"{}/{path}\", self.base);\n        retry(RETRIES, || request(&url, self.timeout))\n    }\n}\n".into(),
                    tab_name: "client.rs (Claude Code)".into(),
                };
                let old = "use std::time::Duration;\n\npub struct Client {\n    base: String,\n}\n\nimpl Client {\n    pub fn get(&self, path: &str) -> Result<String> {\n        let url = format!(\"{}/{path}\", self.base);\n        request(&url)\n    }\n}\n";
                claude_ide::propose(request, old.into(), |_| {}, cx);
                let (view, _) = claude_ide::open_resource_with_focus(claude_ide::RESOURCE_KIND, "claude-ide-1", window, cx).expect("a pending diff");
                Root { centre: view, dock: None, page: false }
            }
            "acp-inspector" => {
                use agent_ui::acp::traffic::{Direction, Tap};
                let tap = Tap::start("claude-acp", "Claude Agent", Some("/code/athas".into()));
                for (direction, line) in [
                    (Direction::Out, r#"{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":1,"clientCapabilities":{"fs":{"readTextFile":true,"writeTextFile":true},"terminal":true},"clientInfo":{"name":"athas","title":"Athas","version":"0.16.0"}}}"#),
                    (Direction::In, r#"{"jsonrpc":"2.0","id":0,"result":{"protocolVersion":1,"agentCapabilities":{"loadSession":true,"promptCapabilities":{"image":true,"embeddedContext":true}},"authMethods":[{"id":"claude-login","name":"Log in with Claude"}],"agentInfo":{"name":"claude-agent-acp","version":"0.9.0"}}}"#),
                    (Direction::Out, r#"{"jsonrpc":"2.0","id":1,"method":"session/new","params":{"cwd":"/code/athas","mcpServers":[]}}"#),
                    (Direction::In, r#"{"jsonrpc":"2.0","id":1,"result":{"sessionId":"9f1c2e"}}"#),
                    (Direction::Out, r#"{"jsonrpc":"2.0","id":2,"method":"session/prompt","params":{"sessionId":"9f1c2e","prompt":[{"type":"text","text":"Add retries to the HTTP client"}]}}"#),
                    (Direction::In, r#"{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"9f1c2e","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"Looking at the client."}}}}"#),
                    (Direction::Stderr, "[claude-agent-acp] using model claude-sonnet-5"),
                    (Direction::In, r#"{"jsonrpc":"2.0","id":0,"method":"session/request_permission","params":{"sessionId":"9f1c2e","toolCall":{"toolCallId":"t1","title":"cargo test"},"options":[]}}"#),
                    (Direction::Out, r#"{"jsonrpc":"2.0","id":0,"result":{"outcome":{"outcome":"selected","optionId":"allow"}}}"#),
                    (Direction::In, r#"{"jsonrpc":"2.0","id":2,"result":{"stopReason":"end_turn"}}"#),
                ] {
                    tap.record(direction, line);
                }
                std::mem::forget(tap);
                let view = cx.new(|cx| agent_ui::acp_inspector::AcpInspectorView::new(window, cx));
                if std::env::var_os("ATHAS_SNAPSHOT_CAPABILITIES").is_some() {
                    view.update(cx, |view, cx| view.show_capabilities(cx));
                } else {
                    view.update(cx, |view, cx| view.expand_first(cx));
                }
                Root { centre: view.into(), dock: None, page: false }
            }
            "model-menu" => {
                let ids: Vec<String> = ["auto", "anthropic/claude-opus-4-5", "anthropic/claude-sonnet-5", "openai/gpt-5.2", "openai/gpt-5.2-sol", "google/gemini-3-pro", "google/gemini-3-flash", "x-ai/grok-4", "deepseek/deepseek-v3.2", "moonshotai/kimi-k2"]
                    .iter()
                    .map(|id| id.to_string())
                    .collect();
                let entries = agent_ui::model_vendor::model_entries(&ids, |index| {
                    let id = &ids[index];
                    let name = match agent_ui::model_vendor::vendor_name(id) {
                        Some(vendor) => format!("{} ({vendor})", id.split('/').next_back().unwrap_or(id)),
                        None => "Automatic".into(),
                    };
                    ui::MenuItem::new(name).icon(agent_ui::model_vendor::model_icon("athas", id)).checked(index == 2)
                });
                let menu = ui::Menu::build(entries, window, cx);
                menu.update(cx, |menu, _| menu.set_searchable("Search models…", "No matching models"));
                let page = cx.new(|_| Centered(menu.into()));
                Root { centre: page.into(), dock: None, page: false }
            }
            "api-keys" => {
                let secrets = Arc::new(MemorySecrets::default());
                ai_providers::SecretStore::set(secrets.as_ref(), &ai_providers::secrets::provider_key_account("anthropic"), "sk-ant-test").ok();
                let dialog = cx.new(|cx| agent_ui::provider_key_dialog::ProviderKeyDialog::with_secrets(Some("openai"), secrets, window, cx));
                let page = cx.new(|_| Centered(dialog.into()));
                Root { centre: page.into(), dock: None, page: false }
            }
            "completion" => {
                // Tab completion's status button with its menu open, as beside the breadcrumbs.
                let item = cx.new(agent_ui::tab_completion::CompletionStatusItem::new);
                item.update(cx, |item, cx| item.open_at(gpui::point(px(width / 2. + 120.), px(96.)), window, cx));
                let page = cx.new(|_| Centered(item.into()));
                Root { centre: page.into(), dock: None, page: false }
            }
            "skills" => {
                let view = cx.new(|cx| SkillsView::with_roots(skill_roots.clone().unwrap_or_default(), window, cx));
                Root { centre: view.into(), dock: None, page: false }
            }
            "cloud" => {
                let view = cx.new(|cx| cloud::CloudAgentsView::with_client(Some(cloud_client.clone()), Some("/code/athas".into()), cx));
                Root { centre: view.into(), dock: None, page: false }
            }
            "cloud-run" => {
                let view = cx.new(|cx| cloud::CloudRunView::with_client("r3".into(), Some(cloud_client.clone()), cx));
                Root { centre: view.into(), dock: None, page: false }
            }
            _ => {
                let info = SessionInfo { id: "snapshot".into(), title: "Snapshot".into(), agent: "athas".into(), cwd: Some(project.clone()) };
                let session = cx.new(|cx| SessionView::new(info, window, cx));
                if let Ok(menu) = std::env::var("ATHAS_SNAPSHOT_COMPOSER_MENU") {
                    session.update(cx, |session, cx| session.show_composer_menu(&menu, window, cx));
                }
                // The side column is part of the session view; `dock` adds connectors to it.
                Root { centre: session.into(), dock: None, page: false }
            }
        })
    })?;
    if let Ok(query) = std::env::var("ATHAS_SNAPSHOT_TYPE") {
        for key in query.chars() {
            let key: &'static str = if key == ' ' { "space" } else { Box::leak(key.to_string().into_boxed_str()) };
            let Ok(keystroke) = gpui::Keystroke::parse(key) else { continue };
            cx.update_window(window.into(), move |_, window, cx| {
                window.dispatch_keystroke(keystroke, cx);
            })?;
            cx.run_until_parked();
        }
    }
    cx.allow_parking();
    for _ in 0..12 {
        cx.update_window(window.into(), |_, window, _| window.refresh())?;
        cx.run_until_parked();
        std::thread::sleep(std::time::Duration::from_millis(80));
    }
    let image = cx.capture_screenshot(window.into()).context("capturing the window")?;
    image.save(&out).with_context(|| format!("writing {out}"))?;
    let _ = std::fs::remove_dir_all(&temp);
    println!("{out} {}x{}", image.width(), image.height());
    Ok(())
}

/// A popover centred on an editor-coloured page, as the editor would float it.
struct Centered(AnyView);

/// A Settings page that scrolls (`ATHAS_SNAPSHOT_REVEAL`).
struct ScrolledPage {
    view: AnyView,
    scroll: gpui::ScrollHandle,
}

impl Render for ScrolledPage {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        use gpui::{InteractiveElement as _, StatefulInteractiveElement as _};
        div()
            .id("snapshot-page")
            .size_full()
            .bg(cx.theme().colors.background)
            .overflow_y_scroll()
            .track_scroll(&self.scroll)
            .p(px(24.))
            .child(div().w_full().max_w(px(760.)).mx_auto().child(self.view.clone()))
    }
}

impl Render for Centered {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div().size_full().bg(cx.theme().colors.background).flex().items_start().justify_center().pt(px(80.)).child(self.0.clone())
    }
}
