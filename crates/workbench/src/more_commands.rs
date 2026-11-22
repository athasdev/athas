//! Tab, editor group, navigation and help commands (`file-commands.tsx`, `pane-commands.tsx`,
//! `navigation-commands.tsx`), registered by their web workbench ids.

use gpui::{Context, Div, Focusable, Stateful, Window, actions, prelude::*};
use workspace::SidebarView;

use crate::{
    OpenDocker, ShowOutline, ToggleDock, ToggleTerminal, Workbench, MinimizeWindow, centre_views,
    navigation::JumpEntry,
};

actions!(
    workbench,
    [
        RevertFile,
        CloseOtherTabs,
        CloseSavedTabs,
        CloseTabsToLeft,
        CloseTabsToRight,
        NewFile,
        NewDocument,
        ToggleActivePaneFullscreen,
        CloseEditorGroup,
        CloseOtherEditorGroups,
        MoveEditorToNextGroup,
        MoveEditorToPreviousGroup,
        ResetEditorGroupSizes,
        ToggleEditorGroupLock,
        GoBack,
        GoForward,
        OpenOnboarding,
        ShowWhatsNew,
        ShowOutlinePreference,
        ShowOutlinePicker,
        ToggleNativeMenuBar,
    ]
);

pub(crate) fn register(cx: &mut gpui::App) {
    keymap::register(cx, "file.revert", RevertFile);
    keymap::register(cx, "file.closeOthers", CloseOtherTabs);
    keymap::register(cx, "file.closeSaved", CloseSavedTabs);
    keymap::register(cx, "file.closeTabsToLeft", CloseTabsToLeft);
    keymap::register(cx, "file.closeTabsToRight", CloseTabsToRight);
    keymap::register(cx, "file.new", NewFile);
    keymap::register(cx, "file.newDocument", NewDocument);
    keymap::register(cx, "workbench.toggleActivePaneFullscreen", ToggleActivePaneFullscreen);
    keymap::register(cx, "workbench.closeEditorGroup", CloseEditorGroup);
    keymap::register(cx, "workbench.closeOtherEditorGroups", CloseOtherEditorGroups);
    keymap::register(cx, "workbench.moveEditorToNextGroup", MoveEditorToNextGroup);
    keymap::register(cx, "workbench.moveEditorToPreviousGroup", MoveEditorToPreviousGroup);
    keymap::register(cx, "workbench.resetEditorGroupSizes", ResetEditorGroupSizes);
    keymap::register(cx, "workbench.toggleEditorGroupLock", ToggleEditorGroupLock);
    keymap::register(cx, "workbench.toggleDock", ToggleDock);
    keymap::register(cx, "workbench.toggleBottomPane", ToggleTerminal);
    keymap::register(cx, "workbench.showDocker", OpenDocker);
    keymap::register(cx, "view.showOutline", ShowOutlinePreference);
    keymap::register(cx, "editor.showOutline", ShowOutlinePicker);
    keymap::register(cx, "go.symbolInEditor", ShowOutlinePicker);
    keymap::register(cx, "window.minimize.alt", MinimizeWindow);
    keymap::register(cx, "navigation.goBack", GoBack);
    keymap::register(cx, "navigation.goForward", GoForward);
    keymap::register(cx, "help.openOnboarding", OpenOnboarding);
    keymap::register(cx, "help.showWhatsNew", ShowWhatsNew);
    keymap::register(cx, "window.toggleMenuBar", ToggleNativeMenuBar);
    #[cfg(target_family = "wasm")]
    keymap::register(cx, "view.toggleNativeMenuBar", ToggleNativeMenuBar);
    // The menu bar is the system's on macOS and Linux (`toggleNativeMenuBar` returns there); on
    // the web the setting picks the browser's own menu or the workbench's.
    cx.on_action(|_: &ToggleNativeMenuBar, cx| {
        if cfg!(target_family = "wasm") {
            settings::update(cx, |settings| settings.native_menu_bar = !settings.native_menu_bar);
        }
    });
    #[cfg(not(target_family = "wasm"))]
    {
        previews::init(cx);
        keymap::register(cx, "preview.shareLocalServer", previews::ShareLocalServer);
    }
}

