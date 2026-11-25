//! The app menus for Windows and Linux, which have no menu bar of Athas's own
//! (`window-menu-bar.tsx`): one button in the title row whose menu lists File, Edit, View and the
//! rest, each opening its items beside it. Items whose command this build does not register are left out.

use ui::scale::px;
use gpui::{Action, AnyElement, Anchor, App, Context, FocusHandle, Window, div, img, prelude::*,};
use ui::{Button, ButtonSize, MenuEntry, MenuItem, Plane, metrics};

use crate::*;

pub(crate) const WINDOW_MENU: &str = "window-menu";

/// One menu item: an Athas command when this build has it, otherwise the action given.
enum Run {
    Command(&'static str),
    Action(Box<dyn Action>),
}

struct Item {
    label: &'static str,
    run: Run,
    shortcut: Option<&'static str>,
}

fn command(label: &'static str, id: &'static str, shortcut: Option<&'static str>) -> Option<Item> {
    Some(Item { label, run: Run::Command(id), shortcut })
}

fn action(label: &'static str, action: impl Action, shortcut: Option<&'static str>) -> Option<Item> {
    Some(Item { label, run: Run::Action(Box::new(action)), shortcut })
}

/// `None` stands for a separator.
fn menus() -> Vec<(&'static str, ui::IconName, Vec<Option<Item>>)> {
    use ui::IconName;
    vec![
        (
            "File",
            IconName::File,
            vec![
                command("New Tab", "workbench.newTab", Some("mod+n")),
                command("New Window", "workbench.newWindow", Some("mod+shift+n")),
                command("New File", "file.new", None),
                command("Open Folder", "file.openFolder", Some("mod+o")),
                command("Close Folder", "project.close", None),
                None,
                action("Save", editor::Save, Some("mod+s")),
                action("Save As...", editor::SaveAs, Some("mod+shift+s")),
                command("Save All", "file.saveAll", Some("mod+alt+s")),
                command("Revert File", "file.revert", None),
                command("Show Local History", "file.localHistory", None),
                None,
                command("Close Tab", "file.close", Some("mod+w")),
                action("Close Window", CloseWindow, Some("mod+shift+w")),
                command("Close All Tabs", "file.closeAll", None),
                command("Close Other Tabs", "file.closeOthers", None),
                command("Close Saved Tabs", "file.closeSaved", None),
                command("Close Tabs to the Left", "file.closeTabsToLeft", None),
                command("Close Tabs to the Right", "file.closeTabsToRight", None),
                command("Reopen Closed Tab", "file.reopenClosed", Some("mod+shift+t")),
                None,
                action("Quit", Quit, Some("mod+q")),
            ],
        ),
        (
            "Edit",
            IconName::Pencil,
            vec![
                action("Undo", editor::Undo, Some("mod+z")),
                action("Redo", editor::Redo, Some("mod+shift+z")),
                None,
                action("Cut", editor::Cut, Some("mod+x")),
                action("Copy", editor::Copy, Some("mod+c")),
                action("Paste", editor::Paste, Some("mod+v")),
                action("Select All", editor::SelectAll, Some("mod+a")),
                None,
                action("Find", editor::Find, Some("mod+f")),
                action("Find and Replace", editor::FindReplace, Some("mod+alt+f")),
                action("Toggle Comment", editor::ToggleComment, Some("mod+/")),
                action("Quick Fix", editor::CodeActions, Some("mod+.")),
                action("Trigger Parameter Hints", editor::ShowSignatureHelp, Some("mod+shift+space")),
                action("Show Hover", editor::ShowHover, Some("mod+k mod+i")),
                None,
                action("Duplicate Line", editor::CopyLineDown, Some("mod+d")),
                action("Delete Line", editor::DeleteLine, Some("mod+shift+k")),
                action("Move Line Up", editor::MoveLineUp, Some("alt+up")),
                action("Move Line Down", editor::MoveLineDown, Some("alt+down")),
                action("Format Document", editor::FormatDocument, Some("shift+alt+f")),
                command("Format Selection", "editor.formatSelection", Some("mod+k mod+f")),
                None,
                command("Command Palette", "workbench.commandPalette", Some("mod+shift+p")),
            ],
        ),
        (
            "View",
            IconName::Eye,
            vec![
                command("Toggle Sidebar", "workbench.toggleSidebar", Some("mod+b")),
                command("Toggle Terminal", "workbench.toggleTerminal", Some("mod+j")),
                None,
                command("Global Search", "workbench.showGlobalSearch", Some("mod+shift+f")),
                command("Diagnostics", "workbench.toggleDiagnostics", Some("mod+shift+j")),
                None,
                command("File Explorer", "workbench.showFileExplorer", Some("mod+shift+e")),
                command("Source Control", "workbench.showSourceControl", Some("mod+shift+g")),
                command("GitHub", "workbench.showGitHub", None),
                command("Run and Debug", "workbench.showDebugger", None),
                None,
                command("Split Editor", "workbench.splitEditorRight", None),
                command("Toggle Minimap", "workbench.toggleMinimap", None),
                action("Toggle Word Wrap", editor::ToggleWordWrap, Some("alt+z")),
                command("Toggle Line Numbers", "editor.toggleLineNumbers", None),
                command("Toggle Render Whitespace", "editor.toggleRenderWhitespace", None),
                None,
                command("Zoom In", "workbench.zoomIn", Some("mod+=")),
                command("Zoom Out", "workbench.zoomOut", Some("mod+-")),
                command("Reset Zoom", "workbench.zoomReset", Some("mod+0")),
                None,
                command("Theme…", "preferences.colorTheme", None),
            ],
        ),
        (
            "Go",
            IconName::ArrowRight,
            vec![
                command("Quick Open", "file.quickOpen", Some("mod+p")),
                None,
                command("Go Back", "navigation.goBack", Some("ctrl+-")),
                command("Go Forward", "navigation.goForward", Some("ctrl+shift+-")),
                None,
                action("Go to Definition", editor::GoToDefinition, Some("f12")),
                action("Go to Implementation", editor::GoToImplementation, Some("mod+f12")),
                action("Go to Type Definition", editor::GoToTypeDefinition, None),
                action("Go to References", editor::FindReferences, Some("shift+f12")),
                action("Rename Symbol", editor::Rename, Some("f2")),
                None,
                command("Next Tab", "workbench.nextTab", Some("mod+alt+right")),
                command("Previous Tab", "workbench.previousTab", Some("mod+alt+left")),
            ],
        ),
        (
            "Terminal",
            IconName::TerminalWindow,
            vec![
                command("New Terminal", "terminal.new", None),
                command("Split Terminal Right", "terminal.split", Some("mod+d")),
                command("Split Terminal Down", "terminal.splitDown", Some("mod+shift+d")),
                command("Close Terminal", "terminal.close", None),
            ],
        ),
        (
            "Run",
            IconName::Play,
            vec![
                command("Start Debugging", "debug.start", Some("f5")),
                command("Stop Debugging", "debug.stop", Some("shift+f5")),
                command("Toggle Breakpoint", "debug.toggleBreakpoint", Some("f9")),
            ],
        ),
        (
            "Agent",
            IconName::Sparkle,
            vec![
                command("New Agent", "workbench.agentLauncher", Some("mod+alt+n")),
                command("Inline Edit", "editor.inlineEdit", Some("mod+i")),
            ],
        ),
        (
            "Tools",
            IconName::Wrench,
            vec![
                None,
                command("Preferences", "workbench.openSettings", None),
                command("Integrations", "view.showIntegrations", None),
                command("Keyboard Shortcuts", "workbench.openKeyboardShortcuts", None),
            ],
        ),
        (
            "Window",
            IconName::WindowExpand,
            vec![
                command("Minimize", "window.minimize", Some("alt+f9")),
                command("Maximize", "window.maximize", Some("alt+f10")),
                None,
                command("Toggle Menu Bar", "view.toggleCompactMenuBar", Some("alt+m")),
                None,
                command("Toggle Fullscreen", "window.toggleFullscreen", Some("f11")),
            ],
        ),
        (
            "Help",
            IconName::Question,
            vec![
                command("Documentation", "help.documentation", None),
                command("Keyboard Shortcuts", "workbench.openKeyboardShortcuts", None),
                command("What's New", "help.showWhatsNew", None),
                command("Changelog", "help.changelog", None),
                None,
                command("Report a Bug", "help.reportBug", None),
                action("Request a Feature", RequestFeature, None),
                None,
                command("Check for Updates", "app.checkForUpdates", None),
            ],
        ),
    ]
}

/// The menus' entries. Each item gives the keyboard back to what had it before it runs, so editor
/// commands reach the editor.
pub(crate) fn window_menu_entries(previous_focus: Option<FocusHandle>, cx: &App) -> Vec<MenuEntry> {
    menu_entries(previous_focus, cx)
        .into_iter()
        .map(|(name, icon, entries)| MenuItem::new(name).icon(icon).submenu(entries).into())
        .collect()
}

/// Each menu's name, icon and items.
fn menu_entries(previous_focus: Option<FocusHandle>, cx: &App) -> Vec<(&'static str, ui::IconName, Vec<MenuEntry>)> {
    let registry = cx.try_global::<keymap::CommandRegistry>();
    let shortcuts = cx.try_global::<keymap::ActiveKeymap>().map(|active| keymap::shortcuts_by_command(&active.bindings)).unwrap_or_default();
    menus()
        .into_iter()
        .map(|(name, icon, items)| {
            let mut entries: Vec<MenuEntry> = Vec::new();
            for item in items {
                let Some(item) = item else {
                    if entries.last().is_some_and(|last| !matches!(last, MenuEntry::Separator)) {
                        entries.push(MenuEntry::Separator);
                    }
                    continue;
                };
                let (action, shortcut) = match item.run {
                    Run::Command(id) => {
                        let Some(action) = registry.and_then(|registry| registry.action(id)) else { continue };
                        (action, shortcuts.get(id).cloned().or(item.shortcut.map(str::to_string)))
                    }
                    Run::Action(action) => (action, item.shortcut.map(str::to_string)),
                };
                let focus = previous_focus.clone();
                let mut menu_item = MenuItem::new(item.label).on_select(move |window, cx| {
                    if let Some(focus) = &focus {
                        window.focus(focus, cx);
                    }
                    window.dispatch_action(action.boxed_clone(), cx);
                });
                if let Some(shortcut) = shortcut {
                    menu_item = menu_item.shortcut(keymap::display_key(&shortcut));
                }
                entries.push(menu_item.into());
            }
            if matches!(entries.last(), Some(MenuEntry::Separator)) {
                entries.pop();
            }
            (name, icon, entries)
        })
        .collect()
}

impl Workbench {
    /// Opens the app menu from the title row's button, with `open` (File, Edit, …) showing.
    pub fn show_window_menu(&mut self, open: Option<usize>, window: &mut Window, cx: &mut Context<Self>) {
        let entries = window_menu_entries(window.focused(cx).filter(|focus| *focus != self.focus_handle), cx);
        // Under the title row's first button, which starts clear of the window buttons.
        let position = gpui::point(metrics::traffic_lights_inset(), metrics::workbench_gap() + metrics::pane_header() - px(4.));
        self.show_menu(WINDOW_MENU, entries, position, Anchor::TopLeft, window, cx);
        if let Some(menu) = self.open_menu.as_ref().map(|menu| menu.menu.clone()) {
            menu.update(cx, |menu, cx| menu.highlight(open, open.is_some(), window, cx));
        }
    }

