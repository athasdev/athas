//! The macOS menu bar (`src-tauri/src/menu.rs`), with the same menus and items, each running the
//! workbench action of its command. Items whose feature is not ported yet are left out.

use gpui::{App, Menu, MenuItem, OsAction, SystemMenuType};
use ui::text_input;

use crate::*;

pub(crate) const DOCS_URL: &str = "https://athas.dev/docs";
pub(crate) const CHANGELOG_URL: &str = "https://athas.dev/changelog";
pub(crate) const BUG_URL: &str = "https://github.com/athasdev/athas/issues/new?template=01-bug.yml";
pub(crate) const FEATURE_URL: &str = "https://github.com/athasdev/athas/discussions/new?category=ideas";

/// A menu item for an action another crate registers (the platform crate depends on this one),
/// left out when that crate is not linked, as in headless snapshots.
fn named_item(cx: &App, label: &'static str, action: &str) -> Option<MenuItem> {
    cx.build_action(action, None).ok().map(|action| MenuItem::Action {
        name: label.into(),
        action,
        os_action: None,
        checked: false,
        disabled: false,
    })
}

pub fn app_menus(cx: &App) -> Vec<Menu> {
    let platform_items: Vec<MenuItem> = [
        named_item(cx, "Check for Updates…", "platform::CheckForUpdates"),
        named_item(cx, "Install Shell Command", "platform::InstallCliCommand"),
    ]
    .into_iter()
    .flatten()
    .collect();
    vec![
        Menu::new("Athas").items(platform_items.into_iter().chain([
            MenuItem::separator(),
            MenuItem::action("Settings…", OpenSettings),
            MenuItem::action("Color Theme…", SelectTheme),
            MenuItem::action("Icon Theme…", SelectIconTheme),
            MenuItem::action("Extensions", ShowExtensions),
            MenuItem::separator(),
            MenuItem::os_submenu("Services", SystemMenuType::Services),
            MenuItem::separator(),
            MenuItem::action("Quit Athas", Quit),
        ])),
        Menu::new("File").items([
            MenuItem::action("New Session", NewSession),
            MenuItem::action("New Window", NewWindow),
            MenuItem::action("New Window Tab", NewWindowTab),
            MenuItem::action("New Chat", NewChat),
            MenuItem::action("New Athas Agent Session", NewAthasAgentSession),
            MenuItem::action("Session History", ShowSessionHistory),
            MenuItem::separator(),
            MenuItem::action("Open Folder…", OpenProject),
            MenuItem::action("Open Remote…", OpenRemote),
            MenuItem::action("Close Folder", CloseProject),
            MenuItem::separator(),
            MenuItem::action("Close Tab", CloseTab),
            MenuItem::action("Close All Tabs", CloseAllTabs),
            MenuItem::action("Reopen Closed Tab", ReopenClosedTab),
        ]),
        Menu::new("Edit").items([
            MenuItem::os_action("Cut", text_input::Cut, OsAction::Cut),
            MenuItem::os_action("Copy", text_input::Copy, OsAction::Copy),
            MenuItem::os_action("Paste", text_input::Paste, OsAction::Paste),
            MenuItem::separator(),
            MenuItem::os_action("Select All", text_input::SelectAll, OsAction::SelectAll),
        ]),
        Menu::new("View").items([
            MenuItem::action("Command Palette…", CommandPalette),
            MenuItem::separator(),
            MenuItem::action("Toggle Sidebar", ToggleSidebar),
            MenuItem::action("Toggle Terminal", ToggleTerminal),
            MenuItem::action("Toggle Session Details", ToggleDock),
            MenuItem::action("Toggle Maximized Pane", ToggleMaximize),
            MenuItem::action("Split Editor Right", SplitRight),
            MenuItem::action("Split Editor Down", SplitDown),
            MenuItem::separator(),
            MenuItem::action("Global Search", ShowGlobalSearch),
            MenuItem::action("Problems", ShowProblems),
            MenuItem::action("Outline", ShowOutline),
            MenuItem::separator(),
            MenuItem::action("Agents", ShowAgents),
            MenuItem::action("File Explorer", ShowFiles),
            MenuItem::action("Source Control", ShowSourceControl),
            MenuItem::action("GitHub", ShowGitHub),
            MenuItem::separator(),
            MenuItem::action("Color Theme…", SelectTheme),
            MenuItem::separator(),
            MenuItem::action("Enter Full Screen", ToggleFullscreen),
        ]),
        Menu::new("Go").items([
            MenuItem::action("Quick Open…", QuickOpen),
            MenuItem::separator(),
            MenuItem::action("Show Previous Tab", PreviousTab),
            MenuItem::action("Show Next Tab", NextTab),
        ]),
        Menu::new("Terminal").items([MenuItem::action("Toggle Terminal", ToggleTerminal)]),
        Menu::new("Run").items([
            MenuItem::action("Start Debugging", DebugStart),
            MenuItem::action("Stop Debugging", DebugStop),
            MenuItem::action("Restart Debugging", DebugRestart),
            MenuItem::action("Toggle Breakpoint", ToggleBreakpoint),
            MenuItem::separator(),
            MenuItem::action("Run and Debug", ShowDebugger),
            MenuItem::action("Run Script or Task…", ShowRunActions),
        ]),
        Menu::new("Tools").items([
            MenuItem::action("Docker…", OpenDocker),
            MenuItem::separator(),
            MenuItem::action("Preferences", OpenSettings),
        ]),
        Menu::new("Window").items([
            MenuItem::action("Minimize", MinimizeWindow),
            MenuItem::action("Zoom", ZoomWindow),
            MenuItem::separator(),
            MenuItem::action("Show Previous Window Tab", ShowPreviousWindowTab),
            MenuItem::action("Show Next Window Tab", ShowNextWindowTab),
            MenuItem::action("Move Tab to New Window", MoveTabToNewWindow),
            MenuItem::action("Merge All Windows", MergeAllWindows),
            MenuItem::separator(),
            MenuItem::action("Show All Tabs", ShowAllWindowTabs),
        ]),
        Menu::new("Help").items([
            MenuItem::action("Documentation", OpenDocs),
            MenuItem::action("Changelog", OpenChangelog),
            MenuItem::separator(),
            MenuItem::action("Send Feedback…", SendFeedback),
            MenuItem::action("Report a Bug…", ReportBug),
            MenuItem::action("Request a Feature…", RequestFeature),
        ]),
    ]
}

/// Sets the menu bar and the help actions, which open pages in the browser.
pub fn init(cx: &mut App) {
    cx.on_action(|_: &OpenDocs, cx| cx.open_url(DOCS_URL));
    cx.on_action(|_: &OpenChangelog, cx| cx.open_url(CHANGELOG_URL));
    cx.on_action(|_: &ReportBug, cx| cx.open_url(BUG_URL));
    cx.on_action(|_: &RequestFeature, cx| cx.open_url(FEATURE_URL));
    cx.set_menus(app_menus(cx));
    cx.set_dock_menu(vec![MenuItem::action("New Window", NewWindow)]);
}
