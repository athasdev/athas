//! The Help menu's keyboard shortcuts reference: the shortcuts people reach for most, read from
//! the active keymap so remapped keys show as they are bound.

use gpui::{App, Context, DismissEvent, EventEmitter, FocusHandle, Focusable, Window, div, prelude::*, px};
use theme::ActiveTheme;
use ui::{Button, Dialog, DialogSize, IconName, Kbd, typography};

const SECTIONS: &[(&str, &[(&str, &str)])] = &[
    (
        "General",
        &[
            ("Command Palette", "workbench.commandPalette"),
            ("Quick Open", "file.quickOpen"),
            ("Search in Project", "workbench.showGlobalSearch"),
            ("Settings", "workbench.openSettings"),
            ("Keyboard Shortcuts", "workbench.openKeyboardShortcuts"),
            ("Toggle Sidebar", "workbench.toggleSidebar"),
            ("Toggle Terminal", "workbench.toggleTerminal"),
            ("Toggle Full Screen Pane", "workbench.toggleActivePaneFullscreen"),
        ],
    ),
    (
        "Tabs and Files",
        &[
            ("New Tab", "workbench.newTab"),
            ("Close Tab", "file.close"),
            ("Reopen Closed Tab", "file.reopenClosed"),
            ("Next Tab", "workbench.nextTab"),
            ("Previous Tab", "workbench.previousTab"),
            ("Save", "file.save"),
            ("Open Folder", "file.openFolder"),
        ],
    ),
    (
        "Editing",
        &[
            ("Find", "workbench.showFind"),
            ("Toggle Comment", "editor.toggleComment"),
            ("Select Next Occurrence", "editor.selectNextOccurrence"),
            ("Move Line Up", "editor.moveLineUp"),
            ("Move Line Down", "editor.moveLineDown"),
            ("Delete Line", "editor.deleteLine"),
            ("Go to Definition", "editor.goToDefinition"),
            ("Quick Fix", "editor.quickFix"),
            ("Format Document", "editor.formatDocument"),
            ("Add Selection to Chat", "editor.addSelectionToChat"),
        ],
    ),
    (
        "Terminal",
        &[
            ("New Terminal", "terminal.new"),
            ("Split Terminal", "terminal.split"),
            ("Find in Terminal", "terminal.find"),
            ("Clear Terminal", "terminal.clear"),
        ],
    ),
];

fn shortcut(command: &str, cx: &App) -> Option<String> {
    let active = cx.try_global::<keymap::ActiveKeymap>()?;
    let binding = active.bindings.iter().find(|binding| binding.command == command && binding.enabled != Some(false) && !binding.key.is_empty())?;
    Some(keymap::display_key(&binding.key))
}

pub(crate) struct ShortcutsDialog {
    focus_handle: FocusHandle,
}

impl ShortcutsDialog {
    pub(crate) fn new(cx: &mut Context<Self>) -> Self {
        Self { focus_handle: cx.focus_handle() }
    }
}

impl EventEmitter<DismissEvent> for ShortcutsDialog {}

impl Focusable for ShortcutsDialog {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl Render for ShortcutsDialog {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let weak = cx.entity().downgrade();
        let sections = SECTIONS.iter().map(|(title, rows)| {
            div()
                .flex()
                .flex_col()
                .gap(px(2.))
                .child(div().pb(px(4.)).text_size(typography::TEXT_CAPTION).font_weight(typography::MEDIUM).text_color(colors.subtle_foreground).child(*title))
                .children(rows.iter().filter_map(|(label, command)| {
                    let keys = shortcut(command, cx)?;
                    Some(
                        div()
                            .flex()
                            .items_center()
                            .justify_between()
                            .gap(px(12.))
                            .h(px(26.))
                            .text_size(typography::TEXT_SM)
                            .text_color(colors.foreground)
                            .child(*label)
                            .child(Kbd::new(keys)),
                    )
                }))
        });
        div()
            .on_key_down(cx.listener(|_, event: &gpui::KeyDownEvent, _, cx| {
                if event.keystroke.key == "escape" {
                    cx.emit(DismissEvent);
                }
            }))
            .child(
                Dialog::new("keyboard-shortcuts", "Keyboard Shortcuts")
                    .icon(IconName::Keyboard)
                    .size(DialogSize::Md)
                    .scrollable(true)
                    .track_focus(&self.focus_handle)
                    .on_close(move |_, cx| {
                        weak.update(cx, |_, cx| cx.emit(DismissEvent)).ok();
                    })
                    .footer([Button::new("shortcuts-customize", "Customize…")
                        .on_click(cx.listener(|_, _, window, cx| {
                            cx.emit(DismissEvent);
                            if let Some(action) = cx.try_global::<keymap::CommandRegistry>().and_then(|registry| registry.action("workbench.openKeyboardShortcuts")) {
                                window.dispatch_action(action, cx);
                            }
                        }))
                        .into_any_element()])
                    .child(div().flex().flex_col().gap(px(16.)).children(sections)),
            )
    }
}