/// Attaches the handlers to the workbench's root.
pub(crate) fn handlers(root: Stateful<Div>, cx: &mut Context<Workbench>) -> Stateful<Div> {
    root.on_action(cx.listener(|this, _: &RevertFile, _, cx| {
        if let Some(editor) = this.active_editor() {
            editor.update(cx, |editor, cx| editor.revert(cx));
        }
    }))
    .on_action(cx.listener(|this, _: &CloseOtherTabs, window, cx| {
        if let Some(index) = this.active_tab_index() {
            this.close_tabs_guarded(move |state| state.close_other_tabs(index), window, cx);
        }
    }))
    .on_action(cx.listener(|this, _: &CloseTabsToLeft, window, cx| {
        if let Some(index) = this.active_tab_index() {
            this.close_tabs_guarded(move |state| state.close_tabs_to_the_left(index), window, cx);
        }
    }))
    .on_action(cx.listener(|this, _: &CloseTabsToRight, window, cx| {
        if let Some(index) = this.active_tab_index() {
            this.close_tabs_guarded(move |state| state.close_tabs_to_the_right(index), window, cx);
        }
    }))
    .on_action(cx.listener(|this, _: &CloseSavedTabs, _, cx| {
        let dirty = this.dirty_tabs.clone();
        this.update_state(cx, |state| state.close_saved_tabs(|group, item| dirty.contains(&centre_views::view_key(group, item))));
    }))
    .on_action(cx.listener(|this, _: &NewFile, window, cx| this.new_file(window, cx)))
    .on_action(cx.listener(|this, _: &NewDocument, _, cx| {
        let path = editor::new_untitled_path().to_string_lossy().into_owned();
        this.update_state(cx, |state| state.open_file(&path));
    }))
    .on_action(cx.listener(|this, _: &ToggleActivePaneFullscreen, window, cx| this.toggle_active_pane_fullscreen(window, cx)))
    .on_action(cx.listener(|this, _: &CloseEditorGroup, _, cx| {
        this.update_state(cx, |state| {
            state.close_active_group();
        })
    }))
    .on_action(cx.listener(|this, _: &CloseOtherEditorGroups, _, cx| {
        this.update_state(cx, |state| {
            state.close_other_groups();
        })
    }))
    .on_action(cx.listener(|this, _: &MoveEditorToNextGroup, _, cx| {
        this.update_state(cx, |state| {
            state.move_active_tab_to_group(true);
        })
    }))
    .on_action(cx.listener(|this, _: &MoveEditorToPreviousGroup, _, cx| {
        this.update_state(cx, |state| {
            state.move_active_tab_to_group(false);
        })
    }))
    .on_action(cx.listener(|this, _: &ResetEditorGroupSizes, _, cx| this.update_state(cx, |state| state.reset_split_ratios())))
    .on_action(cx.listener(|this, _: &ToggleEditorGroupLock, _, cx| {
        let mut locked = None;
        this.update_state(cx, |state| locked = state.toggle_active_group_locked());
        if let Some(locked) = locked {
            notifications::info(cx, if locked { "Editor group locked" } else { "Editor group unlocked" });
        }
    }))
    .on_action(cx.listener(|this, _: &GoBack, _, cx| {
        let here = this.current_location(cx);
        if let Some(entry) = this.jump_list.go_back(here) {
            this.go_to_jump(entry, cx);
        }
    }))
    .on_action(cx.listener(|this, _: &GoForward, _, cx| {
        if let Some(entry) = this.jump_list.go_forward() {
            this.go_to_jump(entry, cx);
        }
    }))
    .on_action(cx.listener(|this, _: &OpenOnboarding, window, cx| this.reopen_onboarding(window, cx)))
    .on_action(cx.listener(|this, _: &ShowWhatsNew, _, cx| this.show_whats_new(cx)))
    .on_action(cx.listener(|this, _: &onboarding::ImportSettings, window, cx| {
        this.open_settings_with(Some("general"), |view, window, cx| view.open_importer(window, cx), window, cx);
    }))
    .map(|root| {
        #[cfg(not(target_family = "wasm"))]
        let root = root.on_action(cx.listener(|this, _: &previews::ShareLocalServer, window, cx| {
            let dialog = cx.new(|cx| previews::ShareLocalServerDialog::new(window, cx));
            this.open_modal(dialog, window, cx);
        }));
        root
    })
    .on_action(cx.listener(|this, _: &ShowOutlinePicker, window, cx| {
        let Some(editor) = this.active_editor() else { return };
        let delegate = outline_panel::OutlinePickerDelegate::new(editor, cx, |window, cx| window.dispatch_action(Box::new(crate::CommandPalette), cx));
        let picker = cx.new(|cx| {
            let mut picker = palette::Picker::new(delegate, window, cx);
            picker.delegate.load(cx);
            picker
        });
        this.open_modal(picker, window, cx);
    }))
    .on_action(cx.listener(|_, _: &ShowOutlinePreference, window, cx| {
        settings::update(cx, |settings| settings.show_outline = true);
        window.dispatch_action(Box::new(ShowOutline), cx);
    }))
}

impl Workbench {
    /// Cmd-Alt-arrows (`usePaneKeyboard`): the editor group that way takes the keys. Returns false
    /// when there is none, so the keys keep their other meaning (next/previous tab, a cursor
    /// above/below).
    pub(crate) fn focus_adjacent_group(&mut self, direction: workspace::Direction, window: &mut Window, cx: &mut Context<Self>) -> bool {
        let Some(panes) = self.state.focused_panes() else { return false };
        let Some(target) = panes.adjacent_group(panes.active, direction) else { return false };
        self.update_state(cx, |state| state.focus_group(target));
        let view = self.state.focused_panes().and_then(|panes| panes.group(target)).and_then(|group| group.tabs.active_item()).map(|item| centre_views::view_key(target, item));
        // A group with nothing to show keeps the keyboard where it is: moving it to the workbench
        // itself would leave every surface's shortcut unbound.
        if let Some(focus) = view.and_then(|key| self.centre_views.get(&key)).and_then(|view| view.focus.clone()) {
            window.focus(&focus, cx);
        }
        true
    }

