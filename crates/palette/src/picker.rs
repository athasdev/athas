use ui::scale::px;
use gpui::{
    Action, AnyElement, App, Context, DismissEvent, Entity, EventEmitter, FocusHandle, Focusable,
    KeyBinding, ListAlignment, ListSizingBehavior, ListState, MouseButton, SharedString, Subscription, Window,
    actions, div, list, prelude::*, relative,
};
use theme::ActiveTheme;
use ui::{Icon, IconName, IconSize, InputAppearance, Kbd, TextInput, TextInputEvent, metrics, typography};

actions!(picker, [SelectNext, SelectPrevious, SelectFirst, SelectLast, PageDown, PageUp, NextTab, PreviousTab]);

/// Rows a page key moves by.
const PAGE: usize = 8;

pub fn init(cx: &mut App) {
    ui::bind_keys_once(cx, "picker", bind_keys);
}

fn bind_keys(cx: &mut App) {
    let context = Some("Picker");
    cx.bind_keys([
        KeyBinding::new("down", SelectNext, context),
        KeyBinding::new("ctrl-n", SelectNext, context),
        KeyBinding::new("up", SelectPrevious, context),
        KeyBinding::new("ctrl-p", SelectPrevious, context),
        KeyBinding::new("pageup", PageUp, context),
        KeyBinding::new("pagedown", PageDown, context),
        KeyBinding::new("cmd-up", SelectFirst, context),
        KeyBinding::new("cmd-down", SelectLast, context),
        KeyBinding::new("home", SelectFirst, context),
        KeyBinding::new("end", SelectLast, context),
        KeyBinding::new("tab", NextTab, context),
        KeyBinding::new("shift-tab", PreviousTab, context),
    ]);
}

/// How an action's shortcut reads in a menu or row: `⌘B`, `Ctrl+B`.
pub fn shortcut_text(action: &dyn Action, window: &Window, cx: &App) -> Option<SharedString> {
    let binding = window.highest_precedence_binding_for_action(action)?;
    let os = cx.platform_info().os;
    Some(
        binding
            .keystrokes()
            .iter()
            .map(|keystroke| keystroke.display(os).to_string())
            .collect::<Vec<_>>()
            .join(" ")
            .into(),
    )
}

/// What a picker lists and what picking does.
pub trait PickerDelegate: Sized + 'static {
    fn placeholder(&self) -> SharedString;
    fn match_count(&self) -> usize;
    fn selected_index(&self) -> usize;
    fn set_selected_index(&mut self, index: usize, cx: &mut Context<Picker<Self>>);
    /// Filters for a new query. May finish later from a task; call `cx.notify()` then.
    fn update_matches(&mut self, query: &str, window: &mut Window, cx: &mut Context<Picker<Self>>);
    fn render_match(&self, index: usize, selected: bool, window: &mut Window, cx: &mut Context<Picker<Self>>) -> AnyElement;
    /// Picks a match. Return `false` to keep the picker open.
    fn confirm(&mut self, index: usize, window: &mut Window, cx: &mut Context<Picker<Self>>) -> bool;

    /// A section title shown before the match at `index`.
    fn section_label(&self, _index: usize) -> Option<SharedString> {
        None
    }
    fn empty_message(&self) -> SharedString {
        "No results".into()
    }
    /// Filter tabs under the search field, and which one is on.
    fn tabs(&self) -> Vec<(SharedString, bool)> {
        Vec::new()
    }
    fn select_tab(&mut self, _index: usize, _window: &mut Window, _cx: &mut Context<Picker<Self>>) {}
    /// The icon drawn before a filter tab's label.
    fn tab_icon(&self, _index: usize) -> Option<IconName> {
        None
    }
    /// Called when the picker closes without picking, to undo a preview.
    fn dismissed(&mut self, _window: &mut Window, _cx: &mut Context<Picker<Self>>) {}
    /// Enter was pressed while there were no matches yet. A delegate whose results are still
    /// coming can remember it and pick the first one when they arrive.
    fn confirm_when_ready(&mut self, _cx: &mut Context<Picker<Self>>) {}
    fn leading_icon(&self) -> IconName {
        IconName::Search
    }
    /// Whether the search field starts with the leading icon.
    fn shows_leading_icon(&self) -> bool {
        true
    }
    /// Whether the header ends with the Return hint.
    fn shows_return_hint(&self) -> bool {
        true
    }
    /// A row of hints under the list (`CommandFooter`).
    fn footer(&self, _window: &mut Window, _cx: &mut Context<Picker<Self>>) -> Option<AnyElement> {
        None
    }
    /// Drawn in place of the leading icon, such as a back button.
    fn leading_element(&self, _window: &mut Window, _cx: &mut Context<Picker<Self>>) -> Option<AnyElement> {
        None
    }
    /// Buttons beside the search field.
    fn header_actions(&self, _window: &mut Window, _cx: &mut Context<Picker<Self>>) -> Vec<AnyElement> {
        Vec::new()
    }
    /// A title row above the search field: the title, and a quieter subtitle after it (such as
    /// `("Local History: main.rs", Some(path))`).
    fn title(&self) -> Option<(SharedString, Option<SharedString>)> {
        None
    }
    /// The icon in front of the title (the leading icon unless overridden).
    fn title_icon(&self) -> IconName {
        self.leading_icon()
    }
}