    /// The menu button at the start of the title row on Windows and Linux; with
    /// `compactMenuBar` off, each menu's name in a row instead.
    pub(crate) fn render_window_menu_button(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        if matches!(self.platform, Platform::Mac) {
            return None;
        }
        let compact = cx.try_global::<settings::SettingsStore>().is_none_or(|_| settings::get(cx).compact_menu_bar);
        if !compact {
            let names: Vec<&'static str> = menus().into_iter().map(|(name, _, _)| name).collect();
            return Some(
                div()
                    .flex()
                    .flex_none()
                    .items_center()
                    .gap(px(2.))
                    .children(names.into_iter().enumerate().map(|(index, name)| {
                        let key = menu_key(index);
                        Button::new(gpui::ElementId::Name(format!("window-menu-{name}").into()), name)
                            .variant(ui::ButtonVariant::Ghost)
                            .size(ButtonSize::Medium)
                            .plane(Plane::Page)
                            .active(self.menu_is_open(key))
                            .on_click(cx.listener(move |this, event: &gpui::ClickEvent, window, cx| {
                                let focus = window.focused(cx).filter(|focus| *focus != this.focus_handle);
                                let Some((_, _, entries)) = menu_entries(focus, cx).into_iter().nth(index) else { return };
                                let position = gpui::point(event.position().x - px(12.), metrics::workbench_gap() + metrics::pane_header() - px(4.));
                                this.show_menu(key, entries, position, Anchor::TopLeft, window, cx);
                            }))
                    }))
                    .into_any_element(),
            );
        }
        let open = self.menu_is_open(WINDOW_MENU);
        Some(
            div().flex().flex_none().ml(px(-2.)).child(
                Button::new("window-menu", "")
                    .variant(ui::ButtonVariant::Ghost)
                    .size(ButtonSize::Large)
                    .plane(Plane::Page)
                    .leading(img("icons/athas_mark.png").size(px(16.)).flex_none())
                    .icon_only()
                    .active(open)
                    .tooltip("Menu")
                    .on_click(cx.listener(|this, event: &gpui::ClickEvent, window, cx| {
                        let entries = window_menu_entries(window.focused(cx).filter(|focus| *focus != this.focus_handle), cx);
                        let position = event.position();
                        let position = gpui::point(position.x - px(12.), metrics::workbench_gap() + metrics::pane_header() - px(4.));
                        this.show_menu(WINDOW_MENU, entries, position, Anchor::TopLeft, window, cx);
                    })),
            )
            .into_any_element(),
        )
    }
}

/// The open-menu key of one menu of the full menu bar.
fn menu_key(index: usize) -> &'static str {
    const KEYS: [&str; 12] = [
        "window-menu-0", "window-menu-1", "window-menu-2", "window-menu-3", "window-menu-4", "window-menu-5",
        "window-menu-6", "window-menu-7", "window-menu-8", "window-menu-9", "window-menu-10", "window-menu-11",
    ];
    KEYS.get(index).copied().unwrap_or(WINDOW_MENU)
}
