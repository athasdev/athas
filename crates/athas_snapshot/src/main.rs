//! Renders the workbench to a PNG with the GPU but without a window, so the UI can be checked
//! without anything appearing on screen.
//!
//! `cargo run -p athas_snapshot -- out.png [dark|light] [scene] [width] [height]`
//! Scenes: `project` (default), `session`, `empty`, `hidden-sidebar`, `terminal`, `archived`,
//! `files`, `git`, `github`, `search`, `browser`, `browser-blank`, `docker`, `palette`, `quick-open`, `settings`,
//! `themes`, `keybindings`, `appearance`, `ai-settings`, `remote`, `project-picker`, `new-project`,
//! `new-project-details`, `icon-picker` (`ATHAS_SNAPSHOT_ICON=emoji:🚀` sets the project's icon
//! first), `close-guard`, `unsaved` (with `ATHAS_SNAPSHOT_FILE`), `menu-bar`, `folder-picker`, `window-tabs` (three windows grouped as native tabs, with a
//! pinned editor tab), `sessions-more` (a project with more sessions than its list shows) and
//! `session-rename` (a session row being renamed), `session-placeholder` (session `s2` in its own window, its tab
//! holding the stand-in), `docker-palette` (the command palette's Docker page over
//! `ATHAS_SNAPSHOT_PROJECT`), `detached-pr` / `detached-issue` (a GitHub page in its own window, from recorded data), `bottom-buffers` (the last tab moved into the
//! bottom pane) and `bottom-debugger` (Run and Debug in the bottom pane).
//! Environment:
//! `ATHAS_SNAPSHOT_SCROLLBARS=1` (every overlay scrollbar's thumb shown, as if hovered),
//! `ATHAS_SNAPSHOT_SETTINGS_PAGE` (the page `settings` opens on), `ATHAS_SNAPSHOT_SETTINGS_JSON`
//! (settings to start from), `ATHAS_SNAPSHOT_SETTINGS_QUERY`, `ATHAS_SNAPSHOT_WORKSPACE_SECTION`, `ATHAS_SNAPSHOT_KEYBINDINGS_EDIT=1`,
//! `ATHAS_SNAPSHOT_SETTINGS_EXTENSION` (an integration's page on Settings' Integrations),
//! `ATHAS_SNAPSHOT_REPORT_BUG=1`, `ATHAS_SNAPSHOT_OUTSIDE_SESSIONS=1` (agent sessions outside Athas in the sidebar), `ATHAS_SNAPSHOT_THEME_CREATOR=1` (Create Theme over Settings),
//! `ATHAS_SNAPSHOT_CUSTOM_THEMES` (a `custom-themes.json` to read), `ATHAS_SNAPSHOT_EXTENSIONS_DIR`
//! (extensions installed there instead of the app's folder), `ATHAS_SNAPSHOT_FOLDERS` (folders
//! added to the project's workspace, separated by `:`),
//! `ATHAS_SNAPSHOT_PROJECT`, `ATHAS_SNAPSHOT_FILE`, `ATHAS_SNAPSHOT_RESOURCE`,
//! `ATHAS_SNAPSHOT_THEME`, `ATHAS_SNAPSHOT_SETTLE_MS`, `ATHAS_SNAPSHOT_GIT_TAB` (the Source Control tab shown), `ATHAS_SNAPSHOT_COMMAND` (a command id run
//! after the scene, such as `help.showWhatsNew`), `ATHAS_SNAPSHOT_TAB_MENU` (a tab's context menu,
//! by index), `ATHAS_SNAPSHOT_SESSION_MENU=x,y` (the session in front's More actions menu), `ATHAS_SNAPSHOT_KEYS` (keystrokes typed after
//! it, separated by spaces), `ATHAS_SNAPSHOT_RUN_ACTION=new` (the New run action dialog), and `ATHAS_SNAPSHOT_AGENT_EDIT=1`, which
//! logs an agent edit of `ATHAS_SNAPSHOT_FILE` for session `s2` so its review and the editor's
//! lenses have a hunk. Agent reviews and continuous agents are kept in memory.

use std::{rc::Rc, sync::Arc};