/// A floating panel with a search field over a list of matches (`ui/command.tsx`).
pub struct Picker<D: PickerDelegate> {
    pub delegate: D,
    input: Entity<TextInput>,
    list: ListState,
    /// The list's items: a section title before the match it heads, or a match.
    entries: Vec<Entry>,
    query: SharedString,
    confirmed: bool,
    /// A row to bring into view once the list has laid out its rows.
    pending_scroll: Option<usize>,
    _subscription: Subscription,
}

#[derive(Clone, PartialEq)]
enum Entry {
    Section(SharedString),
    Match(usize),
}

/// A row's height before it is measured, so the scrollbar is about right from the first frame.
fn row_height_hint() -> gpui::Pixels {
    px(29.)
}

impl<D: PickerDelegate> EventEmitter<DismissEvent> for Picker<D> {}

impl<D: PickerDelegate> Focusable for Picker<D> {
    fn focus_handle(&self, cx: &App) -> FocusHandle {
        self.input.focus_handle(cx)
    }
}

impl<D: PickerDelegate> Picker<D> {
    pub fn new(delegate: D, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let placeholder = delegate.placeholder();
        let input = cx.new(|cx| TextInput::new(window, cx).placeholder(placeholder).appearance(InputAppearance::Bare));
        let subscription = cx.subscribe_in(&input, window, |this, _, event: &TextInputEvent, window, cx| match event {
            TextInputEvent::Changed(query) => {
                this.query = query.clone();
                this.delegate.update_matches(query, window, cx);
                this.delegate.set_selected_index(0, cx);
                this.list.scroll_to_reveal_item(0);
                cx.notify();
            }
            TextInputEvent::Confirmed => this.confirm_selected(window, cx),
            TextInputEvent::Cancelled => this.dismiss(window, cx),
            _ => {}
        });
        input.update(cx, |input, cx| input.focus(window, cx));
        let mut picker = Self {
            delegate,
            input,
            list: ListState::new(0, ListAlignment::Top, px(200.)),
            entries: Vec::new(),
            query: SharedString::default(),
            confirmed: false,
            pending_scroll: None,
            _subscription: subscription,
        };
        picker.delegate.update_matches("", window, cx);
        // Start on the selection the delegate chose, such as the theme in use.
        let selected = picker.delegate.selected_index();
        if selected > 0 {
            picker.pending_scroll = Some(picker.child_index(selected));
        }
        picker
    }

    /// Starts with this text in the field, as a quick open opened with a prefix does.
    pub fn set_query(&mut self, query: impl Into<SharedString>, cx: &mut Context<Self>) {
        let query = query.into();
        self.input.update(cx, |input, cx| input.set_text(query, cx));
    }

    pub fn query(&self) -> &SharedString {
        &self.query
    }

    pub fn dismiss(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if !self.confirmed {
            self.delegate.dismissed(window, cx);
        }
        cx.emit(DismissEvent);
    }

    fn confirm_selected(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.delegate.match_count() == 0 {
            self.delegate.confirm_when_ready(cx);
            return;
        }
        let index = self.delegate.selected_index();
        self.confirm_index(index, window, cx);
    }

    pub(crate) fn confirm_index(&mut self, index: usize, window: &mut Window, cx: &mut Context<Self>) {
        if self.delegate.confirm(index, window, cx) {
            self.confirmed = true;
            cx.emit(DismissEvent);
        }
    }

