//! Vim mode (`features/vim` in Athas): the engine in [`engine`] runs the keys; this part routes
//! keys and typing to it, carries out what it asks (save, close, folds, the command line), and
//! draws the mode indicator.

mod engine;

use ui::scale::px;
use gpui::{
    App, AppContext as _, ClipboardItem, Context, Entity, Focusable as _, IntoElement, KeyBinding, ParentElement as _, RenderOnce, Styled as _, Subscription, Window,
    actions, div, prelude::FluentBuilder as _,
};
use theme::ActiveTheme;
use ui::{InputAppearance, TextInput, TextInputEvent, typography};

pub use engine::VimMode;
use engine::{Effect, FoldCommand, Key, Vim, VimContext};

use crate::{Autoscroll, Editor, EditorEvent, Status, demo, selection::Selection};

actions!(vim, [VimEscape, VimEnter, VimBackspace, VimDelete, VimRedo, VimHalfPageDown, VimHalfPageUp, VimVisualBlock]);

/// Vim's keys that are not typed text. Bound after the editor's, so they win in vim's contexts.
pub(crate) fn bind_keys(cx: &mut App) {
    let normal = Some("Editor && vim_normal");
    let insert = Some("Editor && vim_insert");
    cx.bind_keys([
        KeyBinding::new("escape", VimEscape, normal),
        KeyBinding::new("enter", VimEnter, normal),
        KeyBinding::new("shift-enter", VimEnter, normal),
        KeyBinding::new("backspace", VimBackspace, normal),
        KeyBinding::new("delete", VimDelete, normal),
        KeyBinding::new("ctrl-r", VimRedo, normal),
        KeyBinding::new("ctrl-d", VimHalfPageDown, normal),
        KeyBinding::new("ctrl-u", VimHalfPageUp, normal),
        KeyBinding::new("ctrl-v", VimVisualBlock, normal),
        KeyBinding::new("escape", VimEscape, insert),
        KeyBinding::new("ctrl-[", VimEscape, insert),
        KeyBinding::new("ctrl-c", VimEscape, insert),
    ]);
}

#[derive(Default)]
pub(crate) struct VimState {
    pub enabled: bool,
    pub vim: Vim,
    /// The open command line (`:`, `/` or `?`).
    prompt: Option<(char, Entity<TextInput>, Subscription)>,
    /// The last command's message ("Pattern not found"), until the next key.
    message: Option<String>,
}

impl Editor {
    pub(crate) fn set_vim_enabled(&mut self, enabled: bool, cx: &mut Context<Self>) {
        if self.vim.enabled == enabled {
            return;
        }
        self.vim.enabled = enabled;
        self.vim.prompt = None;
        self.vim.vim.reset(&mut self.document);
        cx.emit(EditorEvent::VimModeChanged(self.vim_mode()));
        cx.notify();
    }

    /// The vim mode, when vim mode is on.
    pub fn vim_mode(&self) -> Option<VimMode> {
        self.vim.enabled.then_some(self.vim.vim.mode)
    }

    /// The keys of an unfinished vim command (`2d`), for a status bar.
    pub fn vim_pending_keys(&self) -> String {
        if self.vim.enabled { self.vim.vim.pending_keys() } else { String::new() }
    }

    /// Typed text goes to vim in every mode but insert. Returns whether vim took it.
    pub(crate) fn vim_typed(&mut self, text: &str, window: &mut Window, cx: &mut Context<Self>) -> bool {
        if !self.vim.enabled || self.status != Status::Ready {
            return false;
        }
        if self.vim.vim.mode == VimMode::Insert {
            self.vim.vim.record_typed(text);
            return false;
        }
        for ch in text.chars() {
            self.vim_key(Key::Char(ch), window, cx);
        }
        true
    }

    /// Records a key typed in insert mode that is an editor action (enter, backspace).
    pub(crate) fn vim_record_insert_key(&mut self, enter: bool) {
        if self.vim.enabled && self.vim.vim.mode == VimMode::Insert {
            self.vim.vim.record_key(if enter { Key::Enter } else { Key::Backspace });
        }
    }

    fn vim_key(&mut self, key: Key, window: &mut Window, cx: &mut Context<Self>) {
        let mode = self.vim.vim.mode;
        self.vim.message = None;
        let context = VimContext {
            hidden: self.folds.hidden(),
            clipboard: cx.read_from_clipboard().and_then(|item| item.text()),
            page_rows: self.layout.as_ref().map(|layout| layout.viewport_rows).unwrap_or(20),
        };
        self.vim.vim.sync(&mut self.document);
        let version = self.document.buffer.version();
        let head = self.document.newest_selection().head;
        let effects = self.vim.vim.handle(key, &mut self.document, &context);
        self.after_vim(version, head, cx);
        self.run_vim_effects(effects, window, cx);
        if self.vim.vim.mode != mode {
            cx.emit(EditorEvent::VimModeChanged(self.vim_mode()));
        }
    }

