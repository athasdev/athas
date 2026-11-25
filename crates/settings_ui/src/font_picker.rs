//! The font family picker (`components/font-selector.tsx`): the system's fonts, each name in the
//! UI font with a short sample in its own face beside it, a search field and, for the editor and
//! terminal, only monospaced families.

use std::ops::Range;

use ui::scale::px;
use gpui::{
    App, Context, DismissEvent, Entity, EventEmitter, FocusHandle, Focusable, Global, KeyDownEvent,
    MouseButton, ScrollStrategy, SharedString, Subscription, UniformListScrollHandle, Window, div,
    prelude::*, uniform_list,
};
use theme::ActiveTheme;
use ui::{Icon, IconName, IconSize, InputAppearance, Switch, TextInput, TextInputEvent, metrics, typography};

/// The system's font families, read once.
struct FontCatalog(Vec<SharedString>);

impl Global for FontCatalog {}

/// Every font family the text system knows, including the ones Athas bundles.
pub fn font_families(cx: &mut App) -> Vec<SharedString> {
    if let Some(catalog) = cx.try_global::<FontCatalog>() {
        return catalog.0.clone();
    }
    let families: Vec<SharedString> = cx
        .text_system()
        .all_font_names()
        .into_iter()
        // Hidden system faces such as `.SF NS` are not meant to be picked.
        .filter(|name| !name.starts_with('.'))
        .map(SharedString::from)
        .collect();
    // The system's own UI font (San Francisco on macOS), which GPUI knows by this name. Apps may
    // use it through the system; it is not bundled or shipped with Athas.
    let families: Vec<SharedString> = cfg!(target_os = "macos").then(|| SharedString::from(SYSTEM_FONT)).into_iter().chain(families).collect();
    cx.set_global(FontCatalog(families.clone()));
    families
}

/// The name GPUI gives the platform's UI font.
pub const SYSTEM_FONT: &str = ".SystemUIFont";

/// How a family is shown: the system font by what it is, others by their name.
pub fn display_name(family: &str) -> SharedString {
    if family == SYSTEM_FONT { "System Font (San Francisco)".into() } else { SharedString::from(family.to_string()) }
}

/// Whether a family is monospaced, by the names monospaced families go by. Measuring every face
/// would load hundreds of fonts; the picker's "All fonts" switch covers the rest.
pub fn looks_monospaced(family: &str) -> bool {
    const HINTS: &[&str] = &[
        "mono", "code", "courier", "consol", "menlo", "monaco", "hack", "iosevka", "inconsolata",
        "terminal", "fixed", "typewriter", "input", "berkeley", "hasklig", "lilex", "fira mono",
        "pragmata", "operator", "victor", "jetbrains", "cascadia", "plex mono", "sf mono", "mononoki",
        "ubuntu mono", "dejavu sans mono", "liberation mono", "comic mono", "recursive", "monaspace",
    ];
    let lower = family.to_lowercase();
    HINTS.iter().any(|hint| lower.contains(hint))
}

pub enum FontPickerEvent {
    Picked(SharedString),
}

pub struct FontPicker {
    families: Vec<SharedString>,
    matches: Vec<SharedString>,
    current: SharedString,
    monospace_only: bool,
    selected: usize,
    query: SharedString,
    input: Entity<TextInput>,
    scroll: UniformListScrollHandle,
    _subscription: Subscription,
}

impl EventEmitter<FontPickerEvent> for FontPicker {}
impl EventEmitter<DismissEvent> for FontPicker {}

impl Focusable for FontPicker {
    fn focus_handle(&self, cx: &App) -> FocusHandle {
        self.input.focus_handle(cx)
    }
}

impl FontPicker {
    pub fn new(current: SharedString, monospace: bool, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let input = cx.new(|cx| {
            TextInput::new(window, cx).placeholder("Search fonts").leading_icon(IconName::Search).appearance(InputAppearance::Bare)
        });
        let subscription = cx.subscribe(&input, |this, _, event: &TextInputEvent, cx| match event {
            TextInputEvent::Changed(query) => {
                this.query = query.clone();
                this.update_matches(cx);
            }
            TextInputEvent::Confirmed => this.confirm(cx),
            TextInputEvent::Cancelled => cx.emit(DismissEvent),
            _ => {}
        });
        input.update(cx, |input, cx| input.focus(window, cx));
        let families = font_families(cx);
        let mut picker = Self {
            families,
            matches: Vec::new(),
            current,
            monospace_only: monospace,
            selected: 0,
            query: SharedString::default(),
            input,
            scroll: UniformListScrollHandle::new(),
            _subscription: subscription,
        };
        picker.update_matches(cx);
        if let Some(index) = picker.matches.iter().position(|family| *family == picker.current) {
            picker.selected = index;
            picker.scroll.scroll_to_item(index, ScrollStrategy::Center);
        }
        picker
    }

    fn update_matches(&mut self, cx: &mut Context<Self>) {
        let query = self.query.to_lowercase();
        let words: Vec<&str> = query.split_whitespace().collect();
        self.matches = self
            .families
            .iter()
            .filter(|family| !self.monospace_only || looks_monospaced(family) || **family == self.current)
            .filter(|family| {
                let lower = display_name(family).to_lowercase();
                words.iter().all(|word| lower.contains(word))
            })
            .cloned()
            .collect();
        // A family typed in full that the system lacks can still be set, as the web picker allows.
        let typed = self.query.trim();
        if !typed.is_empty() && !self.matches.iter().any(|family| family.eq_ignore_ascii_case(typed)) {
            self.matches.push(SharedString::from(typed.to_string()));
        }
        self.selected = 0;
        self.scroll.scroll_to_item(0, ScrollStrategy::Top);
        cx.notify();
    }