    fn select(&mut self, index: usize, cx: &mut Context<Self>) {
        let count = self.delegate.match_count();
        if count == 0 {
            return;
        }
        let index = index.min(count - 1);
        self.delegate.set_selected_index(index, cx);
        self.reveal(index);
        cx.notify();
    }

    /// The list's children include section titles; this finds a match's child.
    fn child_index(&self, index: usize) -> usize {
        (0..=index).filter(|ix| self.delegate.section_label(*ix).is_some()).count() + index
    }

    /// Scrolls a match into view along with the items on either side of it, so the edge fades
    /// fall on a neighbour (or its section title) rather than on the match.
    fn reveal(&self, index: usize) {
        let child = self.child_index(index);
        self.list.scroll_to_reveal_item(child);
        if child + 1 < self.list.item_count() {
            self.list.scroll_to_reveal_item(child + 1);
        }
        if child > 0 {
            self.list.scroll_to_reveal_item(child - 1);
        }
    }

    /// Rebuilds the list's items when the matches changed, which a delegate may do from a task.
    fn sync_entries(&mut self) {
        let count = self.delegate.match_count();
        let mut entries = Vec::with_capacity(count + 8);
        for index in 0..count {
            if let Some(label) = self.delegate.section_label(index) {
                entries.push(Entry::Section(label));
            }
            entries.push(Entry::Match(index));
        }
        if entries != self.entries {
            self.list.reset_with_uniform_height(entries.len(), row_height_hint());
            self.entries = entries;
            if count > 0 {
                self.reveal(self.delegate.selected_index().min(count - 1));
            }
        }
    }

    fn render_entry(&mut self, ix: usize, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let colors = cx.theme().colors.clone();
        // The list's own padding sits outside the scrolled rows, so the inset is on each item.
        let last = ix + 1 == self.entries.len();
        let item = div().pl(px(4.)).pr(px(8.)).when(ix == 0, |this| this.pt(px(4.))).when(last, |this| this.pb(px(4.)));
        match self.entries.get(ix).cloned() {
            Some(Entry::Section(label)) => item
                .child(
                    div()
                        .px(px(8.))
                        .pt(px(6.))
                        .pb(px(2.))
                        .text_size(typography::text_caption())
                        .font_weight(typography::MEDIUM)
                        .text_color(colors.subtle_foreground)
                        .child(label),
                )
                .into_any_element(),
            Some(Entry::Match(index)) => {
                let row = self.delegate.render_match(index, index == self.delegate.selected_index(), window, cx);
                item.child(
                    div()
                        .id(("picker-row", index))
                        .on_mouse_move(cx.listener(move |this, _, _, cx| {
                            if this.delegate.selected_index() != index {
                                this.delegate.set_selected_index(index, cx);
                                cx.notify();
                            }
                        }))
                        .on_click(cx.listener(move |this, _, window, cx| this.confirm_index(index, window, cx)))
                        .child(row),
                )
                .into_any_element()
            }
            None => item.into_any_element(),
        }
    }

    /// Searches again with the current query, after the delegate's items change.
    pub fn refresh_matches(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let query = self.query.clone();
        self.delegate.update_matches(&query, window, cx);
        self.delegate.set_selected_index(0, cx);
        cx.notify();
    }

    /// Shows filter tab `index`, searching again and taking the tab's placeholder.
    fn switch_tab(&mut self, index: usize, window: &mut Window, cx: &mut Context<Self>) {
        self.delegate.select_tab(index, window, cx);
        let query = self.query.clone();
        self.delegate.update_matches(&query, window, cx);
        self.delegate.set_selected_index(0, cx);
        let placeholder = self.delegate.placeholder();
        self.input.update(cx, |input, cx| input.set_placeholder(placeholder, cx));
        self.list.scroll_to_reveal_item(0);
        cx.notify();
    }

    fn step_tab(&mut self, forward: bool, window: &mut Window, cx: &mut Context<Self>) {
        let tabs = self.delegate.tabs();
        if tabs.is_empty() {
            return;
        }
        let current = tabs.iter().position(|(_, active)| *active).unwrap_or(0);
        let next = if forward { (current + 1) % tabs.len() } else { (current + tabs.len() - 1) % tabs.len() };
        self.switch_tab(next, window, cx);
    }