    fn after_vim(&mut self, version: usize, head: usize, cx: &mut Context<Self>) {
        let edited = self.document.buffer.version() != version;
        if edited {
            self.buffer_changed(cx);
        }
        self.settle_carets_in_folds(head, edited);
        self.autoscroll = Some(Autoscroll::Fit);
        self.pause_blink(cx);
        cx.notify();
    }

    fn run_vim_effects(&mut self, effects: Vec<Effect>, window: &mut Window, cx: &mut Context<Self>) {
        for effect in effects {
            match effect {
                Effect::Save => self.save_if_dirty(cx),
                Effect::Close { force } => cx.emit(EditorEvent::CloseRequested { force }),
                Effect::SaveAndClose => {
                    self.save_if_dirty(cx);
                    cx.emit(EditorEvent::CloseRequested { force: false });
                }
                Effect::Prompt(kind) => self.open_vim_prompt(kind, window, cx),
                Effect::Clipboard(text) => cx.write_to_clipboard(ClipboardItem::new_string(text)),
                Effect::Fold(command) => {
                    let line = self.document.buffer.line_of(self.document.newest_selection().head);
                    match command {
                        FoldCommand::Close => self.fold_line(line, cx),
                        FoldCommand::Open => self.unfold_line(line, cx),
                        FoldCommand::Toggle => self.toggle_fold(&crate::ToggleFold, window, cx),
                        FoldCommand::CloseAll => self.fold_all(cx),
                        FoldCommand::OpenAll => self.unfold_all(cx),
                    }
                }
                Effect::Message(message) => self.vim.message = Some(message),
                Effect::Command(id) => {
                    if let Some(action) = cx.try_global::<keymap::CommandRegistry>().and_then(|registry| registry.action(id)) {
                        window.dispatch_action(action, cx);
                    }
                }
            }
        }
    }

    fn open_vim_prompt(&mut self, kind: char, window: &mut Window, cx: &mut Context<Self>) {
        let input = cx.new(|cx| TextInput::new(window, cx).appearance(InputAppearance::Bare));
        let subscription = cx.subscribe_in(&input, window, move |editor, input, event: &TextInputEvent, window, cx| match event {
            TextInputEvent::Confirmed => {
                let text = input.read(cx).text().to_string();
                editor.vim.prompt = None;
                window.focus(&editor.focus_handle, cx);
                let mode = editor.vim.vim.mode;
                let version = editor.document.buffer.version();
                let head = editor.document.newest_selection().head;
                let effects = if kind == ':' { editor.vim.vim.ex(&text, &mut editor.document) } else { editor.vim.vim.search(&text, kind == '/', &mut editor.document) };
                editor.after_vim(version, head, cx);
                editor.autoscroll = Some(Autoscroll::Center);
                editor.run_vim_effects(effects, window, cx);
                if editor.vim.vim.mode != mode {
                    cx.emit(EditorEvent::VimModeChanged(editor.vim_mode()));
                }
                cx.notify();
            }
            TextInputEvent::Cancelled | TextInputEvent::Blurred => {
                editor.vim.prompt = None;
                if matches!(event, TextInputEvent::Cancelled) {
                    window.focus(&editor.focus_handle, cx);
                }
                cx.notify();
            }
            _ => {}
        });
        let handle = input.read(cx).focus_handle(cx);
        window.focus(&handle, cx);
        self.vim.prompt = Some((kind, input, subscription));
        cx.notify();
    }

    /// The command line, or the last message, along the bottom of the editor.
    pub(crate) fn render_vim_bar(&self, cx: &Context<Self>) -> Option<impl IntoElement + use<>> {
        if !self.vim.enabled {
            return None;
        }
        let colors = &cx.theme().colors;
        let content = match (&self.vim.prompt, &self.vim.message) {
            (Some((kind, input, _)), _) => div()
                .flex()
                .items_center()
                .gap(px(2.))
                .flex_1()
                .child(div().text_color(colors.muted_foreground).child(kind.to_string()))
                .child(div().flex_1().child(input.clone())),
            (None, Some(message)) => div().flex_1().truncate().text_color(colors.muted_foreground).child(message.clone()),
            (None, None) => return None,
        };
        Some(
            div()
                .flex()
                .flex_none()
                .items_center()
                .h(px(28.))
                .px(px(12.))
                .border_t_1()
                .border_color(colors.border)
                .bg(colors.background)
                .font_family(settings::get(cx).font_family.clone())
                .text_size(typography::text_sm())
                .child(content),
        )
    }

    /// Key contexts for vim's bindings.
    pub(crate) fn vim_key_context(&self, context: &mut gpui::KeyContext) {
        if !self.vim.enabled {
            return;
        }
        context.add("vim");
        match self.vim.vim.mode {
            VimMode::Insert | VimMode::Replace => context.add("vim_insert"),
            VimMode::Visual | VimMode::VisualLine | VimMode::VisualBlock => {
                context.add("vim_normal");
                context.add("vim_visual");
            }
            VimMode::Normal => context.add("vim_normal"),
        }
    }