    fn confirm(&mut self, cx: &mut Context<Self>) {
        if let Some(family) = self.matches.get(self.selected).cloned() {
            cx.emit(FontPickerEvent::Picked(family));
            cx.emit(DismissEvent);
        }
    }

    fn move_selection(&mut self, delta: isize, cx: &mut Context<Self>) {
        if self.matches.is_empty() {
            return;
        }
        let count = self.matches.len() as isize;
        self.selected = (self.selected as isize + delta).rem_euclid(count) as usize;
        self.scroll.scroll_to_item(self.selected, ScrollStrategy::Nearest);
        cx.notify();
    }

    fn render_rows(&mut self, range: Range<usize>, _window: &mut Window, cx: &mut Context<Self>) -> Vec<gpui::AnyElement> {
        let colors = cx.theme().colors.clone();
        range
            .filter_map(|index| {
                let family = self.matches.get(index)?.clone();
                let selected = index == self.selected;
                let current = family == self.current;
                Some(
                    div()
                        .id(("font", index))
                        .flex()
                        .items_center()
                        .gap(px(8.))
                        .w_full()
                        .h(px(30.))
                        .px(px(8.))
                        .rounded(metrics::radius_md())
                        // The picker's cursor, as `ui::Select` and the palette draw it.
                        .text_color(if selected { colors.primary_foreground } else { colors.foreground })
                        .when(selected, |this| this.bg(colors.primary))
                        .on_mouse_move(cx.listener(move |this, _, _, cx| {
                            if this.selected != index {
                                this.selected = index;
                                cx.notify();
                            }
                        }))
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.selected = index;
                            this.confirm(cx);
                        }))
                        .child(div().size(px(12.)).flex_none().when(current, |this| {
                            this.child(Icon::new(IconName::Check).size(IconSize::XSmall).color(if selected { colors.primary_foreground } else { colors.primary }))
                        }))
                        // Every name in the UI font, so the list reads evenly (a symbol or display
                        // face can't make a name unreadable); the sample shows the face itself.
                        .child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .truncate()
                                .text_size(typography::text_sm())
                                .text_color(if selected { colors.primary_foreground } else { colors.foreground })
                                .child(display_name(&family)),
                        )
                        .child(
                            div()
                                .flex_none()
                                .font_family(family)
                                .text_size(typography::text_sm())
                                .text_color(if selected { colors.primary_foreground } else { colors.subtle_foreground })
                                .child("Aa"),
                        )
                        .into_any_element(),
                )
            })
            .collect()
    }
}

impl Render for FontPicker {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme().clone();
        let colors = &theme.colors;
        let count = self.matches.len();
        div()
            .id("font-picker")
            .occlude()
            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
            .on_mouse_down_out(cx.listener(|_, _, _, cx| cx.emit(DismissEvent)))
            .on_key_down(cx.listener(|this, event: &KeyDownEvent, _, cx| match event.keystroke.key.as_str() {
                "down" => this.move_selection(1, cx),
                "up" => this.move_selection(-1, cx),
                _ => {}
            }))
            .flex()
            .flex_col()
            .w(px(300.))
            .h(px(360.))
            .rounded(metrics::radius_lg())
            .bg(colors.overlay)
            .shadow(theme.shadows.popover.clone())
            .overflow_hidden()
            .font_family(typography::ui_font())
            .child(
                div()
                    .flex()
                    .flex_none()
                    .items_center()
                    .h(px(36.))
                    .px(px(10.))
                    .border_b_1()
                    .border_color(colors.divider)
                    .child(self.input.clone()),
            )
            .child(ui::with_scrollbar(
                uniform_list("font-picker-rows", count, cx.processor(Self::render_rows))
                    .track_scroll(&self.scroll)
                    .flex_1()
                    .min_h_0()
                    .p(px(4.)),
                ui::Scrollbar::uniform("font-picker-scrollbar", &self.scroll),
            )
            )
            .child(
                div()
                    .flex()
                    .flex_none()
                    .items_center()
                    .justify_between()
                    .h(px(36.))
                    .px(px(10.))
                    .border_t_1()
                    .border_color(colors.divider)
                    .text_size(typography::text_caption())
                    .text_color(colors.subtle_foreground)
                    .child(format!("{count} fonts"))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(6.))
                            .child("Monospaced only")
                            .child(Switch::new("font-picker-monospace", self.monospace_only).on_change({
                                let this = cx.entity().downgrade();
                                move |checked, _, cx| {
                                    this.update(cx, |this, cx| {
                                        this.monospace_only = checked;
                                        this.update_matches(cx);
                                    })
                                    .ok();
                                }
                            })),
                    ),
            )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn monospaced_names() {
        for family in ["JetBrains Mono", "Fira Code", "Menlo", "SF Mono", "Courier New", "Iosevka Term"] {
            assert!(looks_monospaced(family), "{family}");
        }
        for family in ["Inter", "Helvetica Neue", "Georgia"] {
            assert!(!looks_monospaced(family), "{family}");
        }
    }
}