    fn select_next(&mut self, _: &SelectNext, _: &mut Window, cx: &mut Context<Self>) {
        let count = self.delegate.match_count();
        if count > 0 {
            self.select((self.delegate.selected_index() + 1) % count, cx);
        }
    }

    fn select_previous(&mut self, _: &SelectPrevious, _: &mut Window, cx: &mut Context<Self>) {
        let count = self.delegate.match_count();
        if count > 0 {
            self.select((self.delegate.selected_index() + count - 1) % count, cx);
        }
    }

    fn select_first(&mut self, _: &SelectFirst, _: &mut Window, cx: &mut Context<Self>) {
        self.select(0, cx);
    }

    fn select_last(&mut self, _: &SelectLast, _: &mut Window, cx: &mut Context<Self>) {
        self.select(self.delegate.match_count().saturating_sub(1), cx);
    }

    /// A page key moves by a screenful and stops at the ends, where the arrows wrap.
    fn page(&mut self, down: bool, cx: &mut Context<Self>) {
        let count = self.delegate.match_count();
        if count == 0 {
            return;
        }
        let selected = self.delegate.selected_index();
        let index = if down { (selected + PAGE).min(count - 1) } else { selected.saturating_sub(PAGE) };
        self.select(index, cx);
    }
}

impl<D: PickerDelegate> Render for Picker<D> {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.sync_entries();
        if let Some(child) = self.pending_scroll {
            self.list.scroll_to_reveal_item(child);
            if self.list.bounds_for_item(child).is_some() {
                self.pending_scroll = None;
            } else {
                cx.notify();
            }
        }
        let theme = cx.theme().clone();
        let colors = &theme.colors;
        let count = self.delegate.match_count();

        let tabs = self.delegate.tabs();
        let actions = self.delegate.header_actions(window, cx);
        // One bar: what this is, then the field, then the way out. A title of its own above the
        // field made the surface read as two headers stacked.
        let title = self.delegate.title().map(|(title, subtitle)| {
            div()
                .flex()
                .flex_none()
                .items_center()
                .gap(px(6.))
                .max_w(px(220.))
                .child(Icon::new(self.delegate.title_icon()).size(IconSize::Small).color(colors.subtle_foreground))
                .child(div().flex_none().truncate().font_weight(typography::MEDIUM).text_color(colors.foreground).child(title))
                .children(subtitle.map(|subtitle| div().min_w_0().truncate().text_color(colors.subtle_foreground).child(subtitle)))
                .child(div().flex_none().w(px(1.)).h(px(14.)).bg(colors.divider))
        });
        let header = div()
            .flex()
            .flex_none()
            .items_center()
            .gap(px(6.))
            .h(px(36.))
            .px(px(12.))
            .border_b_1()
            .border_color(colors.divider)
            .text_size(typography::text_sm())
            .children(title)
            .children(match self.delegate.leading_element(window, cx) {
                Some(element) => Some(element),
                None if self.delegate.shows_leading_icon() => {
                    Some(Icon::new(self.delegate.leading_icon()).size(IconSize::Small).color(colors.subtle_foreground).into_any_element())
                }
                None => None,
            })
            .child(div().flex_1().min_w_0().h(px(24.)).flex().items_center().child(self.input.clone()))
            .children(actions)
            .child(
                div()
                    .id("picker-close")
                    .flex()
                    .items_center()
                    .justify_center()
                    .size(px(20.))
                    .rounded(metrics::radius())
                    .hover(|style| style.bg(colors.accent))
                    .child(Icon::new(IconName::X).size(IconSize::XSmall).color(colors.subtle_foreground))
                    .on_click(cx.listener(|this, _, window, cx| this.dismiss(window, cx))),
            );