    /// The matches of vim's last search in `visible`, while they are highlighted.
    pub(crate) fn vim_search_matches(&self, visible: std::ops::Range<usize>) -> Vec<std::ops::Range<usize>> {
        let Some(regex) = self.vim.enabled.then(|| self.vim.vim.search_highlight()).flatten() else { return Vec::new() };
        let text = self.document.buffer.slice(visible.clone());
        regex.find_iter(&text).filter(|found| !found.is_empty()).map(|found| visible.start + found.start()..visible.start + found.end()).collect()
    }

    pub(crate) fn vim_relative_numbers(&self, cx: &App) -> Option<bool> {
        if !self.vim.enabled {
            return None;
        }
        Some(self.vim.vim.relative_numbers.unwrap_or(settings::get(cx).vim_relative_line_numbers || demo("vim")))
    }

    /// Normal and visual mode draw a block; replace mode and a pending operator an underline.
    pub(crate) fn vim_cursor_style(&self) -> Option<&'static str> {
        if !self.vim.enabled {
            return None;
        }
        match self.vim.vim.mode {
            VimMode::Insert => None,
            VimMode::Replace => Some("underline"),
            _ if !self.vim.vim.pending_keys().is_empty() => Some("underline"),
            _ => Some("block"),
        }
    }

    /// Where the caret of `selection` is drawn: in visual mode, on the character vim is on.
    pub(crate) fn caret_head(&self, selection: &Selection) -> usize {
        if self.vim.enabled
            && let Some(head) = self.vim.vim.visual_head()
            && selection.id == self.document.newest_selection().id
        {
            return head.min(self.document.buffer.len());
        }
        selection.head
    }

    pub(crate) fn vim_escape(&mut self, _: &VimEscape, window: &mut Window, cx: &mut Context<Self>) {
        if self.dismiss_lsp_popovers(cx) {
            return;
        }
        if self.vim.vim.mode == VimMode::Normal && self.find_open && self.vim.vim.pending_keys().is_empty() {
            self.close_find(window, cx);
        }
        self.vim_key(Key::Escape, window, cx);
    }

    pub(crate) fn vim_enter(&mut self, _: &VimEnter, window: &mut Window, cx: &mut Context<Self>) {
        self.vim_key(Key::Enter, window, cx);
    }

    pub(crate) fn vim_backspace(&mut self, _: &VimBackspace, window: &mut Window, cx: &mut Context<Self>) {
        self.vim_key(Key::Backspace, window, cx);
    }

    pub(crate) fn vim_delete(&mut self, _: &VimDelete, window: &mut Window, cx: &mut Context<Self>) {
        self.vim_key(Key::Char('x'), window, cx);
    }

    pub(crate) fn vim_redo(&mut self, _: &VimRedo, window: &mut Window, cx: &mut Context<Self>) {
        self.vim_key(Key::Ctrl('r'), window, cx);
    }

    pub(crate) fn vim_visual_block(&mut self, _: &VimVisualBlock, window: &mut Window, cx: &mut Context<Self>) {
        self.vim_key(Key::Ctrl('v'), window, cx);
    }

    pub(crate) fn vim_half_page(&mut self, down: bool, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(layout) = &self.layout {
            let rows = (layout.viewport_rows / 2) as f32;
            let delta = layout.line_height * if down { rows } else { -rows };
            self.scroll.y = (self.scroll.y + delta).max(px(0.));
        }
        self.vim_key(Key::Ctrl(if down { 'd' } else { 'u' }), window, cx);
    }
}

/// The vim mode for a status bar: `Normal`, `Insert`, `Visual`... with the keys of an
/// unfinished command. Draws nothing while vim mode is off.
#[derive(IntoElement)]
pub struct VimModeIndicator {
    editor: Entity<Editor>,
}

impl VimModeIndicator {
    pub fn new(editor: Entity<Editor>) -> Self {
        Self { editor }
    }
}

impl RenderOnce for VimModeIndicator {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let editor = self.editor.read(cx);
        let Some(mode) = editor.vim_mode() else { return div() };
        let pending = editor.vim_pending_keys();
        let recording = editor.vim.vim.recording_macro();
        let colors = &cx.theme().colors;
        div()
            .flex()
            .items_center()
            .gap(px(6.))
            .h(px(24.))
            .px(px(6.))
            .font_family(typography::ui_font())
            .text_size(typography::text_caption())
            .text_color(colors.subtle_foreground)
            .child(mode.label())
            .when_some(recording, |this, name| this.child(div().text_color(colors.muted_foreground).child(format!("recording @{name}"))))
            .when(!pending.is_empty(), |this| this.child(div().text_color(colors.muted_foreground).child(pending)))
    }
}