    fn active_tab_index(&self) -> Option<usize> {
        self.state.focused_tabs().and_then(|tabs| tabs.active)
    }

    /// Where the caret is in the file in front, for the jump list.
    pub(crate) fn current_location(&self, cx: &gpui::App) -> Option<JumpEntry> {
        let editor = self.active_editor()?;
        let editor = editor.read(cx);
        let (line, column) = editor.cursor_position();
        Some(JumpEntry { path: editor.path().to_string_lossy().into_owned(), line, column })
    }

    fn go_to_jump(&mut self, entry: JumpEntry, cx: &mut Context<Self>) {
        let path = entry.path.clone();
        self.pending_lines.insert(path.clone(), (entry.line as u32, Some(entry.column as u32)));
        self.update_state(cx, |state| state.open_file(&path));
    }

    /// `file.new`: a new file's name field in the Files tool (a new terminal when one has focus).
    fn new_file(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if let Some((terminal, _)) = &self.terminal
            && terminal.focus_handle(cx).contains_focused(window, cx)
        {
            window.dispatch_action(Box::new(terminal_view::NewTerminal), cx);
            return;
        }
        if self.state.active_project().is_none() {
            return;
        }
        self.show_sidebar_view(SidebarView::Files, window, cx);
        if let Some((tree, _)) = &self.file_tree {
            let tree = tree.clone();
            window.focus(&tree.focus_handle(cx), cx);
            tree.update(cx, |tree, cx| tree.new_file(window, cx));
        }
    }

    /// The terminal's pane takes the whole workbench when it has focus; otherwise the editor group
    /// in front fills the centre on its own.
    fn toggle_active_pane_fullscreen(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let terminal_focused = self.terminal.as_ref().is_some_and(|(terminal, _)| terminal.focus_handle(cx).contains_focused(window, cx));
        if terminal_focused || self.bottom_full_screen {
            self.toggle_bottom_full_screen(cx);
            return;
        }
        let active = self.state.focused_panes().map(|panes| panes.active);
        self.fullscreen_group = if self.fullscreen_group.is_some() { None } else { active };
        self.centre_maximized = self.fullscreen_group.is_some();
        cx.notify();
    }

    pub(crate) fn toggle_bottom_full_screen(&mut self, cx: &mut Context<Self>) {
        self.bottom_full_screen = !self.bottom_full_screen && self.state.layout.bottom_pane_visible;
        if let Some((terminal, _)) = &self.terminal {
            let (shown, full) = (self.state.layout.bottom_pane_visible, self.bottom_full_screen);
            terminal.update(cx, |terminal, cx| terminal.set_presentation(shown, full, cx));
        }
        cx.notify();
    }

    /// `help.openOnboarding`: the welcome again, over the centre, as a preview that leaves the
    /// finished state alone (`openOnboardingPreview`), so quitting halfway does not bring the
    /// first-run welcome back on the next launch.
    fn reopen_onboarding(&mut self, _: &mut Window, cx: &mut Context<Self>) {
        self.onboarding = None;
        self.onboarding_reopened = true;
        self.ensure_onboarding(cx);
        cx.notify();
    }

    /// `help.showWhatsNew`: the running version's release notes in the welcome's pane.
    fn show_whats_new(&mut self, cx: &mut Context<Self>) {
        let view = cx.new(|cx| onboarding::OnboardingView::whats_new(env!("CARGO_PKG_VERSION"), cx));
        self.whats_new_unread = Some(false);
        self.onboarding = None;
        self.onboarding_reopened = true;
        self.attach_onboarding(view, cx);
        cx.notify();
    }

    pub(crate) fn ensure_onboarding(&mut self, cx: &mut Context<Self>) {
        if self.onboarding.is_some() {
            return;
        }
        let view = cx.new(onboarding::OnboardingView::new);
        self.attach_onboarding(view, cx);
    }

    fn attach_onboarding(&mut self, view: gpui::Entity<onboarding::OnboardingView>, cx: &mut Context<Self>) {
        let subscription = cx.subscribe(&view, |this, _, event: &onboarding::OnboardingEvent, cx| match event {
            onboarding::OnboardingEvent::Finished { open_folder } => {
                this.onboarding = None;
                this.onboarding_reopened = false;
                if *open_folder {
                    this.prompt_open_project(cx);
                }
                cx.notify();
            }
        });
        self.onboarding = Some((view, subscription));
    }
}