        let tab_bar = (!tabs.is_empty()).then(|| {
            let tabs = tabs.into_iter().enumerate().map(|(index, (label, active))| {
                let text = if active { colors.foreground } else { colors.subtle_foreground };
                div()
                    .id(("picker-tab", index))
                    .flex()
                    .flex_none()
                    .items_center()
                    .gap(metrics::chrome_gap())
                    .h(metrics::chrome_control())
                    .px(px(12.))
                    .rounded_full()
                    .whitespace_nowrap()
                    .text_color(text)
                    .when(active, |this| this.bg(colors.segment_knob).shadow(theme.shadows.raised_inset.clone()))
                    .when(!active, |this| this.hover(|style| style.text_color(colors.foreground)))
                    .children(self.delegate.tab_icon(index).map(|icon| Icon::new(icon).size(IconSize::Custom(px(14.))).color(text)))
                    .child(label)
                    .on_click(cx.listener(move |this, _, window, cx| this.switch_tab(index, window, cx)))
            });
            div().flex().flex_none().px(px(8.)).pt(px(8.)).child(
                div()
                    .flex()
                    .flex_none()
                    .items_center()
                    .gap(px(2.))
                    .p(px(2.))
                    .rounded_full()
                    .bg(colors.segment_track)
                    .text_size(typography::text_chrome())
                    .font_weight(typography::MEDIUM)
                    .children(tabs),
            )
        });
        // The keys that work here, always: a command surface is driven from the keyboard, and a
        // hint row costs less than guessing. What the delegate adds sits beside them.
        let hint = |keys: &'static str, label: &'static str| {
            div().flex().flex_none().items_center().gap(px(4.)).child(Kbd::new(keys)).child(div().text_color(colors.subtle_foreground).child(label))
        };
        let footer = div()
            .flex()
            .flex_none()
            .items_center()
            .gap(px(12.))
            .h(px(28.))
            .px(px(12.))
            .border_t_1()
            .border_color(colors.divider)
            .text_size(typography::text_caption())
            .child(hint("↑↓", "Move"))
            .when(self.delegate.shows_return_hint(), |this| this.child(hint("↵", "Open")))
            .child(hint("esc", "Close"))
            .child(div().flex_1())
            .children(self.delegate.footer(window, cx))
            .when(count > 0, |this| {
                this.child(div().flex_none().text_color(colors.subtle_foreground).child(match count {
                    1 => "1 result".to_string(),
                    count => format!("{count} results"),
                }))
            });

        let empty = (count == 0).then(|| {
            div()
                .px(px(8.))
                .py(px(10.))
                .text_center()
                .text_size(typography::text_sm())
                .text_color(colors.muted_foreground)
                .child(self.delegate.empty_message())
        });
        let list = list(self.list.clone(), cx.processor(|this, ix, window, cx| this.render_entry(ix, window, cx)))
            .with_sizing_behavior(ListSizingBehavior::Infer)
            .flex_1()
            .min_h_0();

        let viewport = window.viewport_size();
        ui::overlay_surface(cx)
            .id("picker")
            .key_context("Picker")
            .on_action(cx.listener(Self::select_next))
            .on_action(cx.listener(Self::select_previous))
            .on_action(cx.listener(Self::select_first))
            .on_action(cx.listener(Self::select_last))
            .on_action(cx.listener(|this, _: &PageDown, _, cx| this.page(true, cx)))
            .on_action(cx.listener(|this, _: &PageUp, _, cx| this.page(false, cx)))
            .on_action(cx.listener(|this, _: &NextTab, window, cx| this.step_tab(true, window, cx)))
            .on_action(cx.listener(|this, _: &PreviousTab, window, cx| this.step_tab(false, window, cx)))
            .occlude()
            .w((viewport.width - px(32.)).min(px(620.)))
            .max_h((viewport.height * 0.6).min(px(440.)))
            .child(header)
            .children(tab_bar)
            .children(empty)
            .when(count > 0, |this| {
                this.child(
                    ui::faded_list_scroll(
                        ui::with_scrollbar(list, ui::Scrollbar::list("picker-scrollbar", &self.list).always().priority(3)),
                        &self.list,
                        colors.overlay,
                    )
                    .flex_1(),
                )
            })
            .child(footer)
            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
    }
}

/// Lays a picker over the window: a scrim, and the panel a tenth of the way down.
pub fn modal_layer(view: impl IntoElement, viewport_height: gpui::Pixels, cx: &App, on_backdrop: impl Fn(&mut Window, &mut App) + 'static) -> impl IntoElement {
    div()
        .id("modal-layer")
        .absolute()
        .inset_0()
        .bg(cx.theme().colors.scrim)
        .flex()
        .justify_center()
        .pt(viewport_height * 0.1)
        .on_mouse_down(MouseButton::Left, move |_, window, cx| on_backdrop(window, cx))
        .child(div().h(relative(1.)).child(view))
}