use anyhow::{Context as _, Result};
use gpui::{AppContext, HeadlessAppContext, px, size};
use theme::Appearance;
use workbench::Workbench;
use workspace::{MemoryStore, SessionId, StateStore, WorkspaceState};

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let out = args.first().cloned().unwrap_or_else(|| "snapshot.png".into());
    let appearance = match args.get(1).map(String::as_str) {
        Some("light") => Appearance::Light,
        _ => Appearance::Dark,
    };
    let scene = args.get(2).cloned().unwrap_or_else(|| "project".into());
    let width: f32 = args.get(3).and_then(|w| w.parse().ok()).unwrap_or(1280.);
    let height: f32 = args.get(4).and_then(|h| h.parse().ok()).unwrap_or(820.);

    let text_system = gpui_platform::current_platform(true).text_system();
    let mut cx = HeadlessAppContext::with_platform(text_system, Arc::new(ui::Assets), || {
        gpui_platform::current_headless_renderer()
    });
    cx.update(|cx| -> Result<()> {
        ui::load_fonts(cx)?;
        ui::init(cx);
        if std::env::var_os("ATHAS_SNAPSHOT_SCROLLBARS").is_some() {
            cx.set_global(ui::AlwaysShowScrollbars(true));
        }
        let mut settings = settings::Settings::default();
        // The welcome shows only in the `welcome` scene.
        if std::env::args().nth(3).as_deref() != Some("welcome") {
            settings.extra.insert("gpuiOnboardingCompleted".into(), true.into());
        }
        if let Ok(theme) = std::env::var("ATHAS_SNAPSHOT_THEME") {
            settings.theme = theme;
            settings.sync_system_theme = false;
        }
        if let Ok(page) = std::env::var("ATHAS_SNAPSHOT_SETTINGS_PAGE") {
            settings.last_settings_tab = page;
        }
        if let Ok(extra) = std::env::var("ATHAS_SNAPSHOT_SETTINGS_JSON")
            && let Ok(serde_json::Value::Object(values)) = serde_json::from_str(&extra)
        {
            for (key, value) in values {
                if settings.set(&key, value.clone()).is_err() {
                    settings.extra.insert(key, value);
                }
            }
        }
        settings::init(cx, settings, None);
        theme::set_accessibility_reader(cx, snapshot_accessibility);
        match std::env::var("ATHAS_SNAPSHOT_EXTENSIONS_DIR") {
            Ok(dir) => extensions::init_with(cx, Some(dir.into()), None),
            Err(_) => extensions::init(cx),
        }
        if let Ok(path) = std::env::var("ATHAS_SNAPSHOT_CUSTOM_THEMES") {
            extensions::set_custom_themes_path(Some(path.into()), cx);
        }
        // UI extension storage lives under `ATHAS_SNAPSHOT_UI_EXTENSIONS_DIR`, in memory without one.
        extensions_ui::ui_extensions::init_with(cx, std::env::var("ATHAS_SNAPSHOT_UI_EXTENSIONS_DIR").ok().map(Into::into));
        extensions_ui::init(cx);
        theme::init(cx, None, appearance, false);
        workbench::apply_theme(appearance, cx);
        settings_ui::init(cx);
        // Team workspaces are kept in memory; `ATHAS_SNAPSHOT_WORKSPACE_SECTION` picks the section shown.
        settings_ui::team_workspaces::use_state_at(None, cx);
        if let Some(section) = std::env::var("ATHAS_SNAPSHOT_WORKSPACE_SECTION").ok().and_then(|id| workspace::team::WorkspaceSection::from_id(&id)) {
            settings_ui::team_workspaces::management(cx).update(cx, |management, cx| management.set_section(section, cx));
        }
        workbench::init(cx);
        agent_ui::review::Store::init_global(None);
        let continuous = cx.new(|cx| agent_ui::cloud::ContinuousAgents::new(agent_ui::cloud::continuous::TaskList::load(None), cx));
        agent_ui::cloud::ContinuousAgents::set_global(continuous, cx);
        if std::env::var_os("ATHAS_SNAPSHOT_ACCOUNT_USAGE").is_some() {
            // What the sessions footer draws for a connected Athas account and GitHub Copilot.
            workbench::agent_usage::set_sample_rows(
                vec![
                    workbench::agent_usage::athas_row(
                        &agent_ui::hosted_usage::HostedUsage {
                            used_percent: 25,
                            level: agent_ui::hosted_usage::Level::Ok,
                            remaining_cents: 750,
                            allowance_cents: 1000,
                            wallet_balance_cents: None,
                            resets: Some("Dec 1".into()),
                        },
                        "https://athas.dev/dashboard/billing".into(),
                    ),
                    workbench::agent_usage::copilot_row(&github_panel::copilot::CopilotAllowance {
                        plan: Some("individual".into()),
                        premium: Some(github_panel::copilot::CopilotQuota {
                            unlimited: false,
                            remaining: 764,
                            entitlement: 1500,
                            percent_remaining: 50.9,
                        }),
                        resets_on: Some("2026-12-01".into()),
                    })
                    .expect("the sample allowance is metered"),
                ],
                cx,
            );
        }
        if std::env::var_os("ATHAS_SNAPSHOT_OUTSIDE_SESSIONS").is_some() {
            // Conversations Claude Code and Codex keep for the project outside Athas, from fake agents.
            agent_ui::outside_sessions::set_sidebar_lister(
                std::rc::Rc::new(|_, _| {
                    let session = |agent: &str, id: &str, title: &str, at: &str| agent_ui::outside_sessions::OutsideSession {
                        agent: agent.into(),
                        session_id: id.into(),
                        title: title.into(),
                        updated_at: at.into(),
                        deletable: true,
                    };
                    gpui::Task::ready(vec![
                        session("claude-code", "cli-1", "Fix the flaky resize test", "2026-11-12T08:00:00Z"),
                        session("codex", "cli-2", "Bump tree-sitter grammars", "2026-11-01T08:00:00Z"),
                    ])
                }),
                cx,
            );
        }
        if std::env::var_os("ATHAS_SNAPSHOT_AGENT_EDIT").is_some()
            && let Ok(path) = std::env::var("ATHAS_SNAPSHOT_FILE")
            && let Ok(content) = std::fs::read_to_string(&path)
        {
            // The agent added lines 4 to 7 and changed line 10.
            let mut lines: Vec<&str> = content.lines().collect();
            if lines.len() > 12 {
                lines[9] = "    // before the agent";
                lines.drain(3..7);
            }
            let previous = lines.join("\n") + "\n";
            let change = agent_ui::review::FileChange { path: path.into(), previous: Some(previous), content: Some(content) };
            agent_ui::review::record("s2", Some(0), change, cx);
        }
        if scene == "problems" {
            seed_problems(cx);
        }
        Ok(())
    })?;

    // `detached-terminal`, `detached-settings`, `detached-extensions`, `detached-session`: a
    // single-view window instead of the workbench.
    if let Some(kind) = scene.strip_prefix("detached-") {
        let content = match kind {
            "terminal" => workbench::DetachedContent::Terminal { cwd: std::env::var("ATHAS_SNAPSHOT_PROJECT").ok().map(Into::into) },
            "settings" => workbench::DetachedContent::Settings,
            "extensions" => workbench::DetachedContent::Extensions,
            "pr" | "issue" => {
                let root: std::path::PathBuf = std::env::var("ATHAS_SNAPSHOT_PROJECT").unwrap_or_else(|_| "/tmp/athas-snapshot-repo".into()).into();
                cx.open_window(size(px(10.), px(10.)), |window, cx| {
                    let (view, _) = github_panel::snapshot::scene(kind, root.clone(), window, cx).expect("github scene");
                    cx.new(|_| SeedHost(view))
                })?;
                let (kind, id, title) = if kind == "pr" { ("github-pr", "41", "Port the GitHub panel to GPUI") } else { ("github-issue", "7", "") };
                workbench::DetachedContent::Resource { kind: kind.into(), id: id.into(), title: title.into(), root }
            }
            _ => workbench::DetachedContent::Session(workbench::DetachedSession {
                id: "s1".into(),
                title: "Fix the flaky login test".into(),
                agent: "claude-code".into(),
                cwd: None,
                folders: Vec::new(),
            }),
        };
        let window = cx.open_window(size(px(width), px(height)), |window, cx| cx.new(|cx| workbench::DetachedWindow::new(content, window, cx)))?;
        cx.allow_parking();
        for _ in 0..6 {
            cx.update_window(window.into(), |_, window, _| window.refresh())?;
            cx.run_until_parked();
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        let image = cx.capture_screenshot(window.into()).context("capturing the window")?;
        image.save(&out).with_context(|| format!("writing {out}"))?;
        println!("{out} {}x{}", image.width(), image.height());
        return Ok(());
    }
    // `session-placeholder`: session `s2` shown in a window of its own, so its tab holds the stand-in.
    if scene == "session-placeholder" {
        cx.update(|cx| {
            workbench::set_detached_opener(cx, |_, cx| {
                cx.open_window(gpui::WindowOptions::default(), |_, cx| cx.new(|_| Blank)).ok().map(Into::into)
            });
            let session = workbench::DetachedSession {
                id: "s2".into(),
                title: String::new(),
                agent: "claude-code".into(),
                cwd: None,
                folders: Vec::new(),
            };
            workbench::open_detached(workbench::DetachedContent::Session(session), cx);
        });
    }
    let state = scene_state(&scene);
    let store: Rc<dyn StateStore> = Rc::new(MemoryStore::default());
    let window = cx.open_window(size(px(width), px(height)), |window, cx| {
        cx.new(|cx| {
            let mut workbench = Workbench::with_state(state, Some(store), window, cx);
            workbench.follow_system_appearance = false;
            workbench
        })
    })?;
    // Three windows grouped as native tabs, this one second, its tab strip with a pinned tab.
    if scene == "window-tabs" {
        cx.update(|cx| {
            window
                .update(cx, |workbench, _, _| {
                    workbench.set_platform(workbench::Platform::Mac);
                    let tab = |id: u64, title: &str, path: Option<&str>, active: bool| workbench::WindowTab {
                        window: gpui::WindowId::from(id),
                        title: title.into(),
                        project_path: path.map(str::to_string),
                        custom_icon: None,
                        active,
                    };
                    workbench.set_window_tabs_preview(vec![
                        tab(101, "www", Some("/Users/me/Documents/Git/athasdev/www"), false),
                        tab(102, "athas", Some("/Users/me/Documents/Git/athasdev/athas"), true),
                        tab(103, "Athas", None, false),
                    ]);
                })
                .ok();
        });
    }
    // Scenes that float something over the workbench.
    let overlay = args.get(5).cloned().or_else(|| match scene.as_str() {
        "palette" | "quick-open" | "settings" | "themes" | "keybindings" | "appearance" | "ai-settings" | "notifications" | "run" | "account" | "remote"
        | "project-picker" | "new-project" | "new-project-details" | "icon-picker" | "close-guard" | "menu-bar" | "folder-picker" | "session-rename"
        | "docker-palette" => Some(scene.clone()),
        _ => None,
    });
    if let Some(overlay) = overlay {
        cx.update(|cx| {
            window
                .update(cx, |workbench, window, cx| match overlay.as_str() {
                    "palette" => workbench.command_palette(&workbench::CommandPalette, window, cx),
                    "docker-palette" => {
                        let root = std::env::var("ATHAS_SNAPSHOT_PROJECT").ok().map(std::path::PathBuf::from);
                        let picker = docker_view::docker_picker(root, window, cx);
                        workbench.open_modal(picker, window, cx);
                    }
                    "quick-open" => workbench.quick_open(&workbench::QuickOpen, window, cx),
                    "settings" => {
                        let view = workbench.open_settings_view(None, window, cx);
                        // `ATHAS_SNAPSHOT_SETTINGS_PAGE=<page id>` opens one page (general, editor, git, ...).
                        if let Ok(page) = std::env::var("ATHAS_SNAPSHOT_SETTINGS_PAGE") {
                            workbench.open_settings_page(Some(Box::leak(page.into_boxed_str())), window, cx);
                        }
                        view.update(cx, |view, cx| {
                            if let Ok(query) = std::env::var("ATHAS_SNAPSHOT_SETTINGS_QUERY") {
                                view.set_query(&query, window, cx);
                            }
                            if std::env::var_os("ATHAS_SNAPSHOT_KEYBINDINGS_EDIT").is_some() {
                                view.edit_keybindings(window, cx);
                            }
                            if std::env::var_os("ATHAS_SNAPSHOT_REPORT_BUG").is_some() {
                                view.report_bug(window, cx);
                            }
                            if std::env::var_os("ATHAS_SNAPSHOT_THEME_CREATOR").is_some() {
                                view.create_theme(window, cx);
                            }
                            if let Ok(id) = std::env::var("ATHAS_SNAPSHOT_SETTINGS_EXTENSION") {
                                view.open_integration(&id, window, cx);
                            }
                        });
                    }
                    "themes" => workbench.select_theme(&workbench::SelectTheme, window, cx),
                    "notifications" => {
                        notifications::notify(cx, notifications::NotificationKind::Success, notifications::NotificationCategory::Athas, "Committed 3 files", Some("main · 9f2c1ab".into()), None);
                        notifications::notify(cx, notifications::NotificationKind::Error, notifications::NotificationCategory::Agent, "Agent stopped", Some("claude-code exited with code 1".into()), None);
                        window.dispatch_action(Box::new(workbench::ShowNotifications), cx);
                    }
                    "run" => workbench.show_run_actions(&workbench::ShowRunActions, window, cx),
                    "account" => window.dispatch_action(Box::new(workbench::ToggleAccountMenu), cx),
                    "remote" => workbench.show_remote_connections(window, cx),
                    "keybindings" => workbench.open_settings_page(Some("keyboard"), window, cx),
                    "appearance" => workbench.open_settings_page(Some("appearance"), window, cx),
                    "ai-settings" => workbench.open_settings_page(Some("ai"), window, cx),
                    "project-picker" => workbench.show_project_picker(workbench::ProjectPickerStep::Picker, window, cx),
                    "new-project" => workbench.show_project_picker(workbench::ProjectPickerStep::NewProject, window, cx),
                    "new-project-details" => {
                        workbench.show_project_picker(workbench::ProjectPickerStep::NewProject, window, cx);
                    }
                    "icon-picker" => {
                        if let Some(project) = workbench.state().active_project.clone() {
                            workbench.show_project_icon_picker(&project, window, cx);
                        }
                    }
                    "close-guard" => workbench.request_close(workbench::CloseIntent::Quit, window, cx),
                    "menu-bar" => {
                        workbench.set_platform(workbench::Platform::Linux);
                        workbench.show_window_menu(Some(0), window, cx);
                    }
                    "folder-picker" => workbench.open_folder_picker(window, cx),
                    "session-rename" => workbench.start_session_rename(&SessionId("s1".into()), window, cx),
                    _ => {}
                })
                .ok();
        });
    }
    if let Ok(command) = std::env::var("ATHAS_SNAPSHOT_COMMAND") {
        cx.update_window(window.into(), |_, window, cx| {
            if let Some(action) = cx.try_global::<keymap::CommandRegistry>().and_then(|registry| registry.action(&command)) {
                window.dispatch_action(action, cx);
            }
        })?;
        cx.run_until_parked();
    }
    // `ATHAS_SNAPSHOT_GIT_TAB=<name>`: the Source Control panel on that tab (`tags`, `branches`, ...).
    if let Ok(name) = std::env::var("ATHAS_SNAPSHOT_GIT_TAB") {
        cx.run_until_parked();
        cx.update(|cx| {
            window.update(cx, |workbench, _, cx| workbench.open_git_tab(&name, cx)).ok();
        });
        cx.run_until_parked();
    }
    // `ATHAS_SNAPSHOT_TAB_MENU=<index>`: the context menu of that tab of the front group.
    if let Some(index) = std::env::var("ATHAS_SNAPSHOT_TAB_MENU").ok().and_then(|index| index.parse().ok()) {
        cx.run_until_parked();
        cx.update(|cx| {
            window.update(cx, |workbench, window, cx| workbench.show_tab_menu(index, gpui::point(px(420.), px(84.)), window, cx)).ok();
        });
    }
    // `ATHAS_SNAPSHOT_SESSION_MENU=x,y`: the session in front's More actions menu, from that point.
    if let Some((x, y)) = std::env::var("ATHAS_SNAPSHOT_SESSION_MENU").ok().and_then(|point| {
        let (x, y) = point.split_once(',')?;
        Some((x.parse::<f32>().ok()?, y.parse::<f32>().ok()?))
    }) {
        cx.run_until_parked();
        cx.update(|cx| {
            window.update(cx, |workbench, window, cx| workbench.show_front_session_more_actions(gpui::point(px(x), px(y)), window, cx)).ok();
        });
    }
    if std::env::var("ATHAS_SNAPSHOT_RUN_ACTION").as_deref() == Ok("new") {
        cx.update(|cx| {
            window.update(cx, |workbench, window, cx| workbench.manage_run_action(run_actions::ManageRequest::New, None, window, cx)).ok();
        });
    }
    if let Ok(keys) = std::env::var("ATHAS_SNAPSHOT_KEYS") {
        for key in keys.split_whitespace() {
            let key: &'static str = Box::leak(key.to_string().into_boxed_str());
            cx.update_window(window.into(), |_, window, cx| {
                window.dispatch_keystroke(gpui::Keystroke::parse(key).unwrap(), cx);
            })?;
            cx.run_until_parked();
        }
    }
    if scene == "new-project-details" {
        // Down three times to Clone Repository, then Return.
        for key in ["down", "down", "down", "enter"] {
            cx.update_window(window.into(), |_, window, cx| {
                window.dispatch_keystroke(gpui::Keystroke::parse(key).unwrap(), cx);
            })?;
            cx.run_until_parked();
        }
    }
    // Several frames, with real time between them: the first lays out the title row, later ones
    // show what loaded in the background (folders, git status, a shell's prompt).
    cx.allow_parking();
    let settle_ms: u64 = std::env::var("ATHAS_SNAPSHOT_SETTLE_MS").ok().and_then(|ms| ms.parse().ok()).unwrap_or(150);
    for _ in 0..6 {
        cx.update_window(window.into(), |_, window, _| window.refresh())?;
        cx.run_until_parked();
        std::thread::sleep(std::time::Duration::from_millis(settle_ms / 6));
    }
    // `ATHAS_SNAPSHOT_TREE=properties:/path` or `hover:/path`: the Files tool's Properties card,
    // or the pointer resting on a row (a folder's size, a symlink's tooltip).
    if let Ok(request) = std::env::var("ATHAS_SNAPSHOT_TREE")
        && let Some((what, path)) = request.split_once(':')
    {
        cx.update(|cx| {
            let tree = window.update(cx, |workbench, _, _| workbench.file_tree()).ok().flatten();
            if let Some(tree) = tree {
                tree.update(cx, |tree, cx| match what {
                    "properties" => tree.show_properties(path.into(), cx),
                    _ => tree.hover_path(std::path::Path::new(path), cx),
                });
            }
        });
        for _ in 0..6 {
            cx.update_window(window.into(), |_, window, _| window.refresh())?;
            cx.run_until_parked();
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
    }
    // `ATHAS_SNAPSHOT_TOAST=1`: an error toast with a description and an info toast.
    if std::env::var_os("ATHAS_SNAPSHOT_TOAST").is_some() {
        cx.update(|cx| {
            notifications::error(cx, "Could not save main.tsx", Some("The file is read-only.".into()));
            notifications::info(cx, "Copied path to clipboard");
        });
    }
    // `ATHAS_SNAPSHOT_HOVER=x,y`: the pointer resting at a point, long enough for its tooltip.
    if let Some((x, y)) = std::env::var("ATHAS_SNAPSHOT_HOVER").ok().and_then(|point| {
        let (x, y) = point.split_once(',')?;
        Some((x.parse::<f32>().ok()?, y.parse::<f32>().ok()?))
    }) {
        cx.update_window(window.into(), |_, window, cx| {
            let event = gpui::MouseMoveEvent { position: gpui::point(px(x), px(y)), pressed_button: None, modifiers: Default::default() };
            window.dispatch_event(gpui::PlatformInput::MouseMove(event), cx);
        })?;
    }
    if std::env::var_os("ATHAS_SNAPSHOT_TOAST").is_some() || std::env::var_os("ATHAS_SNAPSHOT_HOVER").is_some() {
        for _ in 0..12 {
            cx.update_window(window.into(), |_, window, _| window.refresh())?;
            cx.run_until_parked();
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
    }
    // `extension-sidebar` / `extension-dialog`: the first UI extension's sidebar view, and for the
    // dialog scene the command `ATHAS_SNAPSHOT_EXTENSION_COMMAND` run once it has started.
    if scene == "extension-sidebar" || scene == "extension-dialog" {
        for _ in 0..50 {
            if !cx.update(|cx| extensions_ui::ui_extensions::sidebar_views(cx).is_empty()) {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
            cx.run_until_parked();
        }
        cx.update(|cx| {
            if let Some(view) = extensions_ui::ui_extensions::sidebar_views(cx).into_iter().next() {
                window.update(cx, |workbench, window, cx| workbench.show_extension_view(view.id, window, cx)).ok();
            }
            if scene == "extension-dialog"
                && let Ok(command) = std::env::var("ATHAS_SNAPSHOT_EXTENSION_COMMAND")
            {
                extensions_ui::ui_extensions::run_command(&command, cx);
            }
        });
        for _ in 0..10 {
            cx.update_window(window.into(), |_, window, _| window.refresh())?;
            cx.run_until_parked();
            std::thread::sleep(std::time::Duration::from_millis(60));
        }
    }
    // A close with unsaved changes: edit the file once its editor has loaded it.
    if scene == "unsaved" {
        cx.update(|cx| {
            window
                .update(cx, |workbench, window, cx| {
                    if let Some(editor) = workbench.active_file_editor() {
                        editor.update(cx, |editor, cx| {
                            use gpui::EntityInputHandler;
                            editor.replace_text_in_range(None, "// edited\n", window, cx);
                        });
                    }
                    workbench.request_close(workbench::CloseIntent::Close, window, cx);
                })
                .ok();
        });
        for _ in 0..3 {
            cx.update_window(window.into(), |_, window, _| window.refresh())?;
            cx.run_until_parked();
            std::thread::sleep(std::time::Duration::from_millis(settle_ms / 6));
        }
    }
    let image = cx.capture_screenshot(window.into()).context("capturing the window")?;
    image.save(&out).with_context(|| format!("writing {out}"))?;
    println!("{out} {}x{}", image.width(), image.height());
    Ok(())
}

/// `ATHAS_SNAPSHOT_ACCESSIBILITY=increase-contrast,reduce-transparency,differentiate-without-color,reduce-motion`
/// stands in for the system's accessibility display options.
fn snapshot_accessibility() -> theme::SystemAccessibility {
    let options = std::env::var("ATHAS_SNAPSHOT_ACCESSIBILITY").unwrap_or_default();
    let has = |name: &str| options.split(',').any(|option| option.trim() == name);
    theme::SystemAccessibility {
        reduce_transparency: has("reduce-transparency"),
        increase_contrast: has("increase-contrast"),
        differentiate_without_color: has("differentiate-without-color"),
        reduce_motion: has("reduce-motion"),
    }
}

/// `ATHAS_SNAPSHOT_PROJECT=/some/folder` opens a real folder as the active project, so the Files,
/// Source Control and terminal scenes show real content.
fn scene_state(scene: &str) -> WorkspaceState {
    let mut state = workbench::demo_state();
    if let Ok(path) = std::env::var("ATHAS_SNAPSHOT_PROJECT") {
        let id = state.open_project(&path);
        for folder in std::env::var("ATHAS_SNAPSHOT_FOLDERS").unwrap_or_default().split(':').filter(|folder| !folder.is_empty()) {
            state.add_project_folder(&id, folder);
        }
    }
    if let Some(width) = std::env::var("ATHAS_SNAPSHOT_SIDEBAR_WIDTH").ok().and_then(|width| width.parse().ok()) {
        state.layout.sidebar_width = width;
    }
    // `ATHAS_SNAPSHOT_FILE=/path` opens a file in the centre (the editor, or a viewer).
    if let Ok(path) = std::env::var("ATHAS_SNAPSHOT_FILE") {
        state.open_file(&path);
    }
    // `ATHAS_SNAPSHOT_RESOURCE=kind:id:title` opens a tool's centre view, such as a pull request;
    // the id may hold colons (`git-diff:a:all:Uncommitted Changes`).
    if let Ok(resource) = std::env::var("ATHAS_SNAPSHOT_RESOURCE")
        && let Some((kind, rest)) = resource.split_once(':')
        && let Some((id, title)) = rest.rsplit_once(':')
    {
        state.open_resource(kind, id, title);
    }
    match scene {
        "session" | "session-placeholder" => state.open_session(&SessionId("s2".into())),
        "empty" | "welcome" => state = WorkspaceState::default(),
        "window-tabs" => {
            state.show_project_view();
            for path in ["Cargo.toml", "src/main.rs", "src/lib.rs", "README.md"] {
                state.open_file(&format!("/Users/me/Documents/Git/athasdev/athas/{path}"));
            }
            state.toggle_tab_pinned(1);
        }
        "hidden-sidebar" => {
            state.open_session(&SessionId("s2".into()));
            state.layout.sidebar_visible = false;
        }
        "terminal" => state.layout.bottom_pane_visible = true,
        "bottom-buffers" => {
            if let Some(group) = state.focused_panes().map(|panes| panes.active) {
                let last = state.focused_tabs().map_or(0, |tabs| tabs.tabs.len().saturating_sub(1));
                state.move_tab_to_bottom(group, last);
                state.show_bottom_tab(workspace::BottomTab::Buffers);
            }
        }
        "bottom-debugger" => state.show_bottom_tab(workspace::BottomTab::Debugger),
        "files" => state.layout.sidebar_view = workspace::SidebarView::Files,
        "github" => state.layout.sidebar_view = workspace::SidebarView::GitHub,
        "search" => state.open_resource("search", "project", "Search"),
        "split" => {
            // Two files side by side, the right one split again below.
            let root = env!("CARGO_MANIFEST_DIR").trim_end_matches("/crates/athas_snapshot").to_string();
            state.open_project(&root);
            state.open_file(&format!("{root}/crates/workspace/src/workspace.rs"));
            state.split_pane(workspace::SplitAxis::Horizontal);
            state.open_file(&format!("{root}/crates/theme/src/theme.rs"));
            state.split_pane(workspace::SplitAxis::Vertical);
            state.open_file(&format!("{root}/README.md"));
        }
        "browser" | "browser-blank" => {
            // Pages are kept in memory, never in the app's data folder.
            browser_view::pages::use_store_at(None);
            let (url, zoom, title) = match scene {
                "browser" => ("https://athas.dev/docs", Some(1.25), "athas.dev"),
                _ => ("about:blank", None, "New Tab"),
            };
            browser_view::pages::with_store(|store| {
                store.update("snapshot", |page| {
                    page.url = url.into();
                    page.zoom = zoom;
                })
            });
            state.open_resource("browser", "snapshot", title);
        }
        "docker" => state.open_resource("docker", "", "Docker"),
        "extensions" => state.open_resource("extensions", "", "Integrations"),
        "debugger" => state.open_resource("debugger", "", "Run and Debug"),
        "problems" => state.open_resource("problems", "", "Diagnostics"),
        "history" => state.open_resource("history", "", "History"),
        "dashboard" => {
            if let Some(project) = state.active_project.clone() {
                state.open_project_dashboard(&project);
            }
        }
        "acp-inspector" => state.open_resource("acp-inspector", "", "ACP Inspector"),
        "team" => state.open_resource("team", "", "Team"),
        "git" => state.layout.sidebar_view = workspace::SidebarView::Git,
        "project-picker" => {
            let old = state.open_project("/Users/me/Documents/Git/old-api");
            state.close_project(&old);
            state.mark_recent_missing("/Users/me/Documents/Git/old-api", true);
            state.toggle_recent_pinned("/Users/me/Documents/Git/athasdev/www");
            if let Some(active) = state.active_project.clone() {
                state.set_project_icon(&active, Some("emoji:🚀".into()));
            }
        }
        "icon-picker" if std::env::var_os("ATHAS_SNAPSHOT_ICON").is_some() => {
            if let (Some(active), Ok(icon)) = (state.active_project.clone(), std::env::var("ATHAS_SNAPSHOT_ICON")) {
                state.set_project_icon(&active, Some(icon));
            }
        }
        "unsaved" => state.set_session_status(&SessionId("s1".into()), workspace::SessionStatus::Idle),
        "sessions-more" => {
            let project = state.active_project.clone();
            for title in ["Fix flaky watcher test", "Port the git blame view", "Speed up search indexing", "Bump tree-sitter grammars", "Draft release notes", "Profile startup"] {
                let id = state.new_session(project.clone(), "claude-code");
                state.rename_session(&id, title);
            }
        }
        "archived" => {
            state.archive_session(&SessionId("s3".into()), true);
            state.layout.archived_expanded = true;
        }
        _ => {}
    }
    state
}

/// Diagnostics for the `problems` scene, as rust-analyzer and clippy would publish them.
fn seed_problems(cx: &mut gpui::App) {
    use gpui::BorrowAppContext as _;
    use lsp_client::lsp::{Diagnostic, DiagnosticSeverity, NumberOrString, Position, PublishDiagnosticsParams, Range, Url};
    lsp_client::init(cx);
    let root = std::env::var("ATHAS_SNAPSHOT_PROJECT").unwrap_or_else(|_| "/Users/demo/athas".into());
    let diagnostic = |line: u32, column: u32, severity: DiagnosticSeverity, message: &str, source: &str, code: Option<&str>| Diagnostic {
        range: Range::new(Position::new(line, column), Position::new(line, column + 4)),
        severity: Some(severity),
        message: message.into(),
        source: Some(source.into()),
        code: code.map(|code| NumberOrString::String(code.into())),
        ..Default::default()
    };
    let files = [
        (
            "crates/editor/src/lsp.rs",
            vec![
                diagnostic(41, 8, DiagnosticSeverity::ERROR, "mismatched types\nexpected `usize`, found `u32`", "rustc", Some("E0308")),
                diagnostic(118, 12, DiagnosticSeverity::WARNING, "unused variable: `anchor`", "rustc", Some("unused_variables")),
            ],
        ),
        ("crates/ui/src/table.rs", vec![diagnostic(9, 4, DiagnosticSeverity::WARNING, "this `if` has identical blocks", "clippy", Some("if_same_then_else"))]),
        (
            "crates/workbench/src/commands.rs",
            vec![
                diagnostic(102, 16, DiagnosticSeverity::INFORMATION, "consider using `Option::map_or` instead", "clippy", Some("option_map_or_none")),
                diagnostic(7, 0, DiagnosticSeverity::HINT, "remove the unnecessary import", "rust-analyzer", None),
            ],
        ),
    ];
    cx.update_global::<lsp_client::DiagnosticsStore, _>(|store, _| {
        for (path, diagnostics) in files {
            let uri = Url::from_file_path(std::path::Path::new(&root).join(path)).unwrap();
            store.publish(1, PublishDiagnosticsParams { uri, diagnostics, version: None });
        }
    });
}

/// Holds a recorded GitHub page while the scene seeds the store.
struct SeedHost(gpui::AnyView);

impl gpui::Render for SeedHost {
    fn render(&mut self, _: &mut gpui::Window, _: &mut gpui::Context<Self>) -> impl gpui::IntoElement {
        self.0.clone()
    }
}

/// An empty window, standing in for a detached session's.
struct Blank;

impl gpui::Render for Blank {
    fn render(&mut self, _: &mut gpui::Window, _: &mut gpui::Context<Self>) -> impl gpui::IntoElement {
        gpui::Empty
    }
}
